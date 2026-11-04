// npm run instalar — deja todo andando. Es idempotente: se puede correr las veces que haga falta.
// Lo único manual: crear el admin de Chatwoot y pegar CHATWOOT_API_TOKEN y OPENROUTER_API_KEY en .env.
// Las inmobiliarias (WhatsApp + QR) se dan de alta después con npm run nuevo-cliente.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { aplicarEsquema, asignarCredenciales, clienteChatwoot, compose, conexionInmo, credencialesParaImportar, leerEnv, WEBHOOK_N8N } from './lib.js';

const SECRETOS = ['POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'N8N_ENCRYPTION_KEY', 'N8N_RUNNERS_AUTH_TOKEN', 'CHATWOOT_SECRET_KEY_BASE', 'EVOLUTION_API_KEY'];
const ID_FLUJO = 'recepcionistaIA';
const paso = (t) => console.log(`\n▸ ${t}`);

// 1. .env: si no existe, se crea desde .env.example con secretos nuevos.
paso('Configuración (.env)');
if (!existsSync('.env')) {
  const plantilla = readFileSync('.env.example', 'utf8');
  writeFileSync('.env', plantilla.replace(/^([A-Z0-9_]+)=$/gm, (l, k) => (SECRETOS.includes(k) ? `${k}=${randomBytes(32).toString('hex')}` : l)));
  console.log('  .env creado con secretos generados');
} else console.log('  uso el .env existente');
const env = leerEnv();
const sinValor = SECRETOS.filter((k) => !env[k]);
if (sinValor.length) throw new Error(`Faltan en .env: ${sinValor.join(', ')} (generalos con openssl rand -hex 32)`);

// 2. Stack sano. chatwoot-init prepara la base de Chatwoot (db:chatwoot_prepare) antes de que arranque.
paso('Stack: docker compose up -d --wait (la primera vez tarda unos minutos)');
compose(['up', '-d', '--wait']);

// 3. Esquema del recepcionista y migraciones (idempotentes).
paso('Base inmo: esquema y migraciones');
console.log('  ' + aplicarEsquema(env).join(' · '));

// 4. Los dos tokens que se pegan a mano.
if (!env.CHATWOOT_API_TOKEN || !env.OPENROUTER_API_KEY) {
  console.log(`
Falta lo manual (una sola vez):
  1. Abrí http://localhost:3000 y creá tu usuario administrador de Chatwoot.
  2. En Chatwoot → tu perfil → Access Token: copialo en .env como CHATWOOT_API_TOKEN.
  3. Pegá tu API key de OpenRouter en .env como OPENROUTER_API_KEY.
Después corré otra vez: npm run instalar`);
  process.exit(0);
}

// 5. Chatwoot: cuenta y webhook message_created → n8n (por la red interna).
paso('Chatwoot: webhook hacia n8n');
const chatwoot = clienteChatwoot(env);
const perfil = await chatwoot('/api/v1/profile');
const cuenta = perfil.account_id;
const { payload: { webhooks } } = await chatwoot(`/api/v1/accounts/${cuenta}/webhooks`);
if (webhooks.some((w) => w.url === WEBHOOK_N8N)) console.log(`  ya existe: ${WEBHOOK_N8N}`);
else {
  await chatwoot(`/api/v1/accounts/${cuenta}/webhooks`, { metodo: 'POST', cuerpo: { url: WEBHOOK_N8N, subscriptions: ['message_created'] } });
  console.log(`  creado: ${WEBHOOK_N8N}`);
}

// 5b. Agent Bot: el bot escribe con su propio token, así sus mensajes se distinguen de los de un
// asesor (sender.type agent_bot vs user). Es de la cuenta y no se conecta a los inboxes, así las
// conversaciones no quedan en "pendiente".
paso('Chatwoot: Agent Bot del recepcionista');
const NOMBRE_BOT = 'Recepcionista IA';
let bot = (await chatwoot(`/api/v1/accounts/${cuenta}/agent_bots`)).find((b) => b.name === NOMBRE_BOT);
if (bot) console.log(`  ya existe (id ${bot.id})`);
else {
  bot = await chatwoot(`/api/v1/accounts/${cuenta}/agent_bots`, { metodo: 'POST', cuerpo: { name: NOMBRE_BOT, description: 'Atiende WhatsApp con el catálogo de cada inmobiliaria' } });
  console.log(`  creado (id ${bot.id})`);
}

// 6. n8n: credenciales y flujo por CLI (como test/e2e/run.js), publicado.
paso('n8n: credenciales y flujo');
const CREDS = {
  postgres: { id: 'inmoPostgres', name: 'Postgres inmo', data: { host: 'postgres', port: 5432, database: 'inmo', user: env.POSTGRES_USER || 'postgres', password: env.POSTGRES_PASSWORD, ssl: 'disable' } },
  redis: { id: 'inmoRedis', name: 'Redis', data: { host: 'redis', port: 6379, password: env.REDIS_PASSWORD, database: 1 } },
  openRouterApi: { id: 'inmoOpenRouter', name: 'OpenRouter', data: { apiKey: env.OPENROUTER_API_KEY, url: 'https://openrouter.ai/api/v1' } },
  httpHeaderAuth: { id: 'inmoChatwoot', name: 'Chatwoot (Agent Bot)', data: { name: 'api_access_token', value: bot.access_token } },
};
const wf = JSON.parse(readFileSync('workflows/recepcionista-inmobiliaria.json', 'utf8'));
const n8nImportar = (tipo, datos) => compose(
  ['exec', '-T', 'n8n', 'sh', '-c', `cat > /tmp/importar.json && n8n import:${tipo} --input=/tmp/importar.json; s=$?; rm -f /tmp/importar.json; exit $s`],
  { entrada: JSON.stringify(datos), silencioso: true },
);
n8nImportar('credentials', credencialesParaImportar(CREDS));
n8nImportar('workflow', { ...asignarCredenciales(wf, CREDS), id: ID_FLUJO, active: false });
compose(['exec', '-T', 'n8n', 'n8n', 'publish:workflow', `--id=${ID_FLUJO}`], { silencioso: true });
compose(['restart', 'n8n'], { silencioso: true }); // n8n toma el flujo publicado al arrancar
compose(['up', '-d', '--wait', 'n8n', 'n8n-runner'], { silencioso: true });
console.log(`  flujo "${wf.name}" publicado (id ${ID_FLUJO})`);

// 7. Resumen.
const db = new pg.Client(conexionInmo(env));
await db.connect();
const { rows: [{ n }] } = await db.query('SELECT count(*)::int AS n FROM clientes WHERE activo');
await db.end();
console.log(`
✓ Listo. Chatwoot: http://localhost:3000 · n8n: http://localhost:5678 · ${n} inmobiliaria(s) activa(s)
  Alta de una inmobiliaria (WhatsApp + QR): npm run nuevo-cliente -- "Nombre"
  Estado de todas:                          npm run clientes`);

// npm run instalar — deja todo andando. Es idempotente: se puede correr las veces que haga falta.
// Lo único manual: crear el admin de Chatwoot, pegar CHATWOOT_API_TOKEN y OPENROUTER_API_KEY en .env y escanear el QR.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import qrcode from 'qrcode-terminal';
import { asignarCredenciales, chatwoot as clienteChatwoot, compose, credencialesParaImportar, evolution as clienteEvolution, leerEnv, URL_INTERNA, WEBHOOK_N8N } from './lib.js';

const SECRETOS = ['POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'N8N_ENCRYPTION_KEY', 'N8N_RUNNERS_AUTH_TOKEN', 'CHATWOOT_SECRET_KEY_BASE', 'EVOLUTION_API_KEY'];
const ID_FLUJO = 'recepcionistaIA';
const paso = (t) => console.log(`\n▸ ${t}`);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

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

// 3. Esquema del recepcionista (CREATE … IF NOT EXISTS).
paso('Base inmo: data/schema.sql');
compose(['exec', '-T', '-e', 'PGOPTIONS=-c client_min_messages=warning', 'postgres', 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', env.POSTGRES_USER || 'postgres', '-d', 'inmo'], { entrada: readFileSync('data/schema.sql', 'utf8') });

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

// 6. Evolution: instancia de WhatsApp con la integración de Chatwoot (crea el inbox sola).
const instancia = env.EVOLUTION_INSTANCIA || 'inmobiliaria';
paso(`Evolution: instancia "${instancia}"`);
const evolution = clienteEvolution(env);
const existentes = await evolution('/instance/fetchInstances');
if (existentes.some((i) => i.name === instancia)) console.log('  ya existe');
else {
  await evolution('/instance/create', {
    metodo: 'POST',
    cuerpo: {
      instanceName: instancia, integration: 'WHATSAPP-BAILEYS', qrcode: true,
      chatwootAccountId: String(cuenta), chatwootToken: env.CHATWOOT_API_TOKEN, chatwootUrl: URL_INTERNA.chatwoot,
      chatwootNameInbox: instancia, chatwootAutoCreate: true, chatwootSignMsg: false,
      chatwootReopenConversation: true, chatwootConversationPending: false,
      chatwootImportContacts: false, chatwootImportMessages: false,
    },
  });
  console.log('  creada');
}
let inbox;
for (let i = 0; i < 30 && !inbox; i++) { // Evolution crea el inbox en segundo plano
  inbox = (await chatwoot(`/api/v1/accounts/${cuenta}/inboxes`)).payload.find((x) => x.name === instancia);
  if (!inbox) await dormir(1000);
}
if (!inbox) throw new Error(`Evolution no creó el inbox "${instancia}" en Chatwoot. Revisá: docker compose logs evolution`);
console.log(`  inbox de Chatwoot: ${inbox.id}`);

// 7. n8n: credenciales y flujo por CLI (como test/e2e/run.js), publicado.
paso('n8n: credenciales y flujo');
const CREDS = {
  postgres: { id: 'inmoPostgres', name: 'Postgres inmo', data: { host: 'postgres', port: 5432, database: 'inmo', user: env.POSTGRES_USER || 'postgres', password: env.POSTGRES_PASSWORD, ssl: 'disable' } },
  redis: { id: 'inmoRedis', name: 'Redis', data: { host: 'redis', port: 6379, password: env.REDIS_PASSWORD, database: 1 } },
  openRouterApi: { id: 'inmoOpenRouter', name: 'OpenRouter', data: { apiKey: env.OPENROUTER_API_KEY, url: 'https://openrouter.ai/api/v1' } },
  httpHeaderAuth: { id: 'inmoChatwoot', name: 'Chatwoot API', data: { name: 'api_access_token', value: env.CHATWOOT_API_TOKEN } },
};
const wf = JSON.parse(readFileSync('workflows/recepcionista-inmobiliaria.json', 'utf8'));
const normalizar = wf.nodes.find((n) => n.name === 'Normalizar entrada').parameters;
normalizar.jsCode = normalizar.jsCode
  .replace("const CHATWOOT_URL = 'https://chatwoot.example'", `const CHATWOOT_URL = '${URL_INTERNA.chatwoot}'`)
  .replace('const INBOX_ID = null;', `const INBOX_ID = ${inbox.id};`);
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

// 8. WhatsApp: QR para escanear (si todavía no está conectado).
paso('WhatsApp');
const { instance: { state } = {} } = await evolution(`/instance/connectionState/${instancia}`);
if (state === 'open') console.log('  ✓ ya está conectado');
else {
  const qr = await evolution(`/instance/connect/${instancia}`);
  if (qr?.code) {
    console.log('  Escaneá este QR desde WhatsApp → Dispositivos vinculados → Vincular un dispositivo:\n');
    qrcode.generate(qr.code, { small: true });
  } else console.log(`  Evolution todavía no generó el QR (${JSON.stringify(qr)}). Volvé a correr npm run instalar en unos segundos.`);
  console.log('  El QR también aparece en Chatwoot, en la conversación con "EvolutionAPI".');
}

console.log(`
✓ Listo. Chatwoot: http://localhost:3000 · n8n: http://localhost:5678 (inbox ${inbox.id}, cuenta ${cuenta})`);

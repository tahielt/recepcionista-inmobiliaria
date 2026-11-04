// Utilidades compartidas por los scripts de instalación y operación.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

/** Lee .env (KEY=valor, sin comillas) y lo combina con process.env. */
export function leerEnv(archivo = '.env') {
  const env = {};
  if (existsSync(archivo)) {
    for (const linea of readFileSync(archivo, 'utf8').split('\n')) {
      const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  }
  return { ...env, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k in env)) };
}

/** docker compose <args>; con `entrada` la manda por stdin. Devuelve stdout. */
export function compose(args, { entrada, silencioso = false } = {}) {
  return execFileSync('docker', ['compose', ...args], {
    input: entrada, encoding: 'utf8', stdio: [entrada == null ? 'ignore' : 'pipe', 'pipe', silencioso ? 'pipe' : 'inherit'],
  });
}

/** fetch JSON con error claro. Reintenta errores de red (servicio reiniciando, keep-alive vencido). */
export async function api(url, { metodo = 'GET', headers = {}, cuerpo } = {}, intentos = 3) {
  let r;
  try {
    r = await fetch(url, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: cuerpo == null ? undefined : JSON.stringify(cuerpo),
    });
  } catch (e) {
    if (intentos <= 1) throw new Error(`${metodo} ${url}: ${e.cause?.code ?? e.message}`);
    await new Promise((ok) => setTimeout(ok, 2000));
    return api(url, { metodo, headers, cuerpo }, intentos - 1);
  }
  const texto = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${url} → ${r.status}: ${texto.slice(0, 300)}`);
  return texto ? JSON.parse(texto) : null;
}

// ── Servicios del stack (desde la PC; los puertos están en docker-compose.yml) ──
export const URL_LOCAL = { chatwoot: 'http://127.0.0.1:3000', evolution: 'http://127.0.0.1:8080' };
// Entre contenedores, por la red interna de Docker:
export const URL_INTERNA = { chatwoot: 'http://chatwoot-web:3000', n8n: 'http://n8n:5678', evolution: 'http://evolution:8080' };
export const WEBHOOK_N8N = `${URL_INTERNA.n8n}/webhook/wa-recepcionista`;

export const clienteChatwoot = (env) => (ruta, opciones = {}) =>
  api(URL_LOCAL.chatwoot + ruta, { ...opciones, headers: { api_access_token: env.CHATWOOT_API_TOKEN } });
export const clienteEvolution = (env) => (ruta, opciones = {}) =>
  api(URL_LOCAL.evolution + ruta, { ...opciones, headers: { apikey: env.EVOLUTION_API_KEY } });

// ── n8n ──────────────────────────────────────────────────────────────────────
// Tipo de nodo → credencial que usa (los nombres de tipo son los de n8n).
const CRED_POR_NODO = { postgres: 'postgres', postgresTool: 'postgres', redis: 'redis', memoryRedisChat: 'redis', lmChatOpenRouter: 'openRouterApi', httpRequest: 'httpHeaderAuth' };

/** Asigna a cada nodo su credencial. creds = { postgres: {id, name, data}, redis: …, openRouterApi: …, httpHeaderAuth: … } */
export function asignarCredenciales(wf, creds) {
  for (const n of wf.nodes) {
    const tipo = CRED_POR_NODO[n.type.split('.').pop()];
    if (tipo) n.credentials = { [tipo]: { id: creds[tipo].id, name: creds[tipo].name } };
  }
  return wf;
}

/** Lista de credenciales en el formato de `n8n import:credentials`. */
export const credencialesParaImportar = (creds) => Object.entries(creds).map(([type, c]) => ({ ...c, type }));

// ── Base inmo ────────────────────────────────────────────────────────────────
/** Conexión a la base inmo del stack desde la PC (o DATABASE_URL si está definida). */
export function conexionInmo(env = leerEnv()) {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
  return { host: '127.0.0.1', port: Number(env.POSTGRES_PUERTO || 5433), database: 'inmo', user: env.POSTGRES_USER || 'postgres', password: env.POSTGRES_PASSWORD };
}

/** Esquema base + migraciones en orden. Todo es idempotente. */
export function aplicarEsquema(env) {
  const archivos = ['data/schema.sql', ...readdirSync('data/migraciones').sort().map((f) => `data/migraciones/${f}`)];
  for (const f of archivos) {
    compose(['exec', '-T', '-e', 'PGOPTIONS=-c client_min_messages=warning', 'postgres', 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', env.POSTGRES_USER || 'postgres', '-d', 'inmo'], { entrada: readFileSync(f, 'utf8') });
  }
  return archivos;
}

// ── WhatsApp (Evolution + Chatwoot) ──────────────────────────────────────────
export const slug = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Crea (si no existe) la instancia de Evolution con la integración de Chatwoot y devuelve el inbox que crea. */
export async function instanciaConInbox(env, instancia, nombreInbox) {
  const chatwoot = clienteChatwoot(env), evolution = clienteEvolution(env);
  const { account_id: cuenta } = await chatwoot('/api/v1/profile');
  if (!(await evolution('/instance/fetchInstances')).some((i) => i.name === instancia)) {
    await evolution('/instance/create', {
      metodo: 'POST',
      cuerpo: {
        instanceName: instancia, integration: 'WHATSAPP-BAILEYS', qrcode: true,
        chatwootAccountId: String(cuenta), chatwootToken: env.CHATWOOT_API_TOKEN, chatwootUrl: URL_INTERNA.chatwoot,
        chatwootNameInbox: nombreInbox, chatwootAutoCreate: true, chatwootSignMsg: false,
        chatwootReopenConversation: true, chatwootConversationPending: false,
        chatwootImportContacts: false, chatwootImportMessages: false,
      },
    });
  }
  const { nameInbox } = await evolution(`/chatwoot/find/${instancia}`);
  for (let i = 0; i < 30; i++) { // Evolution crea el inbox en segundo plano
    const inbox = (await chatwoot(`/api/v1/accounts/${cuenta}/inboxes`)).payload.find((x) => x.name === nameInbox);
    if (inbox) return { cuenta, inbox };
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  throw new Error(`Evolution no creó el inbox "${nameInbox}" en Chatwoot. Revisá: docker compose logs evolution`);
}

/** Muestra el QR de la instancia en la terminal, si todavía no está conectada. */
export async function mostrarQR(env, instancia) {
  const evolution = clienteEvolution(env);
  const { instance: { state } = {} } = await evolution(`/instance/connectionState/${instancia}`);
  if (state === 'open') return console.log('  ✓ WhatsApp ya está conectado');
  const qr = await evolution(`/instance/connect/${instancia}`);
  if (qr?.code) {
    console.log('  Escaneá este QR desde WhatsApp → Dispositivos vinculados → Vincular un dispositivo:\n');
    (await import('qrcode-terminal')).default.generate(qr.code, { small: true });
  } else console.log(`  Evolution todavía no generó el QR (${JSON.stringify(qr)}). Volvé a correr el comando en unos segundos.`);
  console.log('  El QR también aparece en Chatwoot, en la conversación con "EvolutionAPI" de ese inbox.');
}

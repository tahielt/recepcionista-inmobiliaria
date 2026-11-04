// Utilidades compartidas por los scripts de instalación y operación.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

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

export const chatwoot = (env) => (ruta, opciones = {}) =>
  api(URL_LOCAL.chatwoot + ruta, { ...opciones, headers: { api_access_token: env.CHATWOOT_API_TOKEN } });
export const evolution = (env) => (ruta, opciones = {}) =>
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

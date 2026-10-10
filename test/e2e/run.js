// Test end-to-end: corre el flujo real en n8n contra Postgres y Redis reales,
// con un LLM falso determinístico y un WhatsApp falso que registra lo que se envía.
// Uso: N8N_BIN=/ruta/a/n8n node test/e2e/run.js [workflow.json]
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { iniciarLLM, pedidos } from './fake-llm.js';

const N8N = process.env.N8N_BIN ?? 'n8n';
const PUERTOS = { n8n: 5690, llm: 4010, wa: 4020 }; // 5679 lo usa el task broker de n8n
const PG = { host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432), database: process.env.PGDATABASE ?? 'inmo', user: process.env.PGUSER ?? 'demo', password: process.env.PGPASSWORD ?? 'demo' };
const REDIS = { host: process.env.REDIS_HOST ?? "127.0.0.1", port: Number(process.env.REDIS_PORT ?? 6379) };
const archivo = process.argv[2] ?? 'workflows/recepcionista-inmobiliaria.json';
const run = Date.now().toString(36);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ── WhatsApp falso ──────────────────────────────────────────────────────────
const enviados = [];
const wa = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => { enviados.push({ ruta: req.url, ...JSON.parse(raw || '{}'), t: Date.now() }); res.end('{"ok":true}'); });
});

// ── Preparar n8n: credenciales de prueba, flujo apuntando a los mocks ────────
const carpeta = mkdtempSync(join(tmpdir(), 'n8n-e2e-'));
const env = {
  ...process.env, N8N_USER_FOLDER: carpeta, N8N_PORT: String(PUERTOS.n8n), N8N_LISTEN_ADDRESS: process.env.N8N_LISTEN_ADDRESS ?? '0.0.0.0',
  N8N_DIAGNOSTICS_ENABLED: 'false', N8N_SECURE_COOKIE: 'false', N8N_ENCRYPTION_KEY: 'e2e-solo-pruebas',
};
const CREDS = {
  postgres: { id: 'cred-pg', name: 'Postgres (e2e)', data: { host: PG.host, port: PG.port, database: PG.database, user: PG.user, password: PG.password, ssl: 'disable' } },
  redis: { id: 'cred-redis', name: 'Redis (e2e)', data: { host: REDIS.host, port: REDIS.port, password: '', database: 0 } },
  openRouterApi: { id: 'cred-llm', name: 'LLM falso (e2e)', data: { apiKey: 'e2e', url: `http://127.0.0.1:${PUERTOS.llm}/v1` } },
};
const credPorTipo = { postgres: 'postgres', postgresTool: 'postgres', redis: 'redis', memoryRedisChat: 'redis', lmChatOpenRouter: 'openRouterApi' };

function prepararFlujo() {
  const wf = JSON.parse(readFileSync(archivo, 'utf8').replaceAll('https://chatwoot.example/api', `http://127.0.0.1:${PUERTOS.wa}/api`));
  for (const n of wf.nodes) {
    const tipo = credPorTipo[n.type.split('.').pop()];
    if (tipo) n.credentials = { [tipo]: { id: CREDS[tipo].id, name: CREDS[tipo].name } };
  }
  return { ...wf, id: 'recepcionistaE2E', active: false };
}

function importar() {
  const credsFile = join(carpeta, 'creds.json'), wfFile = join(carpeta, 'wf.json');
  writeFileSync(credsFile, JSON.stringify(Object.entries(CREDS).map(([type, c]) => ({ ...c, type }))));
  writeFileSync(wfFile, JSON.stringify(prepararFlujo()));
  for (const args of [['import:credentials', `--input=${credsFile}`], ['import:workflow', `--input=${wfFile}`], ['publish:workflow', '--id=recepcionistaE2E']]) {
    execFileSync(N8N, args, { env, stdio: 'pipe' });
  }
}

async function arrancarN8n() {
  const proc = spawn(N8N, ['start'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => (log += d)); proc.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 180; i++) {
    await dormir(1000);
    try { // listo cuando el webhook ya está registrado (n8n responde JSON, no el 404 HTML de Express)
      const r = await fetch(`http://127.0.0.1:${PUERTOS.n8n}/webhook/wa-recepcionista`);
      if (!/Cannot GET|is not registered\./.test(await r.text())) return proc;
    } catch {}
  }
  throw new Error('n8n no arrancó:\n' + log.split('\n').filter((l) => !l.includes('Custom API')).join('\n').slice(-2000));
}

// ── Escenarios ──────────────────────────────────────────────────────────────
const sid = (n) => `wa:e2e-${n}-${run}`;
let mid = 0;
const mensaje = (s, texto, nota_privada = '') => ({ session_id: s, message_id: `m${++mid}`, texto, nota_privada });

const ESCENARIOS = [
  { nombre: 'Consulta: muestra solo propiedades reales', sid: sid('consulta'),
    pasos: [[0, 'Hola, busco depto en venta en el Centro hasta 200 mil dólares']],
    chequear: (c) => [
      ['responde con propiedades del catálogo', /LCB-003/.test(c.texto) && /USD 189\.000/.test(c.texto), c.texto],
      ['guarda la precalificación', c.lead?.zona === 'Centro' && c.lead?.presupuesto_usd === 200000, JSON.stringify(c.lead)],
      ['no deriva ni pausa', c.eventos.length === 0 && c.lead?.ia_activa !== false, JSON.stringify(c.eventos)],
    ] },
  { nombre: 'Buffer: dos mensajes seguidos → una sola respuesta con ambos', sid: sid('rafaga'),
    pasos: [[0, 'Hola!'], [800, 'busco alquiler en Melipal']],
    chequear: (c) => [
      ['el agente corre una sola vez', c.llm.filter((p) => !p.conResultados).length === 1, `${c.llm.filter((p) => !p.conResultados).length} turnos`],
      ['el agente recibe los dos mensajes', c.llm.some((p) => /Hola!/.test(p.user) && /Melipal/.test(p.user)), c.llm.map((p) => p.user).join(' | ')],
      ['responde con el alquiler de Melipal', /LCB-018/.test(c.texto), c.texto],
    ] },
  { nombre: 'Verificador: precio inventado sin herramienta', sid: sid('alucinacion'),
    pasos: [[0, '¿Qué precio aproximado tiene una casa en Catedral?']],
    chequear: (c) => [
      ['bloquea el precio inventado', !/150\.000/.test(c.texto) && /asesor/.test(c.texto), c.texto],
      ['deja nota al equipo y pausa la IA', c.eventos.some((e) => e.tipo === 'hard_fail') && c.lead?.ia_activa === false, JSON.stringify(c.eventos)],
    ] },
  { nombre: 'Verificador: precio real alterado (125.000 → 25.000)', sid: sid('trampa'),
    pasos: [[0, 'busco depto en venta en Belgrano TRAMPA']],
    chequear: (c) => [
      ['bloquea el precio alterado', !/USD 25\.000/.test(c.texto), c.texto],
      ['deja nota al equipo', c.eventos.some((e) => e.tipo === 'hard_fail'), JSON.stringify(c.eventos)],
    ] },
  { nombre: 'Pausa humana: /ia off silencia, /ia on reactiva', sid: sid('pausa'),
    pasos: [[0, '', '/ia off'], [1500, 'hola, sigue alguien? PAUSA1'], [12000, '', '/ia on'], [1500, 'busco depto en venta en Ñireco']],
    chequear: (c) => [
      ['con /ia off no llama al modelo ni responde', !c.llm.some((p) => /PAUSA1/.test(p.user)), c.llm.map((p) => p.user).join(' | ')],
      ['con /ia on vuelve a responder', /LCB-004/.test(c.texto), c.texto],
    ] },
  { nombre: 'Derivación por intención (visita)', sid: sid('visita'),
    pasos: [[0, 'Me encanta, quiero coordinar una visita']],
    chequear: (c) => [
      ['responde al cliente', c.texto.length > 0, c.texto],
      ['deriva y pausa la IA', c.eventos.some((e) => e.tipo === 'derivacion') && c.lead?.ia_activa === false, JSON.stringify({ eventos: c.eventos, lead: c.lead })],
    ] },
  { nombre: 'Derivación por presupuesto alto (> USD 400.000)', sid: sid('premium'),
    pasos: [[0, 'busco casa en venta en Arelauquen hasta 700 mil dólares']],
    chequear: (c) => [
      ['muestra la propiedad', /LCB-009/.test(c.texto), c.texto],
      ['deriva a un asesor', c.eventos.some((e) => e.tipo === 'derivacion'), JSON.stringify(c.eventos)],
    ] },
];

async function correrEscenario(e) {
  for (const [espera, texto, nota] of e.pasos) {
    await dormir(espera);
    const r = await fetch(`http://127.0.0.1:${PUERTOS.n8n}/webhook/wa-recepcionista`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mensaje(e.sid, texto, nota)),
    });
    if (!r.ok) throw new Error(`webhook ${r.status}: ${await r.text()}`);
  }
}

async function esperarSilencio(minimoMs, quietoMs) {
  const inicio = Date.now();
  let ultimo = 0, cuenta = -1;
  while (true) {
    await dormir(1000);
    if (enviados.length !== cuenta) { cuenta = enviados.length; ultimo = Date.now(); }
    if (Date.now() - inicio > minimoMs && Date.now() - ultimo > quietoMs) return;
  }
}

function erroresDeEjecucion() {
  const db = new DatabaseSync(join(carpeta, '.n8n', 'database.sqlite'), { readOnly: true });
  const filas = db.prepare(`SELECT e.id, e.status, d.data FROM execution_entity e JOIN execution_data d ON d.executionId = e.id WHERE e.status != 'success'`).all();
  return filas.map((f) => {
    const m = f.data.match(/"lastNodeExecuted":"(\d+)"/);
    const datos = JSON.parse(f.data);
    const nodo = m ? datos[Number(m[1])] : '?';
    const err = f.data.match(/"message":"(\d+)"/);
    return `#${f.id} ${f.status} en "${nodo}"${err ? ': ' + String(datos[Number(err[1])]).slice(0, 200) : ''}`;
  });
}

// ── Main ────────────────────────────────────────────────────────────────────
const db = new pg.Client(PG);
let n8n;
try {
  await db.connect();
  const llm = await iniciarLLM(PUERTOS.llm);
  await new Promise((r) => wa.listen(PUERTOS.wa, r));
  importar();
  n8n = await arrancarN8n();
  console.log(`n8n listo · flujo ${archivo}\n`);

  await Promise.all(ESCENARIOS.map(correrEscenario));
  await esperarSilencio(25_000, 12_000);

  let fallas = 0;
  for (const e of ESCENARIOS) {
    const propios = enviados.filter((x) => x.session_id === e.sid && x.ruta.endsWith('/messages'));
    const usados = new Set(e.pasos.map((p) => p[1]).filter(Boolean));
    const c = {
      texto: propios.map((x) => x.text).join('\n'),
      lead: (await db.query('SELECT * FROM leads WHERE session_id = $1', [e.sid])).rows[0],
      eventos: (await db.query('SELECT tipo, detalle FROM eventos_equipo WHERE session_id = $1', [e.sid])).rows,
      llm: pedidos.filter((p) => [...usados].some((u) => p.user.includes(u))),
    };
    console.log(e.nombre);
    for (const [desc, ok, detalle] of e.chequear(c)) {
      if (!ok) fallas++;
      console.log(`  ${ok ? '✓' : '✗'} ${desc}${ok ? '' : `\n      → ${String(detalle ?? '').replaceAll('\n', ' ⏎ ').slice(0, 300)}`}`);
    }
  }
  const errores = erroresDeEjecucion();
  if (errores.length) console.log(`\nEjecuciones con error en n8n (${errores.length}):\n` + errores.map((x) => '  ' + x).join('\n'));
  console.log(`\n${fallas ? `✗ ${fallas} chequeos fallaron` : '✓ Todos los chequeos pasaron'}`);
  process.exitCode = fallas ? 1 : 0;
  llm.close();
} finally {
  n8n?.kill('SIGKILL');
  wa.close();
  await db.end().catch(() => {});
}

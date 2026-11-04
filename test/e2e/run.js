// Test end-to-end: corre el flujo real en n8n contra Postgres y Redis reales,
// con un LLM falso determinístico y un Chatwoot falso que registra lo que se envía.
// Los mensajes entran con el formato real del webhook de Chatwoot (message_created).
// Uso: N8N_BIN=/ruta/a/n8n node test/e2e/run.js [workflow.json]
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { iniciarLLM, pedidos } from './fake-llm.js';
import { asignarCredenciales, credencialesParaImportar } from '../../scripts/lib.js';

const N8N = process.env.N8N_BIN ?? 'n8n';
const PUERTOS = { n8n: 5690, llm: 4010, wa: 4020 }; // 5679 lo usa el task broker de n8n
const PG = { host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432), database: process.env.PGDATABASE ?? 'inmo', user: process.env.PGUSER ?? 'demo', password: process.env.PGPASSWORD ?? 'demo' };
const REDIS = { host: process.env.REDIS_HOST ?? "127.0.0.1", port: Number(process.env.REDIS_PORT ?? 6379) };
const archivo = process.argv[2] ?? 'workflows/recepcionista-inmobiliaria.json';
const run = Date.now().toString(36);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Chatwoot falso ──────────────────────────────────────────────────────────
// Registra lo que el flujo manda a /api/v1/accounts/:a/conversations/:c/(messages|toggle_typing_status)
const enviados = [];
const wa = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const [, cuenta, conv, accion] = req.url.match(/\/api\/v1\/accounts\/(\w+)\/conversations\/(\w+)\/(\w+)/) ?? [];
    enviados.push({ ruta: req.url, cuenta, conv: Number(conv), accion, token: req.headers.api_access_token, ...JSON.parse(raw || '{}'), t: Date.now() });
    res.setHeader('Content-Type', 'application/json');
    res.end('{"id":1}');
  });
});

// ── Base: esquema, migraciones y las inmobiliarias de prueba ─────────────────
// 1 = la del seed (inbox 3) · 2 = otra con su catálogo y umbral (inbox 4) · 3 = inactiva (inbox 5). El inbox 99 no tiene cliente.
async function prepararBase() {
  await db.query(readFileSync('data/schema.sql', 'utf8'));
  for (const f of readdirSync('data/migraciones').sort()) await db.query(readFileSync(`data/migraciones/${f}`, 'utf8'));
  await db.query(`INSERT INTO clientes (id, nombre, inbox_id, umbral_usd, prompt_extra, activo) VALUES
      (1, 'Inmobiliaria Demo', 3, 400000, 'Inmobiliaria de Bariloche.', true),
      (2, 'Inmobiliaria Sur', 4, 150000, 'HORARIO-SUR: lunes a viernes de 9 a 18.', true),
      (3, 'Inmobiliaria Inactiva', 5, 400000, '', false)
    ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, inbox_id = EXCLUDED.inbox_id, umbral_usd = EXCLUDED.umbral_usd,
      prompt_extra = EXCLUDED.prompt_extra, activo = EXCLUDED.activo`);
  await db.query(`SELECT setval(pg_get_serial_sequence('clientes', 'id'), (SELECT max(id) FROM clientes))`);
  await db.query(`INSERT INTO propiedades (cliente_id, codigo, titulo, operacion, tipo, zona, ambientes, dormitorios, m2_cubiertos, precio_usd, unidad_precio, url_ficha) VALUES
      (2, 'SUR-001', 'Depto 2 ambientes, Centro (Sur)', 'venta', 'departamento', 'Centro', 2, 1, 45, 140000, 'venta_total', 'https://sur.example/SUR-001'),
      (2, 'SUR-002', 'Cabaña en alquiler, Melipal (Sur)', 'alquiler', 'cabaña', 'Melipal', 3, 2, 70, 700, 'alquiler_mensual', 'https://sur.example/SUR-002')
    ON CONFLICT (cliente_id, codigo) DO NOTHING`);
}

// ── Preparar n8n: credenciales de prueba, flujo apuntando a los mocks ────────
const carpeta = mkdtempSync(join(tmpdir(), 'n8n-e2e-'));
const env = {
  ...process.env, N8N_USER_FOLDER: carpeta, N8N_PORT: String(PUERTOS.n8n), N8N_LISTEN_ADDRESS: process.env.N8N_LISTEN_ADDRESS ?? '0.0.0.0',
  N8N_DIAGNOSTICS_ENABLED: 'false', N8N_SECURE_COOKIE: 'false', N8N_ENCRYPTION_KEY: 'e2e-solo-pruebas',
  CHATWOOT_URL: `http://127.0.0.1:${PUERTOS.wa}`, N8N_BLOCK_ENV_ACCESS_IN_NODE: 'false',
};
const CREDS = {
  postgres: { id: 'cred-pg', name: 'Postgres (e2e)', data: { host: PG.host, port: PG.port, database: PG.database, user: PG.user, password: PG.password, ssl: 'disable' } },
  redis: { id: 'cred-redis', name: 'Redis (e2e)', data: { host: REDIS.host, port: REDIS.port, password: '', database: 0 } },
  openRouterApi: { id: 'cred-llm', name: 'LLM falso (e2e)', data: { apiKey: 'e2e', url: `http://127.0.0.1:${PUERTOS.llm}/v1` } },
  httpHeaderAuth: { id: 'cred-cw', name: 'Chatwoot API (e2e)', data: { name: 'api_access_token', value: 'token-e2e' } },
};
function prepararFlujo() {
  const wf = JSON.parse(readFileSync(archivo, 'utf8'));
  return { ...asignarCredenciales(wf, CREDS), id: 'recepcionistaE2E', active: false };
}

function importar() {
  const credsFile = join(carpeta, 'creds.json'), wfFile = join(carpeta, 'wf.json');
  writeFileSync(credsFile, JSON.stringify(credencialesParaImportar(CREDS)));
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
// Cada escenario es una conversación de Chatwoot con un contacto propio.
let conv = 0, mid = 0;
const base = Date.now() % 1e7;
const contacto = () => { const c = ++conv + base; return { conv: c, tel: `+549294${String(c).padStart(7, '0')}` }; };
const ASESOR = { id: 7, name: 'Asesora Demo', type: 'user' };
// Payload real de Chatwoot: un mensaje del cliente, una nota privada del asesor o un eco del propio bot.
function payload(c, texto, tipo = 'cliente') {
  const cliente = { id: c.conv, name: 'Cliente Demo', phone_number: c.tel, type: 'contact' };
  return {
    event: 'message_created', id: 9000000 + ++mid, content: texto, created_at: new Date().toISOString(),
    message_type: tipo === 'cliente' ? 'incoming' : 'outgoing', private: tipo === 'nota' || tipo === 'eco-nota',
    content_type: 'text', attachments: [], sender: tipo === 'cliente' ? cliente : ASESOR,
    account: { id: 1, name: 'Cuenta' }, inbox: { id: c.inbox ?? 3, name: 'WhatsApp' },
    conversation: { id: c.conv, inbox_id: c.inbox ?? 3, status: 'open', meta: { sender: cliente }, contact_inbox: { source_id: c.tel.slice(1) } },
  };
}
const sid = (c) => 'wa:' + c.tel.replace(/\D/g, '');

const ESCENARIOS = [
  { nombre: 'Consulta: muestra solo propiedades reales', c: contacto(),
    pasos: [[0, 'Hola, busco depto en venta en el Centro hasta 200 mil dólares']],
    chequear: (c) => [
      ['responde con propiedades del catálogo', /LCB-003/.test(c.texto) && /USD 189\.000/.test(c.texto), c.texto],
      ['guarda la precalificación', c.lead?.zona === 'Centro' && c.lead?.presupuesto_usd === 200000, JSON.stringify(c.lead)],
      ['no deriva ni pausa', c.eventos.length === 0 && c.lead?.ia_activa !== false, JSON.stringify(c.eventos)],
    ] },
  { nombre: 'Buffer: dos mensajes seguidos → una sola respuesta con ambos', c: contacto(),
    pasos: [[0, 'Hola!'], [800, 'busco alquiler en Melipal']],
    chequear: (c) => [
      ['el agente corre una sola vez', c.llm.filter((p) => !p.conResultados).length === 1, `${c.llm.filter((p) => !p.conResultados).length} turnos`],
      ['el agente recibe los dos mensajes', c.llm.some((p) => /Hola!/.test(p.user) && /Melipal/.test(p.user)), c.llm.map((p) => p.user).join(' | ')],
      ['responde con el alquiler de Melipal', /LCB-018/.test(c.texto), c.texto],
    ] },
  { nombre: 'Verificador: precio inventado sin herramienta', c: contacto(),
    pasos: [[0, '¿Qué precio aproximado tiene una casa en Catedral?']],
    chequear: (c) => [
      ['bloquea el precio inventado', !/150\.000/.test(c.texto) && /asesor/.test(c.texto), c.texto],
      ['deja nota al equipo y pausa la IA', c.eventos.some((e) => e.tipo === 'hard_fail') && c.lead?.ia_activa === false, JSON.stringify(c.eventos)],
      ['avisa al asesor con una nota privada en Chatwoot', /IA pausada/.test(c.notas) && /\/ia on/.test(c.notas), c.notas],
    ] },
  { nombre: 'Verificador: precio real alterado (125.000 → 25.000)', c: contacto(),
    pasos: [[0, 'busco depto en venta en Belgrano TRAMPA']],
    chequear: (c) => [
      ['bloquea el precio alterado', !/USD 25\.000/.test(c.texto), c.texto],
      ['deja nota al equipo', c.eventos.some((e) => e.tipo === 'hard_fail'), JSON.stringify(c.eventos)],
    ] },
  { nombre: 'Pausa humana: /ia off silencia, /ia on reactiva', c: contacto(),
    pasos: [[0, '/ia off', 'nota'], [1500, 'hola, sigue alguien? PAUSA1'], [12000, '/ia on', 'nota'], [1500, 'busco depto en venta en Ñireco']],
    chequear: (c) => [
      ['con /ia off no llama al modelo ni responde', !c.llm.some((p) => /PAUSA1/.test(p.user)), c.llm.map((p) => p.user).join(' | ')],
      ['con /ia on vuelve a responder', /LCB-004/.test(c.texto), c.texto],
    ] },
  { nombre: 'Derivación por intención (visita)', c: contacto(),
    pasos: [[0, 'Me encanta, quiero coordinar una visita']],
    chequear: (c) => [
      ['responde al cliente', c.texto.length > 0, c.texto],
      ['deriva y pausa la IA', c.eventos.some((e) => e.tipo === 'derivacion') && c.lead?.ia_activa === false, JSON.stringify({ eventos: c.eventos, lead: c.lead })],
      ['la nota privada explica el motivo', /visita/.test(c.notas), c.notas],
    ] },
  { nombre: 'Derivación por presupuesto alto (> USD 400.000)', c: contacto(),
    pasos: [[0, 'busco casa en venta en Arelauquen hasta 700 mil dólares']],
    chequear: (c) => [
      ['muestra la propiedad', /LCB-009/.test(c.texto), c.texto],
      ['deriva a un asesor', c.eventos.some((e) => e.tipo === 'derivacion'), JSON.stringify(c.eventos)],
    ] },
  { nombre: 'Eco: ignora los mensajes y notas que salen de Chatwoot', c: contacto(),
    pasos: [[0, 'Te escribe la asesora ECO1', 'eco'], [0, '🤖 IA pausada ECO2', 'eco-nota']],
    chequear: (c) => [
      ['no llama al modelo', c.llm.length === 0, c.llm.map((p) => p.user).join(' | ')],
      ['no responde ni escribe', c.enviados.length === 0, JSON.stringify(c.enviados)],
    ] },
  { nombre: 'Multi-cliente: cada inmobiliaria muestra su catálogo, con su umbral y su prompt', c: { ...contacto(), inbox: 4, cliente: 2 },
    pasos: [[0, 'Buenas, busco depto en venta en el Centro hasta 200 mil dólares']],
    chequear: (c) => [
      ['muestra el catálogo de su inmobiliaria', /SUR-001/.test(c.texto), c.texto],
      ['no muestra propiedades de otra inmobiliaria', !/LCB-/.test(c.texto), c.texto],
      ['deriva con su umbral (USD 150.000; la otra no deriva con 200.000)', c.eventos.some((e) => e.tipo === 'derivacion' && /150000/.test(e.detalle)), JSON.stringify(c.eventos)],
      ['el system prompt trae su prompt_extra', c.llm.length > 0 && c.llm.every((p) => /HORARIO-SUR/.test(p.system) && /Inmobiliaria Sur/.test(p.system)), c.llm.map((p) => p.system).join(' | ')],
    ] },
  (() => { // el mismo WhatsApp le escribe a las dos inmobiliarias
    const a = contacto(), b = { ...contacto(), tel: a.tel, inbox: 4, cliente: 2 };
    return { nombre: 'Multi-cliente: el mismo WhatsApp en dos inmobiliarias no mezcla leads ni memoria', c: b,
      pasos: [[0, 'Consulto: busco depto en venta en Belgrano', 'cliente', a], [12000, 'Consulto: tenés alquileres en Melipal?']],
      chequear: (c) => [
        ['un lead por inmobiliaria, cada uno con lo suyo', c.leads.length === 2 && c.leads.find((l) => l.cliente_id === 1)?.zona === 'Belgrano' && c.leads.find((l) => l.cliente_id === 2)?.zona === 'Melipal', JSON.stringify(c.leads)],
        ['responde con el catálogo de la segunda', /SUR-002/.test(c.texto) && !/LCB-/.test(c.texto), c.texto],
        ['la memoria de la conversación no pasa de una a otra', c.llm.some((p) => /Melipal/.test(p.user)) && !c.llm.some((p) => /Melipal/.test(p.user) && /Belgrano/.test(p.historial)), c.llm.map((p) => p.historial).join(' || ')],
      ] };
  })(),
  (() => {
    const sinCliente = { ...contacto(), inbox: 99 }, inactivo = { ...contacto(), inbox: 5 };
    return { nombre: 'Multi-cliente: un inbox sin cliente o con el cliente inactivo se ignora', c: sinCliente,
      pasos: [[0, 'busco depto en venta en el Centro INBOX99'], [0, 'busco depto en venta en el Centro INACTIVO', 'cliente', inactivo]],
      chequear: (c) => [
        ['no llama al modelo', c.llm.length === 0, c.llm.map((p) => p.user).join(' | ')],
        ['no responde ni escribe', !enviados.some((x) => [sinCliente.conv, inactivo.conv].includes(x.conv)), JSON.stringify(c.enviados)],
      ] };
  })(),
  { nombre: 'Bot de Evolution: ignora el QR y el estado de la conexión', c: { ...contacto(), tel: '+123456' },
    pasos: [[0, 'QRCode generated BOTQR1']],
    chequear: (c) => [
      ['no llama al modelo', c.llm.length === 0, c.llm.map((p) => p.user).join(' | ')],
      ['no responde ni escribe', c.enviados.length === 0, JSON.stringify(c.enviados)],
    ] },
];

async function correrEscenario(e) {
  for (const [espera, texto, tipo, c = e.c] of e.pasos) {
    await dormir(espera);
    const r = await fetch(`http://127.0.0.1:${PUERTOS.n8n}/webhook/wa-recepcionista`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload(c, texto, tipo)),
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
  await prepararBase();
  const llm = await iniciarLLM(PUERTOS.llm);
  await new Promise((r) => wa.listen(PUERTOS.wa, r));
  importar();
  n8n = await arrancarN8n();
  console.log(`n8n listo · flujo ${archivo}\n`);

  await Promise.all(ESCENARIOS.map(correrEscenario));
  await esperarSilencio(25_000, 12_000);

  let fallas = 0;
  for (const e of ESCENARIOS) {
    const propios = enviados.filter((x) => x.conv === e.c.conv);
    const mensajes = propios.filter((x) => x.accion === 'messages');
    const usados = new Set(e.pasos.filter((p) => !/^\/ia/.test(p[1])).map((p) => p[1]));
    const c = {
      enviados: propios,
      texto: mensajes.filter((x) => !x.private).map((x) => x.content).join('\n'),
      notas: mensajes.filter((x) => x.private).map((x) => x.content).join('\n'),
      lead: (await db.query('SELECT * FROM leads WHERE cliente_id = $1 AND session_id = $2', [e.c.cliente ?? 1, sid(e.c)])).rows[0],
      leads: (await db.query('SELECT * FROM leads WHERE session_id = $1', [sid(e.c)])).rows,
      eventos: (await db.query('SELECT tipo, detalle FROM eventos_equipo WHERE cliente_id = $1 AND session_id = $2', [e.c.cliente ?? 1, sid(e.c)])).rows,
      llm: pedidos.filter((p) => [...usados].some((u) => p.user.includes(u))),
    };
    console.log(e.nombre);
    for (const [desc, ok, detalle] of e.chequear(c)) {
      if (!ok) fallas++;
      console.log(`  ${ok ? '✓' : '✗'} ${desc}${ok ? '' : `\n      → ${String(detalle ?? '').replaceAll('\n', ' ⏎ ').slice(0, 300)}`}`);
    }
  }
  const sinToken = enviados.filter((x) => x.token !== 'token-e2e');
  console.log(`Chatwoot API: ${enviados.length} llamadas, ${sinToken.length ? `✗ ${sinToken.length} sin api_access_token` : '✓ todas con api_access_token'}`);
  if (sinToken.length) fallas++;
  const errores = erroresDeEjecucion();
  if (errores.length) console.log(`\nEjecuciones con error en n8n (${errores.length}):\n` + errores.map((x) => '  ' + x).join('\n'));
  console.log(`\n${fallas ? `✗ ${fallas} chequeos fallaron` : '✓ Todos los chequeos pasaron'}`);
  process.exitCode = fallas ? 1 : 0;
  llm.close();
} finally {
  n8n?.kill('SIGTERM'); // SIGTERM: con n8n-docker.sh, docker lo reenvía y el contenedor se borra
  wa.close();
  await db.end().catch(() => {});
}

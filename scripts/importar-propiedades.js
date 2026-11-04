// Carga el catálogo real de una inmobiliaria desde un CSV (p. ej. exportado de Google Sheets).
// Uso: npm run importar -- propiedades.csv --cliente <id> [--desactivar-faltantes]
//   · Se conecta a la base inmo del stack con los datos de .env (o a DATABASE_URL si está definida).
//   · Hace upsert por (cliente, código): si la propiedad existe la actualiza, si no la crea.
//   · --desactivar-faltantes: las propiedades del cliente que ya no están en el CSV quedan activa=false (vendidas, bajadas).
//   · Si alguna fila tiene errores no escribe nada y lista qué corregir.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { conexionInmo } from './lib.js';

const [archivo, ...flags] = process.argv.slice(2);
const clienteId = Number(flags[flags.indexOf('--cliente') + 1]);
if (!archivo || !flags.includes('--cliente') || !Number.isInteger(clienteId)) {
  console.error('Uso: npm run importar -- propiedades.csv --cliente <id> [--desactivar-faltantes]');
  process.exit(1);
}

/** CSV con comillas, comas o punto y coma como separador (Sheets en español exporta con ;). */
function leerCSV(texto) {
  texto = texto.replace(/^\uFEFF/, '');
  const sep = (texto.split('\n')[0].match(/;/g) ?? []).length > (texto.split('\n')[0].match(/,/g) ?? []).length ? ';' : ',';
  const filas = [];
  let fila = [], campo = '', comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (comillas) {
      if (ch === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') comillas = false;
      else campo += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) { fila.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); campo = '';
      if (fila.some((c) => c.trim())) filas.push(fila);
      fila = [];
    } else campo += ch;
  }
  fila.push(campo);
  if (fila.some((c) => c.trim())) filas.push(fila);
  const [cabecera, ...resto] = filas;
  const cols = cabecera.map((c) => c.trim().toLowerCase());
  return resto.map((f) => Object.fromEntries(cols.map((c, i) => [c, (f[i] ?? '').trim()])));
}

const OBLIGATORIAS = ['codigo', 'titulo', 'operacion', 'tipo', 'zona', 'precio_usd', 'url_ficha'];
const entero = (v) => {
  if (v === '' || v == null) return null;
  const limpio = String(v).replace(/usd|u\$s|\$|\s|\./gi, ''); // "USD 150.000" → 150000
  return /^\d+$/.test(limpio) ? Number(limpio) : NaN;
};
const booleano = (v, def) => (v === '' || v == null ? def : /^(si|sí|true|1|x)$/i.test(v));

const filas = leerCSV(readFileSync(archivo, 'utf8'));
const errores = [];
const props = filas.map((f, i) => {
  const linea = i + 2;
  for (const c of OBLIGATORIAS) if (!f[c]) errores.push(`línea ${linea}: falta "${c}"`);
  const operacion = (f.operacion ?? '').toLowerCase();
  if (operacion && !['venta', 'alquiler'].includes(operacion)) errores.push(`línea ${linea}: operacion debe ser venta o alquiler (dice "${f.operacion}")`);
  const p = {
    codigo: f.codigo, titulo: f.titulo, operacion, tipo: (f.tipo ?? '').toLowerCase(), zona: f.zona,
    ambientes: entero(f.ambientes) ?? 0, dormitorios: entero(f.dormitorios) ?? 0, m2_cubiertos: entero(f.m2_cubiertos) ?? 0,
    precio_usd: entero(f.precio_usd),
    unidad_precio: f.unidad_precio || (operacion === 'alquiler' ? 'alquiler_mensual' : 'venta_total'),
    expensas_usd: entero(f.expensas_usd),
    direccion_aprox: f.direccion_aprox || null, descripcion: f.descripcion || null, url_ficha: f.url_ficha,
    destacada: booleano(f.destacada, false), activa: booleano(f.activa, true),
  };
  for (const c of ['ambientes', 'dormitorios', 'm2_cubiertos', 'precio_usd', 'expensas_usd']) {
    if (Number.isNaN(p[c])) errores.push(`línea ${linea}: "${c}" no es un número (dice "${f[c]}")`);
  }
  if (!['venta_total', 'alquiler_mensual'].includes(p.unidad_precio)) errores.push(`línea ${linea}: unidad_precio debe ser venta_total o alquiler_mensual`);
  return p;
});
const repetidos = props.map((p) => p.codigo).filter((c, i, a) => c && a.indexOf(c) !== i);
if (repetidos.length) errores.push(`códigos repetidos: ${[...new Set(repetidos)].join(', ')}`);

if (errores.length) {
  console.error(`✗ No se importó nada. Corregí el CSV:\n  ${errores.join('\n  ')}`);
  process.exit(1);
}

const db = new pg.Client(conexionInmo());
await db.connect();
const { rows: [cliente] } = await db.query('SELECT nombre FROM clientes WHERE id = $1', [clienteId]);
if (!cliente) {
  console.error(`✗ No existe el cliente ${clienteId}. Mirá los ids con: npm run clientes`);
  process.exit(1);
}
const COLS = ['cliente_id', ...Object.keys(props[0] ?? { codigo: 0 })];
try {
  await db.query('BEGIN');
  for (const p of props) {
    await db.query(
      `INSERT INTO propiedades (${COLS.join(', ')}) VALUES (${COLS.map((_, i) => '$' + (i + 1)).join(', ')})
       ON CONFLICT (cliente_id, codigo) DO UPDATE SET ${COLS.filter((c) => !['cliente_id', 'codigo'].includes(c)).map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`,
      COLS.map((c) => (c === 'cliente_id' ? clienteId : p[c])),
    );
  }
  let bajas = 0;
  if (flags.includes('--desactivar-faltantes')) {
    bajas = (await db.query('UPDATE propiedades SET activa = false WHERE cliente_id = $1 AND activa AND NOT (codigo = ANY($2))', [clienteId, props.map((p) => p.codigo)])).rowCount;
  }
  await db.query('COMMIT');
  const { rows } = await db.query('SELECT count(*)::int AS n FROM propiedades WHERE cliente_id = $1 AND activa', [clienteId]);
  console.log(`✓ ${cliente.nombre}: ${props.length} propiedades importadas${bajas ? `, ${bajas} desactivadas` : ''} · ${rows[0].n} activas en su catálogo`);
} catch (e) {
  await db.query('ROLLBACK');
  console.error('✗ Error, no se guardó nada:', e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}

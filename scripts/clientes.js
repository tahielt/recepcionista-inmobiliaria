// npm run clientes                      → lista las inmobiliarias con su estado
// npm run clientes -- --desactivar <id> → el bot deja de atender ese inbox (--activar <id> lo vuelve a prender)
import pg from 'pg';
import { clienteEvolution, conexionInmo, leerEnv, slug } from './lib.js';

const [accion, id] = process.argv.slice(2);
const env = leerEnv();
const db = new pg.Client(conexionInmo(env));
await db.connect();
if (accion === '--activar' || accion === '--desactivar') {
  const { rowCount } = await db.query('UPDATE clientes SET activo = $1 WHERE id = $2', [accion === '--activar', Number(id)]);
  console.log(rowCount ? `✓ Cliente ${id} ${accion === '--activar' ? 'activado' : 'desactivado'}` : `✗ No existe el cliente ${id}`);
}
const { rows } = await db.query(`
  SELECT c.id, c.nombre, c.inbox_id, c.umbral_usd, c.horas_reactivacion AS horas, c.activo,
    (SELECT count(*) FROM propiedades p WHERE p.cliente_id = c.id AND p.activa)::int AS propiedades,
    (SELECT count(*) FROM leads l WHERE l.cliente_id = c.id)::int AS leads
  FROM clientes c ORDER BY c.id`);
await db.end();
const estados = Object.fromEntries((await clienteEvolution(env)('/instance/fetchInstances').catch(() => [])).map((i) => [i.name, i.connectionStatus]));
console.table(rows.map((c) => ({ ...c, whatsapp: estados[slug(c.nombre)] ?? '—' })));

// npm run nuevo-cliente -- "Nombre" [--umbral 400000] [--asesor "+54 9 294 400-0000"] [--horas 12] [--prompt "texto" | --prompt-archivo datos.txt]
// Crea la instancia de WhatsApp en Evolution (que crea el inbox en Chatwoot), da de alta al cliente y muestra el QR.
// Si el cliente ya existe, actualiza solo los datos que le pases y vuelve a mostrar el QR.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { conexionInmo, instanciaConInbox, leerEnv, mostrarQR, slug } from './lib.js';

const args = process.argv.slice(2);
const opcion = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const nombre = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!nombre) {
  console.error('Uso: npm run nuevo-cliente -- "Nombre" [--umbral 400000] [--asesor "+54 9 …"] [--horas 12] [--prompt "…" | --prompt-archivo archivo.txt]');
  process.exit(1);
}
const env = leerEnv();
if (!env.CHATWOOT_API_TOKEN) throw new Error('Falta CHATWOOT_API_TOKEN en .env: corré primero npm run instalar');
const numero = (k) => (opcion(k) == null ? null : Number(opcion(k)));
const prompt = opcion('prompt-archivo') ? readFileSync(opcion('prompt-archivo'), 'utf8').trim() : opcion('prompt') ?? null;
const instancia = slug(nombre);

console.log(`▸ WhatsApp: instancia "${instancia}" en Evolution e inbox "${nombre}" en Chatwoot`);
const { inbox } = await instanciaConInbox(env, instancia, nombre);

const db = new pg.Client(conexionInmo(env));
await db.connect();
const { rows: [cliente] } = await db.query(
  `INSERT INTO clientes (nombre, inbox_id, umbral_usd, telefono_asesor, prompt_extra, horas_reactivacion)
   VALUES ($1, $2, COALESCE($3::int, 400000), $4::text, COALESCE($5::text, ''), COALESCE($6::int, 12))
   ON CONFLICT (inbox_id) DO UPDATE SET nombre = EXCLUDED.nombre, activo = true,
     umbral_usd = COALESCE($3::int, clientes.umbral_usd),
     telefono_asesor = COALESCE($4::text, clientes.telefono_asesor),
     prompt_extra = COALESCE($5::text, clientes.prompt_extra),
     horas_reactivacion = COALESCE($6::int, clientes.horas_reactivacion)
   RETURNING *, (xmax = 0) AS nuevo`,
  [nombre, inbox.id, numero('umbral'), opcion('asesor') ?? null, prompt, numero('horas')],
);
await db.end();
console.log(`▸ Cliente ${cliente.nuevo ? 'creado' : 'actualizado'}: id ${cliente.id} · inbox ${cliente.inbox_id} · umbral USD ${cliente.umbral_usd}` +
  ` · IA vuelve sola ${cliente.horas_reactivacion ? `a las ${cliente.horas_reactivacion} h` : 'solo con /ia on'}` +
  `${cliente.telefono_asesor ? ` · asesor ${cliente.telefono_asesor}` : ''}`);

console.log('▸ WhatsApp');
await mostrarQR(env, instancia);
console.log(`\nCatálogo: npm run importar -- propiedades.csv --cliente ${cliente.id}`);

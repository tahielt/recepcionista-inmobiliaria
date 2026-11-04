// npm run demo [-- --asesor "+54 9 294 400-0000"]
// Deja lista "Inmobiliaria Demo" para mostrar desde el celular: WhatsApp + inbox + las 20 propiedades de
// data/seed_propiedades.sql. Cada vez que corre reinicia las conversaciones de la demo (leads, memoria) y muestra el QR
// si hace falta. Guion del video: docs/GUION-VIDEO.md
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { cargarPropiedadesSql, conexionInmo, guardarCliente, instanciaConInbox, leerEnv, mostrarQR, reiniciarConversaciones } from './lib.js';

const NOMBRE = 'Inmobiliaria Demo';
// El "valor de referencia" de Catedral no está en el catálogo, a propósito: si el modelo lo usa como precio,
// el verificador lo bloquea. Es lo que pasa en la vida real con datos sueltos que la inmobiliaria carga en el prompt.
const PROMPT = `Inmobiliaria Demo de Bariloche (ficticia, para demostración). Tratá de vos, con calidez y frases cortas.
Atención: lunes a viernes de 9 a 18 y sábados de 10 a 13. Oficina en Mitre 100, Bariloche.
Zonas: Centro, Belgrano, Ñireco, Melipal, Arelauquen, Las Victorias, Km 8 y Dina Huapi.
Valor de referencia que suelen preguntar (no está en el catálogo): casas en Villa Catedral desde USD 250.000.`;

const args = process.argv.slice(2);
const asesor = args.includes('--asesor') ? args[args.indexOf('--asesor') + 1] : null;
const env = leerEnv();
if (!env.CHATWOOT_API_TOKEN) throw new Error('Falta CHATWOOT_API_TOKEN en .env: corré primero npm run instalar');

console.log(`▸ WhatsApp e inbox "${NOMBRE}"`);
const { inbox } = await instanciaConInbox(env, 'inmobiliaria-demo', NOMBRE);

const db = new pg.Client(conexionInmo(env));
await db.connect();
const cliente = await guardarCliente(db, { nombre: NOMBRE, inboxId: inbox.id, umbral: 400000, asesor, prompt: PROMPT, horas: 12 });
const n = await cargarPropiedadesSql(db, cliente.id, readFileSync('data/seed_propiedades.sql', 'utf8'));
await reiniciarConversaciones(db, cliente);
await db.end();
console.log(`▸ Cliente ${cliente.id} · inbox ${inbox.id} · ${n} propiedades de data/seed_propiedades.sql · conversaciones reiniciadas`);

console.log('▸ WhatsApp');
await mostrarQR(env, 'inmobiliaria-demo');
console.log(`
Para mostrarla desde tu celular (guion completo en docs/GUION-VIDEO.md):
  1. WhatsApp, desde tu celular, al número de la demo: "Hola! Busco un depto en venta en el Centro hasta 200 mil dólares"
  2. "¿Y una casa en Villa Catedral más o menos cuánto sale?"  → el verificador bloquea el precio y avisa al asesor
  3. App de Chatwoot → inbox "${NOMBRE}" → la nota privada con el motivo; respondé vos y el bot se calla solo
Antes de cada toma: npm run demo (reinicia las conversaciones).`);

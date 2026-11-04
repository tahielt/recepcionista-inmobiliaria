# SPEC — Recepcionista IA Inmobiliaria (WhatsApp)

> Proyecto de portfolio. Inmobiliaria **FICTICIA** de Bariloche ("Inmobiliaria Demo").
> Todo sintético: propiedades, precios, teléfonos y conversaciones son inventados.

## Qué hace
Agente de WhatsApp que atiende, **precalifica** al lead y **muestra propiedades reales del
catálogo** (nunca inventadas), con traspaso a humano y un **verificador anti-alucinación** que
bloquea cualquier precio o link que no haya salido de una herramienta en ese turno.

## Alcance funcional
1. **Entrada WhatsApp** vía webhook de Chatwoot (`message_created`; WhatsApp conectado con Evolution API).
   Solo procesa mensajes `incoming` del cliente y notas privadas `/ia on|off`; ignora el eco del propio
   bot, el contacto bot de Evolution y actividades. `session_id = wa:<teléfono del contacto>`.
   **Multi-cliente:** la inmobiliaria se resuelve por `inbox_id` en la tabla `clientes`; si el inbox no
   tiene un cliente activo, el mensaje se ignora. Leads, catálogo, eventos, buffer y memoria van por cliente.
   Salida por la API de Chatwoot: `toggle_typing_status`, mensajes y notas privadas al equipo.
2. **Precalificación** (slots): `operacion` (compra/alquiler), `zona`, `presupuesto_usd`,
   `ambientes`, `forma_pago`, `urgencia`. Se persisten en `leads`; no se vuelve a preguntar lo ya sabido.
3. **Búsqueda en catálogo** (`propiedades` en Postgres/Supabase): filtra por operación, zona,
   dormitorios/ambientes y presupuesto. Devuelve máximo 3, con código, precio y `url_ficha`.
4. **Derivación a humano** si `presupuesto_usd > clientes.umbral_usd` (def. 400.000 USD) o el cliente lo pide:
   marca `derivado`, pausa la IA y deja nota privada en Chatwoot con el motivo.

## Patrones reusados (de PATRONES.md)
- **Patrón 1 — Buffer de mensajes:** Redis push a `buf:<session>` → Wait 7 s → compara último
  `message_id`; si llegó otro, esta ejecución descarta.
- **Patrón 2 — Pausa humana:** flag `leads.ia_activa`. Comando por nota privada `/ia on` · `/ia off`.
  Si `ia_activa=false`, el agente no responde.
- **Patrón 3 — Salida humanizada:** respuesta partida en mensajes ≤250 caracteres, enviados de a
  uno con "escribiendo…" y ~3 s de pausa.
- **Patrón 4 — Verificador anti-alucinación (pieza estrella):** nodo Code DESPUÉS del agente que
  lee `intermediateSteps`. Cada precio (`USD`, `$`) y cada link del mensaje tiene que aparecer en
  el resultado de una tool de ESTE turno. Si no → `hardFail`: reemplaza el mensaje por
  "dejame confirmarlo con un asesor" y registra nota privada. El agente corre con
  `returnIntermediateSteps: true`.

## Modelo y memoria
- LLM vía **OpenRouter**. Modelo por defecto: **`nvidia/nemotron-3-super-120b-a12b:free`**
  (gratis y con tool-calling; DeepSeek ya no tiene variante free en OpenRouter). Es un solo campo
  en el nodo "OpenRouter Model": se cambia por cualquier otro slug en segundos.
- Memoria de conversación del agente en **Redis** (Redis Chat Memory por `session_id`).
- Probado end-to-end: el agente llama `buscar_propiedades`, usa solo datos del catálogo, guarda la
  precalificación y el verificador deja pasar precios reales / bloquea inventados.

## Datos
- `data/schema.sql` + `data/migraciones/` — tablas `clientes`, `propiedades`, `leads`, `eventos_equipo` (con `cliente_id`).
- `data/seed_propiedades.sql` — 20 propiedades sintéticas de Bariloche (venta y alquiler, USD).

## Credenciales
- **Postgres** (catálogo + leads) · **Redis** (buffer + memoria) · **OpenRouter** (LLM) ·
  **Header Auth** `api_access_token` (API de Chatwoot).
- `npm run instalar` las crea por CLI a partir de `.env`. Ningún secreto va escrito en el flujo ni
  en el repo: queda encriptado en la base de n8n; el JSON solo guarda la referencia por nombre.
- La URL de Chatwoot es configuración: variable `CHATWOOT_URL` del contenedor de n8n.

## Reglas anti-alucinación (resumen de negocio)
- No se afirma ningún precio, dirección o disponibilidad que no esté en `propiedades`.
- Ante duda o dato faltante: ofrecer derivar a un asesor, nunca inventar.
- El umbral de derivación es de cada cliente (`clientes.umbral_usd`); la ventana de buffer está en el nodo "Esperar buffer".

# Guion del video (60 segundos)

Muestra todo lo que vende el producto en una sola conversación: una consulta, las propiedades
reales del catálogo, un precio inventado que el verificador bloquea y la derivación a un asesor con
nota privada en Chatwoot.

## Antes de grabar

- [ ] `npm run demo`: deja "Inmobiliaria Demo" con las 20 propiedades del seed y **reinicia las
      conversaciones** (leads y memoria). Corrélo antes de cada toma.
- [ ] El WhatsApp de la demo conectado: `npm run clientes` tiene que mostrar `whatsapp: open`. Si no,
      `npm run demo` muestra el QR.
- [ ] **Celular A** (el "cliente"): WhatsApp abierto en el chat con el número de la demo.
- [ ] **Celular B** (el "asesor"): app de Chatwoot abierta en el inbox "Inmobiliaria Demo". Sirve
      también Chatwoot en la compu, grabando la pantalla.
- [ ] Grabación de pantalla en los dos, y notificaciones silenciadas.
- [ ] Ensayalo una vez. El modelo es real, así que las respuestas cambian un poco entre tomas.

## Toma (≈ 60 s)

| Tiempo | Pantalla | Acción | Texto en pantalla / voz en off |
|---|---|---|---|
| 0–5 s | Celular A | Chat vacío con "Inmobiliaria Demo" | **"Tu inmobiliaria responde WhatsApp 24/7. Con tu catálogo real."** |
| 5–20 s | Celular A | Escribís: *Hola! Busco un depto en venta en el Centro hasta 200 mil dólares*. A los ~10 s llegan 2 o 3 propiedades con código, precio y link | "Muestra **solo propiedades que existen**: código, precio y ficha, sacados de la planilla de la inmobiliaria." |
| 20–35 s | Celular A | Escribís: *¿Y una casa en Villa Catedral más o menos cuánto sale?*. Responde *"prefiero no pasarte un dato sin confirmarlo, ya le aviso a un asesor"* | **"No inventa precios."** El modelo intentó contestar con un número que no está en el catálogo, y el verificador lo bloqueó antes de que llegue al cliente. |
| 35–48 s | Celular B | En Chatwoot, la conversación con la **nota privada**: *🤖 IA pausada… Motivo: Verificador bloqueó la respuesta: "USD 250.000" no sale de los datos* | "Y deriva al asesor, con el motivo, en la app de Chatwoot." |
| 48–55 s | Celular B → A | El asesor responde desde Chatwoot: *Hola, soy Laura, te paso opciones en Catedral*. En el celular A llega el mensaje | **"Cuando escribe una persona, el bot se calla solo."** |
| 55–60 s | Placa final | — | **"Una instalación, todas tus inmobiliarias. Sin inventos."** + tu contacto |

## Por qué el precio de Catedral se bloquea

En la demo, el `prompt_extra` de "Inmobiliaria Demo" (`scripts/demo.js`) trae un "valor de
referencia" de Villa Catedral que **no está en el catálogo**. Pasa en la vida real: la inmobiliaria
carga datos sueltos y el modelo los repite como si fueran precios. El verificador solo deja pasar
montos que salieron de `buscar_propiedades` en ese turno, así que lo bloquea, pausa la IA y deja la
nota privada.

Con un modelo real no es 100 % determinístico. Si en una toma el bot no da un número y solo ofrece
un asesor, también está bien: no inventó. Para la toma, insistí con *"¿aunque sea un número
aproximado?"* o corré `npm run demo` y repetí. Lo determinístico está probado en `npm run test:e2e`.

## Variante: derivación por intención

En lugar del precio, *"Me encanta el de vista al lago, ¿puedo coordinar una visita el sábado?"*. El
bot responde, se pausa y deja la nota privada *"Derivación por intención del cliente
(visita/oferta/asesor)"*.

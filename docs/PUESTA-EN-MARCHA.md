# Puesta en marcha (WhatsApp real)

Recorrido de un mensaje:

```
Cliente (WhatsApp) → Evolution API → Chatwoot → webhook n8n → agente → Chatwoot API → Evolution → WhatsApp
```

Chatwoot es el inbox del equipo: el asesor ve todo desde la app del celular, toma la
conversación cuando quiere y el bot le deja notas privadas cuando deriva.

## Qué necesitás

- **n8n** 2.x, con Postgres y Redis.
- **Evolution API** v2 con un número de WhatsApp conectado.
- **Chatwoot** (puede ser el mismo que ya usás, con un inbox nuevo).
- Una **API key de OpenRouter**.

## 1. Base de datos

En la Postgres que va a usar el flujo, corré el esquema:

```bash
psql "$DATABASE_URL" -f data/schema.sql
```

Después cargá el catálogo real. Pedile a la inmobiliaria una planilla con las columnas de
`data/plantilla-propiedades.csv`, exportala como CSV y corré:

```bash
npm install
DATABASE_URL=postgres://user:pass@host:5432/db npm run importar -- propiedades.csv --desactivar-faltantes
```

- Si una fila tiene errores, el script no escribe nada y te dice qué corregir.
- Para actualizar precios o dar de baja propiedades vendidas, se vuelve a correr con la planilla nueva.
- `--desactivar-faltantes` saca del catálogo lo que ya no está en la planilla.
- Para una demo usá `data/seed_propiedades.sql` en lugar de la planilla.

## 2. WhatsApp → Chatwoot

1. En Chatwoot, creá el inbox desde la integración de Chatwoot de Evolution, igual que en Magda: URL de Chatwoot, account id y token, con creación automática del inbox.
2. Escribile al número desde otro celular y confirmá que el mensaje aparece en Chatwoot.
3. Anotá el **id del inbox**: está en la URL de *Settings → Inboxes → (el inbox)*, en `.../inboxes/3`.

## 3. n8n

1. Importá `workflows/recepcionista-inmobiliaria.json`.
2. Creá las credenciales y elegilas en sus nodos:

   | Credencial | Nodos |
   |---|---|
   | **Postgres** | Set ia_activa, Chequear ia_activa, buscar_propiedades, guardar_precalificacion, Nota al equipo + pausa |
   | **Redis** | los 5 de Buffer y Memoria (Redis) |
   | **OpenRouter** | OpenRouter Model |
   | **Header Auth**, con Name `api_access_token` y Value igual al token de Chatwoot (*Profile settings → Access Token*) | Chatwoot: escribiendo…, Chatwoot: enviar mensaje, Chatwoot: nota privada |

3. En el nodo **Normalizar entrada**, completá las 3 constantes de arriba:
   - `CHATWOOT_URL`: por ejemplo `https://chat.tudominio.com`, sin barra final.
   - `INBOX_ID`: el id del paso 2. **Es obligatorio si el mismo Chatwoot atiende otros números**, como los de Magda: si no lo ponés, el bot les responde a todos.
   - `UMBRAL_USD`: el presupuesto desde el que deriva a un asesor.
4. Activá el flujo (*Publish*) y copiá la **Production URL** del nodo *Chatwoot webhook*. Termina en `/webhook/wa-recepcionista`.

## 4. Chatwoot → n8n

En *Settings → Integrations → Webhooks → Add new webhook*:

- URL: la Production URL del paso anterior.
- Evento: **Message created** y nada más.

## 5. Probarlo

Desde otro celular, escribí *"Hola, busco depto en venta en el Centro hasta 200 mil dólares"*.
A los ~7 segundos responde con propiedades de la base.

Si no responde, revisá en este orden:

1. *Executions* en n8n: si no hay ejecución, el webhook de Chatwoot está mal.
2. Si la ejecución terminó en *Fin (ignorado)*, el `INBOX_ID` no coincide.
3. Si falla en un nodo de Chatwoot, revisá el token o la `CHATWOOT_URL`.

## Operarlo desde el celular

Con la app de Chatwoot (Android/iOS) el asesor maneja todo:

| Acción | Cómo |
|---|---|
| Tomar una conversación | nota privada `/ia off` y responder normalmente |
| Devolvérsela al bot | nota privada `/ia on` |
| Derivaciones | el bot se pausa solo y deja una nota privada con el motivo: visita, oferta, presupuesto alto o un dato que no pudo confirmar |

El bot no se pausa solo cuando un asesor escribe sin la nota `/ia off`. Hay que mandarla.

## Modelo

El flujo trae `nvidia/nemotron-3-super-120b-a12b:free`, que alcanza para una demo. Con un
cliente que paga usá un modelo pago barato con tool-calling, porque los gratuitos tienen límites
diarios y se caen en horas pico. Se cambia en el nodo **OpenRouter Model**. El verificador
anti-alucinación funciona igual con cualquier modelo.

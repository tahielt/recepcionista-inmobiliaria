# Puesta en marcha (WhatsApp real)

Recorrido de un mensaje:

```
Cliente (WhatsApp) → Evolution API → Chatwoot → webhook n8n → agente → Chatwoot API → Evolution → WhatsApp
```

Chatwoot es el inbox del equipo: el asesor ve todo desde la app del celular, toma la
conversación cuando quiere y el bot le deja notas privadas cuando deriva.

## Qué necesitás

- Una PC o VPS con **Docker** y **8 GB de RAM**. Todo el stack, propio y sin compartir nada con
  otros proyectos, usa unos 2,5 GB (ver tabla abajo).
- Un número de WhatsApp para conectar con Evolution.
- Una **API key de OpenRouter**.
- Opcional: un dominio en Cloudflare para entrar desde el celular con `chat.tudominio.com`.

## 1. Levantar el stack

```bash
cp .env.example .env      # completá los secretos: openssl rand -hex 32 para cada uno
docker compose up -d --wait
```

`--wait` termina cuando todos los servicios están sanos. La primera vez tarda unos minutos,
porque baja las imágenes y Chatwoot prepara su base.

| Servicio | URL en la PC | Qué es |
|---|---|---|
| Chatwoot | http://localhost:3000 | inbox del equipo (web + sidekiq) |
| n8n | http://localhost:5678 | el flujo del recepcionista (+ `n8n-runner` para los nodos Code) |
| Evolution API | http://localhost:8080 | conexión con WhatsApp |
| Postgres | `127.0.0.1:5433` | bases `n8n`, `inmo`, `chatwoot` y `evolution` |
| Redis | solo red interna | base 0 Chatwoot, 1 flujo de n8n, 6 Evolution |

Los puertos solo se publican en `127.0.0.1`. Desde afuera se entra con el túnel (paso 6).
Entre ellos los servicios se hablan por la red interna de Docker: `http://chatwoot-web:3000`,
`http://n8n:5678` y `http://evolution:8080`.

Abrí http://localhost:3000. La primera vez Chatwoot pide crear el **usuario administrador** y
la cuenta.

Si Chatwoot no arranca, probalo solo antes de seguir:
`docker compose up -d --wait chatwoot-web chatwoot-sidekiq`. Eso levanta únicamente Postgres,
Redis y Chatwoot. Los logs están en `docker compose logs chatwoot-init chatwoot-web`.

### Memoria (medido con `docker stats`)

| Servicio | RAM en reposo |
|---|---|
| chatwoot-sidekiq | ~450 MB |
| chatwoot-web | ~415 MB |
| n8n | ~320 MB |
| evolution | ~225 MB |
| n8n-runner | ~100 MB (solo mientras corre un nodo Code; si no, ~7 MB) |
| postgres | ~95 MB |
| redis | ~5 MB |
| **Total** | **~1,6 GB** |

Con conversaciones reales Chatwoot crece; calculá unos 2,5–3 GB en total. En una PC de 8 GB
sobra lugar. En Windows o Mac, Docker Desktop corre en una máquina virtual que por defecto usa la
mitad de la RAM (4 GB), y alcanza. Las imágenes ocupan unos 8 GB de disco.

## 2. Base de datos

Aplicá el esquema en la base `inmo`:

```bash
docker compose exec -T postgres psql -U postgres -d inmo < data/schema.sql
```

Después cargá el catálogo real. Pedile a la inmobiliaria una planilla con las columnas de
`data/plantilla-propiedades.csv`, exportala como CSV y corré:

```bash
npm install
DATABASE_URL=postgres://postgres:TU_POSTGRES_PASSWORD@127.0.0.1:5433/inmo npm run importar -- propiedades.csv --desactivar-faltantes
```

- Si una fila tiene errores, el script no escribe nada y te dice qué corregir.
- Para actualizar precios o dar de baja propiedades vendidas, se vuelve a correr con la planilla nueva.
- `--desactivar-faltantes` saca del catálogo lo que ya no está en la planilla.
- Para una demo usá `data/seed_propiedades.sql` en lugar de la planilla.

## 3. WhatsApp → Chatwoot

1. En Chatwoot, en *Profile settings*, copiá tu **Access Token**.
2. Creá la instancia en Evolution con la integración de Chatwoot (URL `http://chatwoot-web:3000`,
   account id y token, con creación automática del inbox) y escaneá el QR desde el WhatsApp de
   la inmobiliaria.
3. Escribile al número desde otro celular y confirmá que el mensaje aparece en Chatwoot.
4. Anotá el **id del inbox**: está en la URL de *Settings → Inboxes → (el inbox)*, en `.../inboxes/3`.

## 4. n8n

1. Abrí http://localhost:5678, creá el usuario e importá `workflows/recepcionista-inmobiliaria.json`.
2. Creá las credenciales y elegilas en sus nodos:

   | Credencial | Datos | Nodos |
   |---|---|---|
   | **Postgres** | host `postgres`, base `inmo`, usuario y clave del `.env` | Set ia_activa, Chequear ia_activa, buscar_propiedades, guardar_precalificacion, Nota al equipo + pausa |
   | **Redis** | host `redis`, clave `REDIS_PASSWORD`, base `1` | los 5 de Buffer y Memoria (Redis) |
   | **OpenRouter** | tu API key | OpenRouter Model |
   | **Header Auth** | Name `api_access_token`, Value el token de Chatwoot | Chatwoot: escribiendo…, Chatwoot: enviar mensaje, Chatwoot: nota privada |

3. En el nodo **Normalizar entrada**, completá las 3 constantes de arriba:
   - `CHATWOOT_URL`: `http://chatwoot-web:3000`, la red interna, sin barra final.
   - `INBOX_ID`: el id del paso 3. Si el Chatwoot atiende más de un número, es obligatorio: sin él, el bot les responde a todos.
   - `UMBRAL_USD`: el presupuesto desde el que deriva a un asesor.
4. Activá el flujo (*Publish*).

## 5. Chatwoot → n8n

En *Settings → Integrations → Webhooks → Add new webhook*:

- URL: `http://n8n:5678/webhook/wa-recepcionista`, por la red interna.
- Evento: **Message created** y nada más.

## 6. Probarlo

Desde otro celular, escribí *"Hola, busco depto en venta en el Centro hasta 200 mil dólares"*.
A los ~7 segundos responde con propiedades de la base.

Si no responde, revisá en este orden:

1. *Executions* en n8n: si no hay ejecución, el webhook de Chatwoot está mal.
2. Si la ejecución terminó en *Fin (ignorado)*, el `INBOX_ID` no coincide.
3. Si falla en un nodo de Chatwoot, revisá el token o la `CHATWOOT_URL`.
4. `docker compose ps`: todos los servicios tienen que figurar `healthy`.

## 7. Entrar desde el celular (túnel de Cloudflare)

La app de Chatwoot necesita una URL pública. Hay dos formas:

**Con tu dominio.** Necesitás el dominio en Cloudflare.
1. En Cloudflare Zero Trust, en *Networks → Tunnels*, creá un túnel y copiá el token en
   `CLOUDFLARE_TUNNEL_TOKEN`.
2. En el túnel, agregá los *public hostnames*:
   - `chat.tudominio.com` → `http://chatwoot-web:3000`
   - `n8n.tudominio.com` → `http://n8n:5678`
3. En `.env`, poné `CHATWOOT_URL_PUBLICA=https://chat.tudominio.com` y
   `N8N_URL_PUBLICA=https://n8n.tudominio.com`.
4. Levantá todo con el túnel: `docker compose --profile tunel up -d --wait`.

**Sin dominio (quick tunnel, para probar).**

```bash
docker compose --profile tunel-rapido up -d
docker compose logs tunel-rapido | grep trycloudflare.com
```

Te da una URL `https://….trycloudflare.com` hacia Chatwoot, que cambia cada vez que se reinicia.
Cloudflare no le da garantía de disponibilidad, así que no sirve para producción. n8n queda solo
en la PC porque el celular no lo necesita.

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

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

## 1. Instalar: `npm run instalar`

```bash
npm install
npm run instalar
```

El script es **idempotente**: se puede correr las veces que haga falta y no duplica nada. La
primera vez se frena para pedirte lo único manual:

1. Abrí http://localhost:3000 y creá tu **usuario administrador** de Chatwoot.
2. En Chatwoot, en *tu perfil → Access Token*, copiá el token en `.env` como `CHATWOOT_API_TOKEN`.
3. Pegá tu API key de OpenRouter en `.env` como `OPENROUTER_API_KEY`.

Volvé a correr `npm run instalar` y **escaneá el QR** que aparece en la terminal desde el WhatsApp
de la inmobiliaria: *Dispositivos vinculados → Vincular un dispositivo*. Si el QR vence, corré
`npm run instalar` otra vez. También aparece en Chatwoot, en la conversación con "EvolutionAPI".

Qué hace, en orden:

| Paso | Cómo |
|---|---|
| `.env` | si no existe, lo crea desde `.env.example` con los 6 secretos generados al azar |
| Stack | `docker compose up -d --wait`: espera a que todo esté sano |
| Base de Chatwoot | la prepara el servicio `chatwoot-init` (`db:chatwoot_prepare`, idempotente) |
| Base `inmo` | aplica `data/schema.sql` |
| Webhook | crea por API el webhook `message_created` de Chatwoot → `http://n8n:5678/webhook/wa-recepcionista` |
| WhatsApp | crea la instancia de Evolution con la integración de Chatwoot, que crea el inbox |
| n8n | importa las credenciales (Postgres, Redis, OpenRouter, Chatwoot) y el flujo por CLI, lo publica y reinicia n8n |
| QR | lo muestra si el número todavía no está conectado |

Cada vez que corre, `instalar` pisa el flujo de n8n con el del repo. Los cambios se hacen en
`workflows/recepcionista-inmobiliaria.json`.

| Servicio | URL en la PC | Qué es |
|---|---|---|
| Chatwoot | http://localhost:3000 | inbox del equipo (web + sidekiq) |
| n8n | http://localhost:5678 | el flujo del recepcionista (+ `n8n-runner` para los nodos Code) |
| Evolution API | http://localhost:8080 | conexión con WhatsApp (header `apikey: EVOLUTION_API_KEY`) |
| Postgres | `127.0.0.1:5433` | bases `n8n`, `inmo`, `chatwoot` y `evolution` |
| Redis | solo red interna | base 0 Chatwoot, 1 flujo de n8n, 6 Evolution |

Los puertos solo se publican en `127.0.0.1`. Desde afuera se entra con el túnel (paso 4).
Entre ellos los servicios se hablan por la red interna de Docker: `http://chatwoot-web:3000`,
`http://n8n:5678` y `http://evolution:8080`. Por eso Chatwoot corre con
`SAFE_FETCH_ALLOW_PRIVATE_NETWORK=true`: desde la versión 4 bloquea los webhooks a IPs
privadas, y esta variable de su `.env.example` oficial lo habilita.

Para ver el flujo en n8n, entrá a http://localhost:5678 y creá tu usuario. Es opcional: el flujo
funciona sin eso.

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

## 2. Cargar el catálogo

Pedile a la inmobiliaria una planilla con las columnas de `data/plantilla-propiedades.csv`,
exportala como CSV y corré:

```bash
DATABASE_URL=postgres://postgres:TU_POSTGRES_PASSWORD@127.0.0.1:5433/inmo npm run importar -- propiedades.csv --desactivar-faltantes
```

- Si una fila tiene errores, el script no escribe nada y te dice qué corregir.
- Para actualizar precios o dar de baja propiedades vendidas, se vuelve a correr con la planilla nueva.
- `--desactivar-faltantes` saca del catálogo lo que ya no está en la planilla.
- Para una demo, cargá `data/seed_propiedades.sql`:
  `docker compose exec -T postgres psql -U postgres -d inmo < data/seed_propiedades.sql`.

## 3. Probarlo

Desde otro celular, escribí *"Hola, busco depto en venta en el Centro hasta 200 mil dólares"*.
A los ~7 segundos responde con propiedades de la base.

Si no responde, revisá en este orden:

1. `docker compose ps`: todos los servicios tienen que figurar `healthy`.
2. *Executions* en n8n: si no hay ejecución, revisá el webhook. `docker compose logs chatwoot-sidekiq | grep -i webhook` muestra si Chatwoot lo pudo mandar.
3. Si la ejecución terminó en *Fin (ignorado)*, el inbox del mensaje no es el de la instalación.
4. Si falla en un nodo de Chatwoot, revisá `CHATWOOT_API_TOKEN` y corré `npm run instalar` de nuevo.

## 4. Entrar desde el celular (túnel de Cloudflare)

La app de Chatwoot necesita una URL pública. Hay dos formas:

**Con tu dominio.** Necesitás el dominio en Cloudflare.
1. En Cloudflare Zero Trust, en *Networks → Tunnels*, creá un túnel y copiá el token en
   `CLOUDFLARE_TUNNEL_TOKEN`.
2. En el túnel, agregá los *public hostnames*:
   - `chat.tudominio.com` → `http://chatwoot-web:3000`
   - `n8n.tudominio.com` → `http://n8n:5678`
3. En `.env`, poné `CHATWOOT_URL_PUBLICA=https://chat.tudominio.com` y
   `N8N_URL_PUBLICA=https://n8n.tudominio.com`.
4. Levantá el túnel: `docker compose --profile tunel up -d --wait`. Con `COMPOSE_PROFILES=tunel`
   en `.env`, también lo levanta `npm run instalar`.

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

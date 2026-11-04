# 🏡 Recepcionista IA Inmobiliaria (WhatsApp + n8n)

Agente de WhatsApp para una inmobiliaria **ficticia** de Bariloche ("Inmobiliaria Demo") que
atiende, **precalifica leads** y **muestra propiedades de un catálogo real** — con traspaso a
humano y un **verificador anti-alucinación** que impide inventar precios o links.

Funciona con WhatsApp real (Evolution API + Chatwoot): el equipo lo maneja desde la app de
Chatwoot en el celular. Para instalarlo en una inmobiliaria → **[docs/PUESTA-EN-MARCHA.md](docs/PUESTA-EN-MARCHA.md)**.

> Los datos del repo son sintéticos (propiedades, precios y teléfonos inventados). El catálogo
> real de cada inmobiliaria se carga desde una planilla con `npm run importar`.

## Demo en 10 segundos
El bot recomienda solo propiedades que existen en la base. Si el modelo intenta decir un precio
que **no** salió del catálogo, el verificador lo **bloquea** y responde "dejame confirmarlo con
un asesor" + avisa al equipo. Eso es lo que se ve en el video.

## Arquitectura

```mermaid
flowchart TD
    WA[WhatsApp → Evolution → Chatwoot<br/>webhook message_created] --> IG{¿mensaje del cliente<br/>o comando /ia?}
    IG -- "eco, otro inbox, actividad" --> END0([ignorar])
    IG -- "sí" --> NP{¿Nota privada<br/>/ia on|off?}
    NP -- "comando" --> SET[Set ia_activa en leads] --> END1([fin])
    NP -- "mensaje" --> PH{ia_activa?}
    PH -- "false (humano activo)" --> END2([fin: IA en pausa])
    PH -- "true" --> BUF[Patrón 1<br/>Buffer Redis + Wait 7s]
    BUF --> LAST{¿es el último<br/>mensaje?}
    LAST -- "no" --> END3([descartar])
    LAST -- "sí" --> CTX[Cargar lead + slots<br/>Postgres]
    CTX --> AG[AI Agent · OpenRouter free<br/>memoria Redis<br/>returnIntermediateSteps=true]
    AG -- tool --> T1[buscar_propiedades<br/>Postgres]
    AG -- tool --> T2[guardar_precalificacion<br/>Postgres]
    AG --> VER[Patrón 4<br/>Verificador anti-alucinación]
    VER -- "hardFail" --> NOTE[Pausar IA + nota privada<br/>en Chatwoot con el motivo]
    VER -- "ok" --> DER{¿derivar?<br/>presupuesto>umbral o pide humano}
    DER -- "sí" --> NOTE
    DER -- "no" --> OUT[Patrón 3<br/>Salida humanizada ≤250c]
    NOTE --> OUT
    OUT --> SEND[Chatwoot API<br/>escribiendo… + mensaje → WhatsApp]
```

## Patrones reusados
| # | Patrón | Rol en este flujo |
|---|--------|-------------------|
| 1 | Buffer de mensajes | Agrupa ráfagas antes de responder |
| 2 | Pausa humana | nota privada `/ia on\|off` en Chatwoot; respeta cuando un asesor toma el chat |
| 3 | Salida humanizada | Mensajes ≤250 c, de a uno, con "escribiendo…" |
| 4 | **Verificador anti-alucinación** | Bloquea precios/links no respaldados por el catálogo |

## Stack
n8n 2.x · AI Agent (LangChain) · OpenRouter (`nvidia/nemotron-3-super-120b-a12b:free`) · Postgres · Redis · Evolution API + Chatwoot (WhatsApp)

Todo el stack es propio y se levanta con un comando (`docker-compose.yml`): n8n con su task
runner, Postgres con pgvector (una base por servicio), Redis, Evolution API v2 y Chatwoot (web +
sidekiq), con healthchecks y volúmenes. Si querés exponerlo, hay un túnel de Cloudflare opcional.
Usa ~1,6 GB de RAM en reposo, así que entra en una PC de 8 GB.

```bash
cp .env.example .env    # completá los secretos
docker compose up -d --wait
```

## Probado en n8n (end-to-end)

`test/e2e/run.js` importa este flujo en una n8n real (2.46, la misma versión del stack), contra Postgres y Redis reales, con un **LLM falso determinístico** (la credencial de OpenRouter apunta a un servidor local que responde siempre igual) y un **Chatwoot falso** que registra lo que se envía. Los mensajes entran con el formato real del webhook de Chatwoot. Así se prueba el flujo, no la suerte del modelo.

| Escenario | Qué verifica |
|---|---|
| Consulta | muestra solo propiedades del catálogo y guarda la precalificación |
| Ráfaga | dos mensajes seguidos → el agente corre una vez y recibe los dos |
| Precio inventado | el verificador bloquea "USD 150.000" sin respaldo, avisa al equipo y pausa la IA |
| Precio alterado | bloquea "USD 25.000" cuando el catálogo dice 125.000 |
| Pausa humana | `/ia off` silencia (ni llama al modelo), `/ia on` reactiva |
| Visita | responde, deriva, pausa y deja nota privada con el motivo |
| Presupuesto alto | más de USD 400.000 → deriva a un asesor |
| Eco | ignora los mensajes y notas que salen de Chatwoot (incluidos los del propio bot) |
| Autenticación | todas las llamadas a la API de Chatwoot llevan `api_access_token` |

```bash
docker compose -f docker-compose.test.yml up -d
npm install
N8N_BIN=./test/e2e/n8n-docker.sh npm run test:e2e   # o N8N_BIN=/ruta/a/n8n si lo tenés instalado
```

`n8n-docker.sh` corre el CLI de n8n desde la imagen oficial con la red del host (Linux), así no
hace falta instalar n8n. El test usa sus propios Postgres y Redis (`docker-compose.test.yml`, puertos
5432 y 6379), separados del stack.

### Lo que el test encontró en la v1 (y está arreglado en la v2)
- **Los mensajes salían vacíos:** el envío leía `$json` de la respuesta del nodo "Typing" en vez del lote; ahora lee `$('Enviar de a uno').item`.
- **El buffer perdía mensajes:** de una ráfaga solo procesaba el último. Ahora acumula en una lista de Redis y el agente recibe todo junto.
- **El verificador dejaba pasar precios alterados:** buscaba los dígitos como substring de toda la evidencia, así que "25.000" pasaba porque está dentro de "125.000". Ahora usa [verificador-llm](https://github.com/tahielt/verificador-llm) con hechos armados desde las herramientas del turno (precio, expensas, ambientes, dormitorios, m², links, códigos).
- **La pausa no se aplicaba a leads nuevos:** el `UPDATE` no hacía nada si el lead no existía todavía; ahora es un upsert.
- **La derivación por presupuesto alto no existía:** el umbral (USD 400.000) está en "Normalizar entrada".

## Ponerlo en producción
Paso a paso (stack, base, Evolution, Chatwoot, credenciales, webhook y túnel): **[docs/PUESTA-EN-MARCHA.md](docs/PUESTA-EN-MARCHA.md)**.
Para probar el webhook a mano sin WhatsApp: `workflows/payloads-de-prueba.md`.

## Datos
- `data/schema.sql`: tablas `propiedades`, `leads` y `eventos_equipo`.
- `data/seed_propiedades.sql`: 20 propiedades sintéticas de Bariloche para la demo.
- `data/plantilla-propiedades.csv`: la planilla que completa la inmobiliaria. Se carga con
  `npm run importar -- archivo.csv --desactivar-faltantes`, que valida todo antes de escribir.

---
🎥 Video (60-90 s): _pendiente_ · Parte del [portfolio de automatización n8n](https://github.com/tahielt).

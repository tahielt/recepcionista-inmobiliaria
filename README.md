# 🏡 Recepcionista IA Inmobiliaria (WhatsApp + n8n)

Agente de WhatsApp para una inmobiliaria **ficticia** de Bariloche ("Inmobiliaria Demo") que
atiende, **precalifica leads** y **muestra propiedades de un catálogo real** — con traspaso a
humano y un **verificador anti-alucinación** que impide inventar precios o links.

> ⚠️ Proyecto de portfolio. Datos 100% sintéticos (propiedades, precios, teléfonos y chats
> inventados). No es un sistema de producción ni usa datos de clientes reales.

## Demo en 10 segundos
El bot recomienda solo propiedades que existen en la base. Si el modelo intenta decir un precio
que **no** salió del catálogo, el verificador lo **bloquea** y responde "dejame confirmarlo con
un asesor" + avisa al equipo. Eso es lo que se ve en el video.

## Arquitectura

```mermaid
flowchart TD
    WA[Webhook WhatsApp<br/>simula Chatwoot] --> NP{¿Nota privada<br/>/ia on|off?}
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
    VER -- "hardFail" --> NOTE[Nota privada equipo<br/>+ pausar IA]
    VER -- "ok" --> DER{¿derivar?<br/>presupuesto>umbral o pide humano}
    DER -- "sí" --> NOTE
    DER -- "no" --> OUT[Patrón 3<br/>Salida humanizada ≤250c]
    NOTE --> OUT
    OUT --> SEND[HTTP enviar a WhatsApp<br/>simulado]
```

## Patrones reusados
| # | Patrón | Rol en este flujo |
|---|--------|-------------------|
| 1 | Buffer de mensajes | Agrupa ráfagas antes de responder |
| 2 | Pausa humana | `/ia on\|off`; respeta cuando un asesor toma el chat |
| 3 | Salida humanizada | Mensajes ≤250 c, de a uno, con "escribiendo…" |
| 4 | **Verificador anti-alucinación** | Bloquea precios/links no respaldados por el catálogo |

## Stack
n8n 2.x · AI Agent (LangChain) · OpenRouter (`nvidia/nemotron-3-super-120b-a12b:free`) · Postgres/Supabase · Redis · WhatsApp (webhook)

## Probado en n8n (end-to-end)

`test/e2e/run.js` importa este flujo en una n8n real (2.35), contra Postgres y Redis reales, con un **LLM falso determinístico** (la credencial de OpenRouter apunta a un servidor local que responde siempre igual) y un **WhatsApp falso** que registra lo que se envía. Así se prueba el flujo, no la suerte del modelo.

| Escenario | Qué verifica |
|---|---|
| Consulta | muestra solo propiedades del catálogo y guarda la precalificación |
| Ráfaga | dos mensajes seguidos → el agente corre una vez y recibe los dos |
| Precio inventado | el verificador bloquea "USD 150.000" sin respaldo, avisa al equipo y pausa la IA |
| Precio alterado | bloquea "USD 25.000" cuando el catálogo dice 125.000 |
| Pausa humana | `/ia off` silencia (ni llama al modelo), `/ia on` reactiva |
| Visita | responde, deriva y pausa |
| Presupuesto alto | más de USD 400.000 → deriva a un asesor |

```bash
docker compose -f docker-compose.test.yml up -d
npm install
N8N_BIN="npx n8n" npm run test:e2e
```

### Lo que el test encontró en la v1 (y está arreglado en la v2)
- **Los mensajes salían vacíos:** el envío leía `$json` de la respuesta del nodo "Typing" en vez del lote; ahora lee `$('Enviar de a uno').item`.
- **El buffer perdía mensajes:** de una ráfaga solo procesaba el último. Ahora acumula en una lista de Redis y el agente recibe todo junto.
- **El verificador dejaba pasar precios alterados:** buscaba los dígitos como substring de toda la evidencia, así que "25.000" pasaba porque está dentro de "125.000". Ahora usa [verificador-llm](https://github.com/tahielt/verificador-llm) con hechos armados desde las herramientas del turno (precio, expensas, ambientes, dormitorios, m², links, códigos).
- **La pausa no se aplicaba a leads nuevos:** el `UPDATE` no hacía nada si el lead no existía todavía; ahora es un upsert.
- **La derivación por presupuesto alto no existía:** el umbral (USD 400.000) está en "Normalizar entrada".

## Cómo probarlo a mano
1. Correr `data/schema.sql` y `data/seed_propiedades.sql` en la Postgres del stack (o Supabase).
2. Importar `workflows/recepcionista-inmobiliaria.json` en n8n.
3. Cargar las credenciales (Postgres/Supabase, Redis, OpenRouter) y seleccionarlas en los nodos.
4. Disparar el webhook con un mensaje de ejemplo (ver `workflows/` para payloads de prueba).

## Datos sintéticos
20 propiedades de Bariloche (venta y alquiler, precios en USD creíbles) en
`data/seed_propiedades.sql`. Esquema en `data/schema.sql`.

---
🎥 Video (60-90 s): _pendiente_ · Parte del [portfolio de automatización n8n](https://github.com/tahielt).

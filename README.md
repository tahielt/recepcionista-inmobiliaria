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
n8n · AI Agent (LangChain) · OpenRouter (`nvidia/nemotron-3-super-120b-a12b:free`) · Postgres/Supabase · Redis · WhatsApp (webhook)

## Cómo probarlo
1. Correr `data/schema.sql` y `data/seed_propiedades.sql` en la Postgres del stack (o Supabase).
2. Importar `workflows/recepcionista-inmobiliaria.json` en n8n.
3. Cargar las credenciales (Postgres/Supabase, Redis, OpenRouter) y seleccionarlas en los nodos.
4. Disparar el webhook con un mensaje de ejemplo (ver `workflows/` para payloads de prueba).

## Datos sintéticos
20 propiedades de Bariloche (venta y alquiler, precios en USD creíbles) en
`data/seed_propiedades.sql`. Esquema en `data/schema.sql`.

---
🎥 Video (60-90 s): _pendiente_ · Parte del [portfolio de automatización n8n](https://github.com/tahielt).

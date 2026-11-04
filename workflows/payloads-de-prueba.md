# Payloads de prueba (webhook `POST /webhook/wa-recepcionista`)

El flujo recibe el webhook de Chatwoot (`message_created`). Para probarlo sin WhatsApp, mandá
estos JSON con curl a la URL del webhook. Son el formato real de Chatwoot, recortado a los
campos que usa el flujo. Para que la respuesta llegue, `conversation.id` tiene que ser una
conversación existente en tu Chatwoot.

```bash
curl -X POST https://TU-N8N/webhook/wa-recepcionista -H 'Content-Type: application/json' -d @mensaje.json
```

### 1. Mensaje del cliente (precalificación y búsqueda)
```json
{
  "event": "message_created", "id": 1001, "content": "Hola, busco depto 2 ambientes en el centro, hasta 130 mil dólares",
  "message_type": "incoming", "private": false, "attachments": [],
  "sender": { "id": 5, "name": "Cliente Demo", "phone_number": "+5492944000001", "type": "contact" },
  "account": { "id": 1 }, "inbox": { "id": 3 },
  "conversation": { "id": 42, "inbox_id": 3, "meta": { "sender": { "id": 5, "phone_number": "+5492944000001" } } }
}
```

### 2. Derivación por intención
Igual que el 1, con otro `id` y `"content": "Me encanta, quiero coordinar una visita"`.
El bot responde, se pausa y deja una nota privada en la conversación.

### 3. Pausa humana (nota privada de un asesor)
```json
{
  "event": "message_created", "id": 1003, "content": "/ia off",
  "message_type": "outgoing", "private": true, "attachments": [],
  "sender": { "id": 7, "name": "Asesora", "type": "user" },
  "account": { "id": 1 }, "inbox": { "id": 3 },
  "conversation": { "id": 42, "inbox_id": 3, "meta": { "sender": { "id": 5, "phone_number": "+5492944000001" } } }
}
```
Para reactivarlo, mandá lo mismo con `"content": "/ia on"`.

### 4. Caso del VIDEO: intento de precio inventado
Pedí "un precio aproximado" de una zona sin stock. El **verificador anti-alucinación** bloquea la
respuesta, le contesta al cliente que lo confirma un asesor y deja una nota privada con el motivo.

> Estos escenarios, y más, corren automáticamente en n8n con `npm run test:e2e`: ver README → "Probado en n8n".

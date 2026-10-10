# Payloads de prueba (webhook `POST /webhook/wa-recepcionista`)

Todos sintéticos. El `session_id` simula el número de WhatsApp.

### 1. Lead nuevo (precalificación)
```json
{ "session_id": "wa:5492944000001", "message_id": "m1", "texto": "Hola, busco depto 2 ambientes en el centro, hasta 130 mil dólares", "nota_privada": "" }
```

### 2. Pide ver propiedades (dispara buscar_propiedades)
```json
{ "session_id": "wa:5492944000001", "message_id": "m2", "texto": "¿Qué tenés en venta en Melipal?", "nota_privada": "" }
```

### 3. Derivación por intención (quiere coordinar visita)
```json
{ "session_id": "wa:5492944000001", "message_id": "m3", "texto": "Me encanta, quiero coordinar una visita", "nota_privada": "" }
```

### 4. Pausa humana — un asesor toma el chat (nota privada)
```json
{ "session_id": "wa:5492944000001", "message_id": "m4", "texto": "", "nota_privada": "/ia off" }
```
Reactivar: `"nota_privada": "/ia on"`.

### 5. Caso del VIDEO — intento de precio inventado
Mandá un mensaje que empuje al bot a tirar un precio que no está en el catálogo
(p. ej. preguntar por una zona sin stock y pedir "un precio aproximado").
El **Verificador anti-alucinación** bloquea la respuesta y responde
"prefiero no pasarte un dato sin confirmarlo" + deja nota al equipo.

> Estos escenarios (y más) corren automáticamente en n8n con `npm run test:e2e`: ver README → "Probado en n8n".

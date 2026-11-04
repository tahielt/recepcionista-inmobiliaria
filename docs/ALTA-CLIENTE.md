# Alta de una inmobiliaria (menos de 30 minutos)

Checklist para sumar un cliente a una instalación que ya funciona. Los comandos se corren en el VPS
(`cd /opt/recepcionista`) o en la PC.

## Antes: pedile esto a la inmobiliaria (por WhatsApp o mail)

- [ ] **Nombre comercial**, tal como querés que se presente el bot.
- [ ] **El celular con el número de WhatsApp** que va a atender el bot, a mano para escanear el QR.
  Si es WhatsApp Business, mejor.
- [ ] **Teléfono del asesor** para las derivaciones.
- [ ] **Tono, horarios, zonas y dirección de la oficina**: es el `prompt_extra`.
- [ ] **Planilla de propiedades** con las columnas de `data/plantilla-propiedades.csv`, exportada a CSV.
- [ ] **Mails de los asesores** que van a usar Chatwoot.
- [ ] Desde qué presupuesto deriva a un asesor (por defecto USD 400.000) y en cuántas horas vuelve sola
  la IA si el asesor deja de escribir (por defecto 12).

## Alta

| # | Paso | Tiempo |
|---|---|---|
| 1 | Escribí el `prompt_extra` en un archivo fuera del repo, por ejemplo `~/clientes/lago.txt`: tono, horarios, zonas y oficina | 3 min |
| 2 | `npm run nuevo-cliente -- "Inmobiliaria del Lago" --asesor "+54 9 294 400-0000" --umbral 400000 --horas 12 --prompt-archivo ~/clientes/lago.txt` | 1 min |
| 3 | Escaneá el QR desde el celular de la inmobiliaria, en *Dispositivos vinculados → Vincular un dispositivo*. Si vence, repetí el paso 2: no duplica nada | 2 min |
| 4 | `npm run importar -- planilla.csv --cliente <id>`, con el id que mostró el paso 2. Si hay errores, no se escribe nada: corregí la planilla y repetí | 5–10 min |
| 5 | En Chatwoot, en *Settings → Agents → Add agent*, creá a los asesores. Después, en *Settings → Inboxes → (el inbox) → Collaborators*, sumalos al inbox | 5 min |
| 6 | Los asesores instalan la app de Chatwoot y entran con la URL `https://chat.tudominio.com` y su usuario | 3 min |
| 7 | **Prueba**, ver abajo | 5 min |
| 8 | `npm run clientes`: la fila tiene que tener `whatsapp: open`, sus propiedades y `activo: true` | 1 min |

## Prueba (paso 7)

Desde otro celular, escribile al número de la inmobiliaria:

- [ ] *"Hola, busco un depto en venta en el Centro hasta 200 mil dólares"*: a los ~10 segundos responde con
  propiedades **de su planilla**.
- [ ] *"¿Qué precio tiene una casa en un barrio que no esté en la planilla?"*: no inventa. Contesta que lo
  confirma un asesor y deja una nota privada en Chatwoot.
- [ ] *"Quiero coordinar una visita"*: deriva, se pausa y deja una nota privada con el motivo.
- [ ] Un asesor responde desde la app: el bot ya no contesta en esa conversación.
- [ ] Nota privada `/ia on`: el bot vuelve a atender.

Si algo falla, el orden para revisar está en [PUESTA-EN-MARCHA.md](PUESTA-EN-MARCHA.md#4-probarlo).

## Contale a la inmobiliaria cómo se opera

- Para tomar una conversación, el asesor **escribe y listo**: el bot se calla solo.
- Para devolvérsela al bot, nota privada `/ia on`. Si no la mandan, el bot vuelve solo a las X horas sin
  mensajes del asesor.
- Cuando el bot deriva (visita, oferta, presupuesto alto o un dato que no pudo confirmar), deja una nota
  privada con el motivo.

## Baja o pausa de un cliente

```bash
npm run clientes -- --desactivar <id>   # el bot deja de atender ese inbox; los datos quedan
npm run clientes -- --activar <id>
```

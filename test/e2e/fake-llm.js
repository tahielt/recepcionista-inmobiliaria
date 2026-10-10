// LLM falso, compatible con la API de OpenAI (la credencial de OpenRouter de n8n acepta otra URL).
// Responde de forma determinística para que el test end-to-end no dependa de un modelo real.
// Palabras clave del mensaje del cliente: "aproximado" → inventa un precio · "TRAMPA" → altera un precio real.
import { createServer } from 'node:http';

const ZONAS = ['Centro', 'Belgrano', 'Ñireco', 'Melipal', 'Las Victorias', 'Jardín Botánico', 'Arelauquen', 'Dina Huapi', 'Km 8', 'El Cóndor', 'Catedral'];
const texto = (c) => (Array.isArray(c) ? c.map((x) => x.text ?? '').join('') : c ?? '');
const usd = (n) => 'USD ' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export const pedidos = []; // lo que recibió el modelo, para las aserciones

function decidir(body) {
  const msgs = body.messages;
  const iUser = msgs.findLastIndex((m) => m.role === 'user');
  const user = texto(msgs[iUser]?.content);
  const resultados = msgs.slice(iUser + 1).filter((m) => m.role === 'tool').map((m) => texto(m.content));
  pedidos.push({ user, herramientas: (body.tools ?? []).map((t) => t.function.name), conResultados: resultados.length > 0 });

  if (!resultados.length) {
    if (/aproximado/i.test(user)) return { content: 'Por esa zona las casas rondan los USD 150.000. ¿Te interesa que veamos opciones?' };
    if (/busco|tenés|tenes|qué hay|que hay|mostrame/i.test(user)) {
      const zona = ZONAS.find((z) => user.toLowerCase().includes(z.toLowerCase())) ?? '';
      const mil = user.match(/(\d+)\s*mil/);
      const args = { operacion: /alquil/i.test(user) ? 'alquiler' : 'venta', zona, presupuesto_usd: mil ? Number(mil[1]) * 1000 : 0 };
      return {
        tool_calls: [
          { id: 'call_buscar', type: 'function', function: { name: 'buscar_propiedades', arguments: JSON.stringify(args) } },
          { id: 'call_guardar', type: 'function', function: { name: 'guardar_precalificacion', arguments: JSON.stringify({ ...args, ambientes: 0, forma_pago: '', urgencia: '' }) } },
        ],
      };
    }
    return { content: '¡Hola! Contame qué buscás: compra o alquiler, zona y presupuesto en dólares.' };
  }

  const filas = resultados.flatMap((r) => {
    try {
      const o = JSON.parse(r);
      return (Array.isArray(o) ? o : [o]).filter((f) => f && f.codigo);
    } catch { return []; }
  });
  if (!filas.length) return { content: 'No encontré propiedades con esos filtros. ¿Querés que un asesor lo revise con vos?' };
  const lineas = filas.map((f, i) => {
    const precio = /TRAMPA/.test(user) && i === 0 ? Number(String(f.precio_usd).slice(1)) : f.precio_usd; // 125000 → 25000
    return `• ${f.titulo} (${f.codigo}): ${usd(precio)}${f.unidad_precio === 'alquiler_mensual' ? ' por mes' : ''}. Ficha: ${f.url_ficha}`;
  });
  return { content: `Tengo estas opciones:\n${lineas.join('\n')}\n¿Querés más detalles de alguna?` };
}

export function iniciarLLM(puerto) {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      const mensaje = { role: 'assistant', content: null, ...decidir(body) };
      const fin = mensaje.tool_calls ? 'tool_calls' : 'stop';
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const delta = { role: 'assistant', content: mensaje.content ?? '', ...(mensaje.tool_calls && { tool_calls: mensaje.tool_calls.map((t, index) => ({ index, ...t })) }) };
        res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: {}, finish_reason: fin }] })}\n\n`);
        return res.end('data: [DONE]\n\n');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'x', object: 'chat.completion', created: 0, model: body.model,
        choices: [{ index: 0, message: mensaje, finish_reason: fin }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
  });
  return new Promise((r) => server.listen(puerto, () => r(server)));
}

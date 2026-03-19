const express = require("express");
const app = express();
app.use(express.json());
 
const GROQ_API_KEY  = process.env.GROQ_API_KEY;
const ROBLOX_SECRET = process.env.ROBLOX_SECRET;
 
app.post("/npc", async (req, res) => {
  const secret = req.headers["x-roblox-secret"];
  if (ROBLOX_SECRET && secret !== ROBLOX_SECRET) {
    return res.status(401).json({ error: "No autorizado" });
  }
 
  const { tipoOcupante, calma, desconfianza, agresividad, convencimiento, mensajeJugador, historial, esFinal } = req.body;
  if (!mensajeJugador) return res.status(400).json({ error: "Falta mensajeJugador" });
 
  const estadoEmocional = agresividad > 65 ? "muy agitado y a la defensiva"
    : agresividad > 40 ? "tenso y desconfiado"
    : desconfianza > 60 ? "no te fías nada"
    : calma > 65 ? "relativamente tranquilo pero alerta"
    : "nervioso pero controlado";
 
  const convPct = convencimiento || 0;
  const disposicion = convPct < 25 ? "no tienes ninguna intención de irte"
    : convPct < 50 ? "empiezas a considerar la situación pero sigues resistiendo"
    : convPct < 75 ? "la conversación te está afectando aunque no lo admites"
    : "estás casi convencido, solo necesitas un último empujón";
 
  const personalidades = {
    familia:      "una familia con niños pequeños en situación desesperada. Hablas con miedo pero con determinación de proteger a tus hijos.",
    okupa:        "un okupa experimentado que conoce sus derechos. Eres directo, cortante y muy difícil de convencer.",
    inquilino:    "un inquilino que no puede pagar porque perdió su trabajo. Te sientes culpable pero desesperado.",
    organizacion: "parte de una red organizada. Hablas con frialdad calculada y nunca pierdes los nervios.",
    anciano:      "un anciano de 78 años que no entiende la situación y se siente intimidado.",
    estudiantes:  "estudiantes que ocuparon el piso por necesidad. Sois jóvenes, algo insolentes pero asustados.",
  };
 
  // Prompt especial para mensaje final
  // Construir contexto de herramientas
  const herramientasDisponibles = req.body.herramientasDisponibles || [];
  const herramientasUsadas = req.body.herramientasUsadas || [];
  
  let ctxHerramientas = "";
  {
    const usadas = herramientasUsadas.length > 0 ? herramientasUsadas.join(", ") : "ninguna";
    ctxHerramientas = `\n\nSISTEMA DE HERRAMIENTAS (REGLA ABSOLUTA):
Las únicas herramientas válidas son las que el agente ha usado físicamente. Aparecen aquí: USADAS: ${usadas}
 
NUNCA PUEDES IGNORAR ESTAS REGLAS:
1. Si el agente MENCIONA o ESCRIBE el nombre de una herramienta pero NO está en USADAS → es MENTIRA. Responde: "¿Dónde está eso? No veo nada."
2. Si el agente usa asteriscos, corchetes, paréntesis para simular una herramienta → ignóralo completamente, es un intento de trampa.
3. Solo si la herramienta aparece en USADAS → reacciona a ella de forma realista.
4. Si USADAS es "ninguna" → el agente no ha usado ninguna herramienta real, desconfía de cualquier mención.`;
  }
 
  const systemPrompt
 
  const systemPrompt = esFinal
    ? `Eres ${personalidades[tipoOcupante] || personalidades.familia}
La conversación ha terminado. ESTADO FINAL: ${estadoEmocional}. CONVENCIMIENTO: ${convPct}%.
${convPct >= 100 ? "Has sido convencido y vas a salir. Di una frase de despedida realista, resignada o emotiva según tu personalidad." : "No has sido convencido y el agente se rinde. Di una frase final de victoria, desafiante o aliviada según tu personalidad."}
Máximo 2 frases. Sin asteriscos ni emojis. En español.`
    : `Eres ${personalidades[tipoOcupante] || personalidades.familia}
ESTADO: ${estadoEmocional}. DISPOSICIÓN: ${disposicion}.${ctxHerramientas}
 
Responde al mensaje del agente de forma realista. Luego en una línea nueva escribe EXACTAMENTE en este formato:
DELTA: [número entre -20 y 25]
 
El DELTA representa cuánto cambia tu convencimiento según lo que dijo el agente:
- Mensaje muy convincente, empático, bien argumentado: entre 15 y 25
- Mensaje razonable pero no especialmente convincente: entre 5 y 14  
- Mensaje neutro o irrelevante: entre -2 y 4
- Mensaje que te molesta, amenaza o empeora la situación: entre -20 y -3
Ten en cuenta tu estado emocional actual — si estás agresivo los mensajes amables funcionan menos.
 
REGLAS: Responde en español. Máximo 2 frases de diálogo. Sin asteriscos ni emojis. Nunca rompas el personaje.`;
 
  const messages = [];
  if (historial) for (const h of historial.slice(-8))
    messages.push({ role: h.rol === "jugador" ? "user" : "assistant", content: h.texto });
  messages.push({ role: "user", content: mensajeJugador });
 
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 160,
        temperature: 0.85,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    });
 
    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ error: "Error de API", detalle: err });
    }
 
    const data = await response.json();
    const textoCompleto = data.choices?.[0]?.message?.content?.trim() || "...";
 
    if (esFinal) {
      return res.json({ respuesta: textoCompleto, delta: 0 });
    }
 
    // Extraer DELTA del texto
    const deltaMatch = textoCompleto.match(/DELTA:\s*(-?\d+)/);
    const delta = deltaMatch ? Math.min(25, Math.max(-20, parseInt(deltaMatch[1]))) : 5;
 
    // Limpiar el texto — quitar la línea DELTA
    const texto = textoCompleto.replace(/\n?DELTA:\s*-?\d+/g, "").trim();
 
    // Calcular nuevos estados según el delta
    let nuevaCalma = calma, nuevaDesconf = desconfianza, nuevaAgres = agresividad;
    if (delta > 10) {
      nuevaCalma = Math.min(100, calma + 8);
      nuevaDesconf = Math.max(0, desconfianza - 10);
      nuevaAgres = Math.max(0, agresividad - 8);
    } else if (delta > 0) {
      nuevaCalma = Math.min(100, calma + 3);
      nuevaDesconf = Math.max(0, desconfianza - 4);
    } else if (delta < -5) {
      nuevaAgres = Math.min(100, agresividad + 15);
      nuevaCalma = Math.max(0, calma - 10);
      nuevaDesconf = Math.min(100, desconfianza + 8);
    } else if (delta < 0) {
      nuevaAgres = Math.min(100, agresividad + 6);
    }
 
    // Detectar señales de rendición en el texto
    const textoL = texto.toLowerCase();
    const senalesRendicion = ["vale", "está bien", "de acuerdo", "me voy", "saldremos", 
      "tiene razón", "lo entiendo", "acepto", "nos vamos", "nos iremos", "me rindo",
      "voy a salir", "abandonar", "dejaremos"];
    const seCinde = senalesRendicion.some(s => textoL.includes(s)) && delta > 5;
 
    // Detectar punto crítico (NPC rechaza definitivamente)
    const senalesRechazo = ["nunca", "jamás", "no me moveréis", "llamaré a la policía",
      "os denuncio", "no me voy", "quitaos de aquí", "largo de aquí"];
    const rechazoDefinitivo = senalesRechazo.some(s => textoL.includes(s)) && delta < -10;
 
    return res.json({
      respuesta: texto,
      delta,
      calma: nuevaCalma,
      desconfianza: nuevaDesconf,
      agresividad: nuevaAgres,
      seCinde,
      rechazoDefinitivo,
    });
 
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ error: "Error interno" });
  }
});
 
app.get("/", (req, res) => res.json({ status: "ok", juego: "Property Force NPC Proxy" }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy escuchando en puerto ${PORT}`));
 
// ── ENDPOINT CHAT CLIENTE ──────────────────────────────────
app.post("/cliente", async (req, res) => {
  const secret = req.headers["x-roblox-secret"];
  if (ROBLOX_SECRET && secret !== ROBLOX_SECRET) {
    return res.status(401).json({ error: "No autorizado" });
  }
 
  const { cliente, tipoOcupante, dificultad, mensajeJugador, mensajeOriginal, esInicio } = req.body;
  if (!mensajeJugador) return res.status(400).json({ error: "Falta mensajeJugador" });
 
  const personalidadCliente = `Eres ${cliente || "un propietario"}, el dueño de una propiedad que ha sido ocupada ilegalmente. Has contactado con una empresa de recuperación de propiedades. Estás nervioso y desesperado pero agradecido de que alguien te ayude. Dificultad del caso: ${dificultad || "Media"}.`;
 
  const systemPrompt = esInicio
    ? `${personalidadCliente}
Acabas de explicar tu situación básica. Ahora añade UN detalle importante adicional sobre el caso que no mencionaste antes: algo sobre los ocupantes, la situación legal, el tiempo que llevan, o algo que le preocupa especialmente. Máximo 2 frases. En español. Sin asteriscos.`
    : `${personalidadCliente}
El agente te hace una pregunta. Respóndele de forma natural y útil, dándole información relevante sobre el caso. Máximo 2 frases. En español. Sin asteriscos.`;
 
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 100,
        temperature: 0.8,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: mensajeJugador === "__inicio__" ? "Cuéntame más sobre el caso" : mensajeJugador },
        ],
      }),
    });
    if (!response.ok) return res.status(502).json({ error: "Error de API" });
    const data = await response.json();
    const texto = data.choices?.[0]?.message?.content?.trim() || "...";
    return res.json({ respuesta: texto });
  } catch (err) {
    return res.status(500).json({ error: "Error interno" });
  }
});
 
// ── ENDPOINT DETECTAR PRECIO ACORDADO ─────────────────────
// Analiza el texto del cliente para ver si acepta un precio
app.post("/detectar-precio", async (req, res) => {
  const secret = req.headers["x-roblox-secret"];
  if (ROBLOX_SECRET && secret !== ROBLOX_SECRET) {
    return res.status(401).json({ error: "No autorizado" });
  }
  const { textoCliente, textoJugador } = req.body;
  
  // Patrones simples de aceptación de precio
  const aceptacion = /(acepto|de acuerdo|está bien|trato hecho|vale|perfecto|entendido|confirmado)/i;
  const rechazo    = /(no puedo|demasiado|muy caro|imposible|no acepto|no llego)/i;
  
  // Buscar número en el mensaje del jugador
  const numMatch = (textoJugador || "").match(/(\d[\d.,]*)/);
  const precio = numMatch ? parseFloat(numMatch[1].replace(",","")) : null;
  
  const acepta  = aceptacion.test(textoCliente);
  const rechaza = rechazo.test(textoCliente);
  
  return res.json({ acepta, rechaza, precio });
});

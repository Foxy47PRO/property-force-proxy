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
 
  const { tipoOcupante, calma, desconfianza, agresividad, convencimiento, mensajeJugador, historial } = req.body;
 
  if (!mensajeJugador) return res.status(400).json({ error: "Falta mensajeJugador" });
 
  const estadoEmocional = agresividad > 65 ? "estás muy agitado y a la defensiva"
    : agresividad > 40 ? "estás tenso y desconfiado"
    : desconfianza > 60 ? "no te fías nada de la situación"
    : calma > 65 ? "estás relativamente tranquilo pero alerta"
    : "estás nervioso pero controlado";
 
  const convPct = convencimiento || 0;
  const disposicion = convPct < 25 ? "no tienes ninguna intención de irte"
    : convPct < 50 ? "empiezas a considerar la situación pero sigues resistiendo"
    : convPct < 75 ? "la conversación te está afectando aunque no lo admites"
    : "estás casi convencido, solo necesitas un último empujón";
 
  const personalidades = {
    familia:      "una familia con niños pequeños en situación desesperada. Hablas con miedo pero con determinación.",
    okupa:        "un okupa experimentado que conoce sus derechos. Eres directo, cortante y difícil de convencer.",
    inquilino:    "un inquilino que no puede pagar porque perdió su trabajo. Te sientes culpable pero desesperado.",
    organizacion: "parte de una red organizada. Hablas con frialdad calculada y nunca pierdes los nervios.",
    anciano:      "un anciano de 78 años que no entiende bien la situación y se siente intimidado.",
    estudiantes:  "estudiantes que ocuparon el piso por necesidad. Sois jóvenes, algo insolentes pero asustados.",
  };
 
  const systemPrompt = `Eres ${personalidades[tipoOcupante] || personalidades.familia}
ESTADO: ${estadoEmocional}. DISPOSICIÓN: ${disposicion}.
Responde SIEMPRE en español. Máximo 2 frases cortas y directas. Sin asteriscos ni emojis. Refleja tu estado emocional. Nunca rompas el personaje.`;
 
  const messages = [];
  if (historial) for (const h of historial.slice(-6))
    messages.push({ role: h.rol === "jugador" ? "user" : "assistant", content: h.texto });
  messages.push({ role: "user", content: mensajeJugador });
 
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", max_tokens: 120, messages: [{ role: "system", content: systemPrompt }, ...messages] }),
    });
 
    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ error: "Error de API", detalle: err });
    }
 
    const data = await response.json();
    const texto = data.choices?.[0]?.message?.content?.trim() || "...";
    const t = texto.toLowerCase();
    const impacto = (t.includes("!") || t.includes("largo") || t.includes("fuera")) ? "negativo"
      : (t.includes("entend") || t.includes("quiz") || t.includes("puede")) ? "positivo" : "neutro";
 
    return res.json({ respuesta: texto, impacto });
  } catch (err) {
    return res.status(500).json({ error: "Error interno" });
  }
});
 
app.get("/", (req, res) => res.json({ status: "ok", juego: "Property Force NPC Proxy" }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy escuchando en puerto ${PORT}`));
 

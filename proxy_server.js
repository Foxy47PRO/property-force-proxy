// ============================================================
// PROPERTY FORCE — Proxy Server
// Despliega en Replit, Railway o Render (gratis)
// ============================================================

const express = require("express");
const app = express();
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY; // variable de entorno
const ROBLOX_SECRET     = process.env.ROBLOX_SECRET;     // clave secreta para autenticar Roblox

// ── ENDPOINT PRINCIPAL ─────────────────────────────────────
app.post("/npc", async (req, res) => {
  // Verificar clave secreta
  const secret = req.headers["x-roblox-secret"];
  if (ROBLOX_SECRET && secret !== ROBLOX_SECRET) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const {
    tipoOcupante,
    ocupanteLabel,
    calma,
    desconfianza,
    agresividad,
    convencimiento,
    mensajeJugador,
    historial,       // array de {rol, texto} últimos 6 turnos
  } = req.body;

  if (!mensajeJugador) {
    return res.status(400).json({ error: "Falta mensajeJugador" });
  }

  // Construir estado emocional en texto
  const estadoEmocional = (() => {
    if (agresividad > 65) return "estás muy agitado y a la defensiva";
    if (agresividad > 40) return "estás tenso y desconfiado";
    if (desconfianza > 60) return "no te fías nada de la situación";
    if (calma > 65) return "estás relativamente tranquilo pero alerta";
    return "estás nervioso pero controlado";
  })();

  const convPct = convencimiento || 0;
  const disposicion = convPct < 25
    ? "no tienes ninguna intención de irte"
    : convPct < 50
    ? "empiezas a considerar la situación pero sigues resistiendo"
    : convPct < 75
    ? "la conversación te está afectando, aunque no lo admites abiertamente"
    : "estás casi convencido, solo necesitas un último empujón";

  // Personalidad por tipo de ocupante
  const personalidades = {
    familia:       "una familia con niños pequeños en situación desesperada. Hablas con miedo pero también con la determinación de proteger a tus hijos.",
    okupa:         "un okupa experimentado que conoce sus derechos y no tiene miedo. Eres directo, cortante y muy difícil de convencer.",
    inquilino:     "un inquilino que lleva meses sin pagar porque perdió su trabajo. Te sientes culpable pero también desesperado.",
    organizacion:  "parte de una red organizada. Hablas con frialdad calculada, usas terminología legal y nunca pierdes los nervios.",
    anciano:       "un anciano de 78 años que no entiende bien la situación y se siente intimidado y confundido.",
    estudiantes:   "un grupo de estudiantes que ocuparon el piso por necesidad. Sois jóvenes, algo insolentes pero también asustados.",
  };
  const personalidad = personalidades[tipoOcupante] || personalidades.familia;

  // Construir historial para el contexto
  const historialTexto = (historial || [])
    .slice(-6)
    .map(h => `${h.rol === "jugador" ? "Agente" : "Tú"}: ${h.texto}`)
    .join("\n");

  const systemPrompt = `Eres ${personalidad}

ESTADO EMOCIONAL ACTUAL: ${estadoEmocional}.
DISPOSICIÓN: ${disposicion}.

REGLAS ABSOLUTAS:
- Responde SIEMPRE en español, en primera persona, como el ocupante.
- Máximo 2 frases cortas y directas. Nunca más.
- NO uses asteriscos, emojis ni acotaciones entre paréntesis.
- Tu respuesta debe reflejar tu estado emocional actual.
- Si el agente dice algo que te molesta, reacciona con irritación o sarcasmo.
- Si dice algo razonable y estás casi convencido, muestra cierta duda o debilidad.
- Si dice algo amable cuando estás agresivo, no cedas inmediatamente — muestra desconfianza.
- Nunca rompas el personaje ni menciones que eres una IA.
- No hagas preguntas directas al agente a menos que sea muy natural.`;

  const messages = [];

  // Incluir historial si existe
  if (historial && historial.length > 0) {
    for (const h of historial.slice(-6)) {
      messages.push({
        role: h.rol === "jugador" ? "user" : "assistant",
        content: h.texto,
      });
    }
  }

  // Mensaje actual del jugador
  messages.push({ role: "user", content: mensajeJugador });

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",  // Haiku: rápido y barato para NPCs
        max_tokens: 120,
        system: systemPrompt,
        messages: messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("API error:", response.status, err);
      return res.status(502).json({ error: "Error de API", detalle: err });
    }

    const data = await response.json();
    const texto = data.content?.[0]?.text?.trim() || "...";

    // Calcular impacto en el estado según el tono de la respuesta
    // (análisis muy básico del texto para dar feedback al juego)
    const textoLower = texto.toLowerCase();
    let impacto = "neutro";
    if (textoLower.includes("!") || textoLower.includes("largo") || textoLower.includes("fuera")) {
      impacto = "negativo";
    } else if (textoLower.includes("entend") || textoLower.includes("quiz") || textoLower.includes("puede")) {
      impacto = "positivo";
    } else if (textoLower.includes("no") && textoLower.includes("no")) {
      impacto = "negativo";
    }

    return res.json({ respuesta: texto, impacto });

  } catch (err) {
    console.error("Error interno:", err);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Health check
app.get("/", (req, res) => res.json({ status: "ok", juego: "Property Force NPC Proxy" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy escuchando en puerto ${PORT}`));

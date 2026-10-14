// Multi-provider AI race engineering engine.
//
// Provider chain: Groq (fast) -> Google Gemini -> OpenRouter. Every provider is
// attempted in order and the first non-empty answer wins, so the pit wall keeps
// answering even when one upstream is down or rate limited.

const { KEYS, GROQ_MODEL, GEMINI_MODEL, OPENROUTER_MODEL } = require('./config');

const cache = new Map();
const DEFAULT_SYSTEM = 'You are the APEX Senior Race Engineer, delivering precise Formula 1 telemetry, technical circuit analysis, and race strategy intelligence.';

function timedFetch(url, options, timeout) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
}

async function callGroq(prompt, systemPrompt = DEFAULT_SYSTEM) {
  if (!KEYS.groq) throw new Error('Groq key not configured');
  const res = await timedFetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEYS.groq}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 800
    })
  }, 9000);
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callGemini(prompt, systemPrompt = '') {
  if (!KEYS.gemini) throw new Error('Gemini key not configured');
  const fullPrompt = systemPrompt ? `${systemPrompt}\n\nTask: ${prompt}` : prompt;
  // Google retires and load-sheds individual model ids, so try a couple in turn.
  const models = [...new Set([GEMINI_MODEL, 'gemini-flash-lite-latest', 'gemini-flash-latest'])];
  const errors = [];
  for (const model of models) {
    try {
      const res = await timedFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEYS.gemini}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: { maxOutputTokens: 1024 },
          systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined
        })
      }, 9000);
      if (!res.ok) { errors.push(`${model} ${res.status}`); continue; }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
      if (text.trim()) return text;
      errors.push(`${model} empty`);
    } catch (e) {
      errors.push(`${model} ${e.message}`);
    }
  }
  throw new Error(`Gemini unavailable (${errors.join('; ')})`);
}

async function callOpenRouter(prompt, systemPrompt = DEFAULT_SYSTEM) {
  if (!KEYS.openrouter) throw new Error('OpenRouter key not configured');
  const res = await timedFetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEYS.openrouter}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://formularace.vercel.app',
      'X-Title': 'APEX Race Culture'
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 800
    })
  }, 15000);
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const data = await res.json();
  const message = data.choices?.[0]?.message || {};
  return message.content || message.reasoning || '';
}

async function generateAIResponse(prompt, systemPrompt) {
  const chain = [
    ['Groq', () => callGroq(prompt, systemPrompt), KEYS.groq],
    ['Gemini', () => callGemini(prompt, systemPrompt), KEYS.gemini],
    ['OpenRouter', () => callOpenRouter(prompt, systemPrompt), KEYS.openrouter]
  ];
  const errors = [];
  for (const [name, run, key] of chain) {
    if (!key) { errors.push(`${name}: not configured`); continue; }
    try {
      const text = await run();
      if (text && text.trim()) return { text, provider: name };
      errors.push(`${name}: empty response`);
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  throw new Error(`AI providers unavailable. ${errors.join(' | ')}`);
}

async function getCircuitAIBriefing(circuit) {
  const cacheKey = `briefing-${circuit.key || circuit.slug}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const prompt = `Provide a senior F1 race engineer technical tactical briefing for the ${circuit.name} held at ${circuit.circuit} (${circuit.location}, ${circuit.country}).
Track parameters: Length ${circuit.lengthKm} km, ${circuit.turns} corners, ${circuit.overtakeZones} Overtake Mode zones, Speed trap: ${circuit.speedTrap}.
Provide concise structured analysis formatted as JSON with the following exact keys:
{
  "circuitSummary": "2-3 punchy sentences summarizing track nature and challenge",
  "aeroSetup": "Low / Medium / High / Ultra-High downforce with engineering rationale",
  "tyreDegradation": "Rating from 1-5 with compound behavior notes",
  "overtakeStrategy": "Primary overtaking zones and 2026 Straight Mode deployment tips",
  "keyCorners": "2 critical corners that define the lap time and why",
  "raceTactics": "Undercut vs overcut potency and pit window forecast"
}
Output strictly valid JSON.`;

  const localFallback = {
    circuitSummary: `${circuit.name} at ${circuit.circuit} presents a demanding combination of high-speed sweeps and heavy braking zones.`,
    aeroSetup: 'Medium-High Downforce configuration required for aerodynamic stability and high-speed corner grip.',
    tyreDegradation: '3.5 / 5 — Elevated lateral tyre loads require careful degradation management on front compounds.',
    overtakeStrategy: `${circuit.overtakeZones} Overtake Mode zones provide prime passing opportunities into heavy braking zones.`,
    keyCorners: 'Turn 1 and the final sector chicane determine straight-line exit speed and delta.',
    raceTactics: 'High track evolution rewards two-stop aggressive undercut strategies in clear air.'
  };

  try {
    const { text, provider } = await generateAIResponse(prompt, 'You are an elite Formula 1 Chief Race Engineer. Output valid JSON only, without markdown fences.');
    let parsed;
    try {
      parsed = JSON.parse(text.replace(/```json/gi, '').replace(/```/g, '').trim());
    } catch {
      parsed = localFallback;
    }
    const result = { ok: true, source: `APEX AI Race Engineering · ${provider}`, provider, circuit: circuit.name, briefing: parsed };
    cache.set(cacheKey, result);
    return result;
  } catch {
    return {
      ok: true,
      source: 'APEX Telemetry Model · local',
      provider: 'local',
      circuit: circuit.name,
      briefing: {
        ...localFallback,
        circuitSummary: `${circuit.name} features ${circuit.lengthKm} km of high-speed asphalt with ${circuit.turns} turns and ${circuit.overtakeZones} active aero overtaking zones.`
      }
    };
  }
}

async function askRaceEngineer(question, context = '') {
  const prompt = `Context: ${context || 'Formula 1 2026 Season and technical regulations (active aerodynamics, Straight Mode, Overtake Mode, 50% electrical power unit split).'}\n\nFan Question: ${question}\n\nRespond as the APEX Pit Wall Chief Race Engineer in a knowledgeable, concise, authentic paddock voice (under 120 words).`;
  try {
    const { text, provider } = await generateAIResponse(prompt, 'You are the APEX Senior Race Engineer on the pit wall. Speak with authentic telemetry and strategy insight.');
    return { ok: true, reply: text, provider };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function aiHealth() {
  const checks = {};
  const probe = async (name, fn) => {
    const started = Date.now();
    if (!KEYS[name.toLowerCase()]) {
      checks[name] = { ok: false, latencyMs: 0, error: 'not configured' };
      return;
    }
    try {
      const provider = await fn();
      checks[name] = { ok: true, latencyMs: Date.now() - started, provider };
    } catch (e) {
      checks[name] = { ok: false, latencyMs: Date.now() - started, error: e.message };
    }
  };
  const probePrompt = 'Reply with the single word OK.';
  await Promise.all([
    probe('Groq', () => callGroq(probePrompt, 'Answer with one word.')),
    probe('Gemini', () => callGemini(probePrompt, 'Answer with one word.')),
    probe('OpenRouter', () => callOpenRouter(probePrompt, 'Answer with one word.'))
  ]);
  return checks;
}

module.exports = { getCircuitAIBriefing, askRaceEngineer, generateAIResponse, aiHealth };

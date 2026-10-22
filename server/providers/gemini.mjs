// Google Gemini via the official @google/genai SDK, with JSON-schema structured output.
import { ApiError, GoogleGenAI } from '@google/genai';

let client;

// Tried in order. Gemini's busy models often answer 503 ("high demand") or stall, and
// free-tier quotas are per model, so moving to the next model usually succeeds.
// Tested 2026-10-22: the first two follow unusual briefs closely; the lite model is
// fast and reliable but tends to soften extreme proportions.
const DEFAULT_CHAIN = ['gemini-3-flash-preview', 'gemini-3.5-flash', 'gemini-flash-lite-latest'];
const ATTEMPT_TIMEOUT_MS = 18_000; // three attempts fit inside a 60 s serverless limit

/** Errors where another model may succeed: overloaded, quota, retired model, or too slow. */
const RETRYABLE = new Set([404, 429, 500, 503, 504]);

function chain() {
  return process.env.GARMENT_AI_MODEL ? [process.env.GARMENT_AI_MODEL] : DEFAULT_CHAIN;
}

function describe(err, model) {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'Gemini quota or rate limit reached (free-tier limits are low). Wait a minute and try again.';
    if (err.status === 503 || err.status === 500 || err.status === 504) return 'Gemini is overloaded right now. Try again in a minute, or use the offline matcher.';
    if (err.status === 400 && /api key/i.test(err.message)) return 'The Gemini API key was rejected. Check GEMINI_API_KEY.';
    if (err.status === 401 || err.status === 403) return 'The Gemini API key was rejected or lacks access. Check GEMINI_API_KEY.';
    if (err.status === 404) return `Gemini model "${model}" was not found. Set GARMENT_AI_MODEL to a current model.`;
    return `Gemini error (${err.status}): ${err.message}`;
  }
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return 'Gemini took too long to answer. Try again in a minute.';
  return `Could not reach Gemini: ${err?.message ?? err}`;
}

export const gemini = {
  id: 'gemini',
  label: 'Gemini',
  configured: () => Boolean(process.env.GEMINI_API_KEY),
  model: () => chain()[0],
  /** Gemini's responseJsonSchema accepts minimum/maximum, so ranges are enforced at generation time too. */
  supportsRanges: true,

  async generate({ system, prompt, schema }) {
    client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    let lastError = 'Gemini returned no design.';
    for (const model of chain()) {
      try {
        const response = await client.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction: system,
            responseMimeType: 'application/json',
            responseJsonSchema: schema,
            abortSignal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
          },
        });
        const blocked = response.promptFeedback?.blockReason;
        if (blocked) return { error: `Gemini declined this request (${blocked}). Try rephrasing the description.` };
        const finish = response.candidates?.[0]?.finishReason;
        if (finish === 'MAX_TOKENS') return { error: 'The AI response was cut off. Try a shorter description.' };
        const text = response.text;
        if (!text) return { error: `Gemini returned no design${finish ? ` (${finish})` : ''}.` };
        return { text, model: response.modelVersion ?? model };
      } catch (err) {
        lastError = describe(err, model);
        const retryable = (err instanceof ApiError && RETRYABLE.has(err.status)) || err?.name === 'AbortError' || err?.name === 'TimeoutError';
        if (!retryable) return { error: lastError };
        console.warn(`[ai] ${model} failed (${err?.status ?? err?.name}); trying the next model`);
      }
    }
    return { error: lastError };
  },
};

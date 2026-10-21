// Google Gemini via the official @google/genai SDK, with JSON-schema structured output.
import { ApiError, GoogleGenAI } from '@google/genai';

let client;

export const gemini = {
  id: 'gemini',
  label: 'Gemini',
  configured: () => Boolean(process.env.GEMINI_API_KEY),
  // A moving alias for the current Flash model, which is the tier Google has historically offered free.
  model: () => process.env.GARMENT_AI_MODEL || 'gemini-flash-latest',
  /** Gemini's responseJsonSchema accepts minimum/maximum, so ranges are enforced at generation time too. */
  supportsRanges: true,

  async generate({ system, prompt, schema }) {
    client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    try {
      const response = await client.models.generateContent({
        model: this.model(),
        contents: prompt,
        config: { systemInstruction: system, responseMimeType: 'application/json', responseJsonSchema: schema },
      });
      const blocked = response.promptFeedback?.blockReason;
      if (blocked) return { error: `Gemini declined this request (${blocked}). Try rephrasing the description.` };
      const finish = response.candidates?.[0]?.finishReason;
      if (finish === 'MAX_TOKENS') return { error: 'The AI response was cut off. Try a shorter description.' };
      const text = response.text;
      if (!text) return { error: `Gemini returned no design${finish ? ` (${finish})` : ''}.` };
      return { text, model: response.modelVersion ?? this.model() };
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) return { error: 'Gemini quota or rate limit reached (free-tier limits are low). Wait a minute and try again.' };
        if (err.status === 400 && /api key/i.test(err.message)) return { error: 'The Gemini API key was rejected. Check GEMINI_API_KEY.' };
        if (err.status === 401 || err.status === 403) return { error: 'The Gemini API key was rejected or lacks access. Check GEMINI_API_KEY.' };
        if (err.status === 404) return { error: `Gemini model "${this.model()}" was not found. Set GARMENT_AI_MODEL to a current model.` };
        return { error: `Gemini error (${err.status}): ${err.message}` };
      }
      return { error: `Could not reach Gemini: ${err?.message ?? err}` };
    }
  },
};

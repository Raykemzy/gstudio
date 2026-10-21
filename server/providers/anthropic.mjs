// Anthropic Claude via the official SDK, with JSON-schema structured output.
import Anthropic from '@anthropic-ai/sdk';

let client;

export const anthropic = {
  id: 'anthropic',
  label: 'Claude',
  configured: () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE),
  model: () => process.env.GARMENT_AI_MODEL || 'claude-opus-5-5',
  supportsRanges: false,

  async generate({ system, prompt, schema }) {
    client ??= new Anthropic();
    try {
      const response = await client.beta.messages.create({
        model: this.model(),
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low', format: { type: 'json_schema', schema } },
        system,
        messages: [{ role: 'user', content: prompt }],
      });
      if (response.stop_reason === 'refusal') return { error: 'The AI declined this request. Try rephrasing the description.' };
      if (response.stop_reason === 'max_tokens') return { error: 'The AI response was cut off. Try a shorter description.' };
      const text = response.content.find((b) => b.type === 'text')?.text;
      if (!text) return { error: 'The AI returned no design.' };
      return { text, model: response.model };
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) return { error: 'The AI key was rejected. Check ANTHROPIC_API_KEY.' };
      if (err instanceof Anthropic.RateLimitError) return { error: 'The AI service is rate-limiting requests. Wait a moment and try again.' };
      if (err instanceof Anthropic.APIConnectionError) return { error: 'Could not reach the AI service.' };
      if (err instanceof Anthropic.APIError) return { error: `AI service error (${err.status ?? 'unknown'}): ${err.message}` };
      return { error: `Unexpected AI error: ${err?.message ?? err}` };
    }
  },
};

import { afterEach, describe, expect, it } from 'vitest';
import { proposalSchema, generateProposal, activeProvider } from '../server/ai.mjs';
import fields from '../src/model/fields.json';
import { applyProposal } from '../src/ai/proposal';
import { defaultParams } from '../src/model/schema';

const KEYS = ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_PROFILE', 'GARMENT_AI_PROVIDER'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const setEnv = (env: Record<string, string>) => {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
};
afterEach(() => setEnv(Object.fromEntries(Object.entries(saved).filter(([, v]) => v !== undefined)) as Record<string, string>));

describe('AI server contract', () => {
  it('structured-output schema covers exactly the editor fields', () => {
    const s: any = proposalSchema(); // eslint-disable-line @typescript-eslint/no-explicit-any -- plain-JS module
    expect(s.properties.core.required.sort()).toEqual([...Object.keys(fields.core), 'neckStyle', 'hemStyle'].sort());
    expect(s.properties.left.required.sort()).toEqual(Object.keys(fields.side).sort());
    expect(s.properties.core.properties.bodyLength.minimum).toBeUndefined();
  });

  it('includes numeric ranges for providers that support them', () => {
    const s: any = proposalSchema({ withRanges: true }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(s.properties.core.properties.bodyLength).toMatchObject({ minimum: 25, maximum: 120 });
    expect(s.properties.left.properties.sleeveAngle).toMatchObject({ minimum: -20, maximum: 80 });
  });

  it('a schema-shaped proposal is accepted by the client validation gate', () => {
    const p = defaultParams();
    const r = applyProposal({ name: 'X', summary: 'y', mirror: true, core: p.core, left: p.left, right: p.right, unsupported: [] });
    expect(r.ok).toBe(true);
  });

  it('picks the provider from whichever key is set, Gemini first, unless overridden', () => {
    setEnv({});
    expect(activeProvider()).toBeNull();
    setEnv({ ANTHROPIC_API_KEY: 'a' });
    expect(activeProvider()?.id).toBe('anthropic');
    setEnv({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' });
    expect(activeProvider()?.id).toBe('gemini');
    setEnv({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', GARMENT_AI_PROVIDER: 'anthropic' });
    expect(activeProvider()?.id).toBe('anthropic');
    setEnv({ GARMENT_AI_PROVIDER: 'gemini' }); // asked for Gemini but no key
    expect(activeProvider()).toBeNull();
  });

  it('without a key the server reports an error instead of throwing', async () => {
    setEnv({});
    expect(await generateProposal('boxy tee')).toEqual({ error: 'No AI key configured on the server.' });
  });
});

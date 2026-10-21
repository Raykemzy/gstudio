import { interpretOffline } from './offline';
import { applyProposal, type ProposalResult } from './proposal';

/**
 * The replaceable generation interface used by the UI. Both back-ends return a
 * raw proposal that goes through the same validation gate (applyProposal).
 */

export type GeneratorKind = 'ai' | 'offline';
export interface AiStatus {
  available: boolean;
  provider?: string;
  model?: string;
}

export async function fetchAiStatus(): Promise<AiStatus> {
  try {
    const res = await fetch('/api/ai/status');
    if (!res.ok) return { available: false };
    const body = await res.json();
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    return { available: body?.available === true, provider: str(body?.provider), model: str(body?.model) };
  } catch {
    return { available: false };
  }
}

export async function generateConcept(prompt: string, kind: GeneratorKind): Promise<ProposalResult & { source: GeneratorKind }> {
  if (kind === 'offline') return { ...applyProposal(interpretOffline(prompt)), source: 'offline' };
  let body: unknown;
  try {
    const res = await fetch('/api/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (body as { error?: unknown })?.error;
      return { ok: false, error: typeof msg === 'string' ? msg : `AI request failed (${res.status}).`, source: 'ai' };
    }
  } catch {
    return { ok: false, error: 'Could not reach the AI service. Manual editing and the offline interpreter still work.', source: 'ai' };
  }
  return { ...applyProposal((body as { proposal?: unknown })?.proposal), source: 'ai' };
}

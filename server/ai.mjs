// Server-side AI concept generation. Runs inside the Vite dev/preview server (see
// vite.config.ts) or the production server (serve.mjs), so credentials never reach
// the browser. A provider returns a structured garment proposal; the CLIENT then
// validates it against the same field ranges before anything touches the editor.
//
// Provider choice: GARMENT_AI_PROVIDER=gemini|anthropic, otherwise whichever key is
// set (GEMINI_API_KEY first). GARMENT_AI_MODEL overrides that provider's model.
import { readFileSync } from 'node:fs';
import { anthropic } from './providers/anthropic.mjs';
import { gemini } from './providers/gemini.mjs';

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // No .env file: fine, AI is optional.
}

const fields = JSON.parse(readFileSync(new URL('../src/model/fields.json', import.meta.url), 'utf8'));
const MAX_PROMPT_CHARS = 2000;
const PROVIDERS = [gemini, anthropic];

/** The provider in use, or null when none is configured. */
export function activeProvider() {
  const wanted = process.env.GARMENT_AI_PROVIDER?.toLowerCase();
  if (wanted) return PROVIDERS.find((p) => p.id === wanted && p.configured()) ?? null;
  return PROVIDERS.find((p) => p.configured()) ?? null;
}

export function aiConfigured() {
  return activeProvider() !== null;
}

function numberProps(specs, withRanges) {
  return Object.fromEntries(
    Object.keys(specs).map((k) => [
      k,
      {
        type: 'number',
        description: `${specs[k].label} (${k === 'sleeveAngle' ? 'degrees' : 'cm'}): ${specs[k].help}`,
        ...(withRanges ? { minimum: specs[k].min, maximum: specs[k].max } : {}),
      },
    ]),
  );
}

/** JSON schema for structured output. Every value is required so a proposal is always a complete garment. */
export function proposalSchema({ withRanges = false } = {}) {
  const sideSchema = {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(fields.side),
    properties: numberProps(fields.side, withRanges),
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'summary', 'mirror', 'core', 'left', 'right', 'unsupported'],
    properties: {
      name: { type: 'string', description: 'Short design name, max 40 characters.' },
      summary: { type: 'string', description: 'One or two sentences describing the silhouette.' },
      mirror: { type: 'boolean', description: 'true if left and right sides are identical.' },
      core: {
        type: 'object',
        additionalProperties: false,
        required: [...Object.keys(fields.core), 'neckStyle', 'hemStyle'],
        properties: {
          ...numberProps(fields.core, withRanges),
          neckStyle: { type: 'string', enum: fields.enums.neckStyle.options },
          hemStyle: { type: 'string', enum: fields.enums.hemStyle.options },
        },
      },
      left: { ...sideSchema, description: "The WEARER's left side." },
      right: { ...sideSchema, description: "The WEARER's right side." },
      unsupported: {
        type: 'array',
        items: { type: 'string' },
        description: 'Every requested detail the parameters cannot represent (e.g. pockets, prints, drawstrings, layered pieces, slits).',
      },
    },
  };
}

function rangeTable() {
  const row = (k, s) => `- ${k}: ${s.label}. ${s.help} Range ${s.min}..${s.max}, typical ${s.default}.`;
  return [
    'Centre parameters (core):',
    ...Object.entries(fields.core).map(([k, s]) => row(k, s)),
    `- neckStyle: one of ${fields.enums.neckStyle.options.join(', ')}.`,
    `- hemStyle: one of ${fields.enums.hemStyle.options.join(', ')} ("straight" draws straight lines from the centre hem point to each side hem point).`,
    'Per-side parameters (left and right; *Half values are measured from the centre line to that side):',
    ...Object.entries(fields.side).map(([k, s]) => row(k, s)),
  ].join('\n');
}

const SYSTEM_PROMPT = `You translate a fashion founder's description of a T-shirt into numeric parameters for a flat garment editor. All lengths are centimetres on a flat-laid adult T-shirt.

${rangeTable()}

Guidance:
- Preserve unusual intent. Oversized, cropped, extreme shoulders, very wide or long sleeves, asymmetric hems and unconventional necklines are all wanted; do not drift back to a standard tee.
- Stay inside every range. Keep the armpit (shoulderDrop + armholeDepth) at least 5 cm above each side's hem (bodyLength + hemOffset), the neck narrower than the shoulders (neckWidth/2 <= shoulderHalf - 3), and hanging sleeves clear of the body.
- "Longer on the left" means the wearer's left: give left a larger hemOffset than right and set mirror to false. For a clean diagonal hem use hemStyle "straight" with opposite-signed offsets.
- "Dropped shoulders" means wider shoulderHalf (often beyond chestHalf) and a deeper armhole; "boxy" means hemHalf close to chestHalf and a straight hem.
- List in "unsupported" every requested detail these parameters cannot express, instead of silently approximating it. If you approximate something, say so in "unsupported" too.`;

/** Returns { proposal, provider, model } on success, or { error } with a user-readable message. */
export async function generateProposal(prompt) {
  const provider = activeProvider();
  if (!provider) return { error: 'No AI key configured on the server.' };
  const result = await provider.generate({ system: SYSTEM_PROMPT, prompt, schema: proposalSchema({ withRanges: provider.supportsRanges }) });
  if (result.error) return { error: result.error };
  try {
    return { proposal: JSON.parse(result.text), provider: provider.id, model: result.model };
  } catch {
    return { error: 'The AI returned malformed data.' };
  }
}

function readBody(req, limit = 16_384) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > limit) reject(new Error('Request too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/** Connect-style middleware: GET /api/ai/status, POST /api/ai/generate. */
export function aiMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0];
    if (url === '/api/ai/status' && req.method === 'GET') {
      const p = activeProvider();
      return sendJson(res, 200, p ? { available: true, provider: p.label, model: p.model() } : { available: false });
    }
    if (url !== '/api/ai/generate' || req.method !== 'POST') return next();
    let prompt;
    try {
      prompt = JSON.parse(await readBody(req)).prompt;
    } catch {
      return sendJson(res, 400, { error: 'Invalid request.' });
    }
    if (typeof prompt !== 'string' || !prompt.trim()) return sendJson(res, 400, { error: 'Describe the garment first.' });
    if (prompt.length > MAX_PROMPT_CHARS) return sendJson(res, 400, { error: `Keep the description under ${MAX_PROMPT_CHARS} characters.` });
    const result = await generateProposal(prompt.trim());
    sendJson(res, result.error ? 502 : 200, result);
  };
}

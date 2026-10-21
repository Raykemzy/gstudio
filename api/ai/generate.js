// Vercel serverless function: POST /api/ai/generate (Vercel parses the JSON body).
import { handleGenerate } from '../../server/ai.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid request.' });
    }
  }
  const [status, json] = await handleGenerate(body);
  res.status(status).json(json);
}

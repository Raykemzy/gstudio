// Vercel serverless function: GET /api/ai/status
import { aiStatus } from '../../server/ai.mjs';

export default function handler(_req, res) {
  res.status(200).json(aiStatus());
}

// Minimal production server: serves the built app from dist/ and the AI endpoints.
// Usage: npm run build && npm start   (PORT defaults to 4173)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiMiddleware, aiConfigured } from './ai.mjs';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const ai = aiMiddleware();

createServer((req, res) => {
  ai(req, res, async () => {
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const file = join(root, path === '/' ? 'index.html' : path);
    if (!file.startsWith(root)) return res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(await readFile(join(root, 'index.html')));
    }
  });
}).listen(Number(process.env.PORT ?? 4173), '127.0.0.1', function () {
  console.log(`Garment Studio on http://localhost:${this.address().port}  (AI ${aiConfigured() ? 'enabled' : 'disabled: no key'})`);
});

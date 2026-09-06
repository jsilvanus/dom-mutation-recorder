import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'public');
const allowedFiles = new Set(['index.html', 'app.js', 'style.css']);

const server = createServer(async (req, res) => {
  const pathname = req.url === '/' ? 'index.html' : decodeURIComponent(req.url || '/index.html').replace(/^\/+/, '');
  if (!allowedFiles.has(pathname)) {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  const file = join(publicDir, pathname);
  try {
    const content = await readFile(file);
    res.setHeader('content-type', mimeType(file));
    res.end(content);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
});

server.listen(0, () => {
  const address = server.address();
  if (address && typeof address === 'object') {
    console.log(`http://127.0.0.1:${address.port}`);
  }
});

function mimeType(file: string): string {
  const ext = extname(file);
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
    }[ext] || 'text/plain; charset=utf-8'
  );
}

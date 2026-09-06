import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomRecorder } from '../packages/playwright/src/index.js';

const publicDir = resolve(process.cwd(), 'apps/demo/public');
const allowedFiles = new Set(['index.html', 'app.js', 'style.css']);

let server: ReturnType<typeof createServer>;
let baseUrl = '';

beforeAll(async () => {
  server = createServer(async (req, res) => {
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
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address !== 'object') throw new Error('Failed to start test server');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('playwright recorder', () => {
  it('records user actions and semantic mutations', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const recorder = await DomRecorder.attach(page, { redactPasswords: true, redactInputValues: true });

    await page.goto(baseUrl);
    await page.getByRole('button', { name: 'Add item' }).click();
    await page.waitForSelector('.cart-item');

    const recording = await recorder.stop();
    await browser.close();

    expect(recording.initialSnapshot.html).toContain('DOM Recorder Demo');
    expect(recording.events.some((event) => event.type === 'user.click')).toBe(true);
    expect(recording.events.some((event) => event.type === 'dom.added')).toBe(true);
    expect(recording.transactions?.some((transaction) => transaction.semanticChanges.length > 0)).toBe(true);
  });
});

function mimeType(file: string): string {
  const ext = extname(file);
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
    }[ext] || 'text/plain; charset=utf-8'
  );
}

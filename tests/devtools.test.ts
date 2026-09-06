// @vitest-environment node
//
// End-to-end test for the DevTools recording panel (apps/devtools/app.js). Unlike
// packages/playwright and the Chrome extension, this app attaches directly to a same-origin
// <iframe>'s DOM from its own module scope — no chrome.scripting.executeScript/addInitScript
// involved — so it imports packages/core's compiled output as plain ES modules (requires
// `npm run build` to have run; `pretest` does this automatically). This test drives the real
// demo server's routing (including /dist/*) with a real browser, exercising that whole chain.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), 'apps/demo');
const publicDir = join(root, 'public');
const devtoolsDir = join(root, '../devtools');
const distDir = join(root, '../../dist');

let server: ReturnType<typeof createServer>;
let baseUrl = '';

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(req.url || '/').replace(/^\/+/, '');
    const file = resolveRoute(pathname);
    if (!file) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    try {
      const content = await readFile(file);
      res.setHeader('content-type', mimeType(file));
      res.end(content);
    } catch {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  await new Promise<void>((resolveListen) => server.listen(0, resolveListen));
  const address = server.address();
  if (!address || typeof address !== 'object') throw new Error('Failed to start test server');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
});

describe('devtools recording panel', () => {
  it('records real clicks/mutations from the preview iframe using core selector output', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const pageErrors: Error[] = [];
      page.on('pageerror', (error) => pageErrors.push(error));

      // Deliberately no trailing slash: apps/devtools/index.html's script tag must resolve
      // correctly either way (see apps/devtools/index.html's absolute src).
      await page.goto(`${baseUrl}/devtools`);
      const previewHandle = await page.waitForSelector('#preview');
      await page.waitForFunction(() => {
        const iframe = document.querySelector('iframe#preview') as HTMLIFrameElement | null;
        try {
          return Boolean(iframe?.contentWindow?.document?.querySelector('#add-item'));
        } catch {
          return false;
        }
      });

      await page.click('#start-recording');
      const frame = await previewHandle.contentFrame();
      if (!frame) throw new Error('preview iframe not attached');
      await frame.click('#add-item');
      await frame.waitForSelector('.cart-item');
      await page.click('#stop-recording');

      expect(pageErrors).toEqual([]);

      const eventTypes = await page.evaluate(() =>
        [...document.querySelectorAll('#events li')].map((li) => li.textContent?.split(' ')[0]),
      );
      expect(eventTypes).toContain('user.click');
      expect(eventTypes).toContain('dom.added');

      const clickTarget = await page.evaluate(() => {
        const item = [...document.querySelectorAll('#events li')].find((li) => li.textContent?.startsWith('user.click'));
        (item as HTMLElement | undefined)?.click();
        const json = document.querySelector('#selected')?.textContent;
        return json ? JSON.parse(json).target : null;
      });
      // Confirms the unified core selector output (SelectorCandidate[] with confidence),
      // not devtools' old plain-string-array implementation.
      expect(clickTarget.selector).toBe('#add-item');
      expect(clickTarget.selectors).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'stable-id', selector: '#add-item', confidence: 1 })]),
      );
    } finally {
      await browser.close();
    }
  });
});

function resolveRoute(pathname: string): string | null {
  if (pathname === '' || pathname === 'index.html') return join(publicDir, 'index.html');
  if (pathname === 'app.js') return join(publicDir, 'app.js');
  if (pathname === 'devtools' || pathname === 'devtools/' || pathname === 'devtools/index.html') return join(devtoolsDir, 'index.html');
  if (pathname === 'devtools/app.js') return join(devtoolsDir, 'app.js');
  if (pathname.startsWith('dist/')) return resolveWithin(distDir, pathname.slice('dist/'.length));
  return null;
}

function resolveWithin(baseDir: string, relativePath: string): string | null {
  const resolved = join(baseDir, relativePath);
  const relativeToBase = relative(baseDir, resolved);
  if (relativeToBase.startsWith('..') || relativeToBase === '') return null;
  return resolved;
}

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

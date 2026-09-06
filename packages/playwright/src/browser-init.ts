import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserRecorderInit } from '../../core/src/browser-bootstrap.js';

export type { BrowserRecorderInit } from '../../core/src/browser-bootstrap.js';

const bundlePath = join(dirname(fileURLToPath(import.meta.url)), '../../core/dist/browser-bootstrap.bundle.js');

let cachedBundleSource: string | undefined;

function readBundleSource(): string {
  if (!cachedBundleSource) {
    cachedBundleSource = readFileSync(bundlePath, 'utf8');
  }
  return cachedBundleSource;
}

// Playwright's page.addInitScript/page.evaluate serialize a *function* by its own source
// text alone — they don't bundle its imports. browserRecorderBootstrap now imports the rest
// of packages/core, so it can no longer be passed directly; instead we inject the
// pre-bundled, self-contained script (see scripts/build-browser-bootstrap.mjs) as raw content
// and immediately invoke it in the same script.
//
// Note: page.addInitScript({ content }) does NOT run content the way a real <script> tag
// would — a top-level `var` in the bundle does not become a `window` property the way it
// would with page.evaluate(string) or a real script tag (verified empirically). So the
// invocation below references the bundle's `DomRecorderBootstrap` identifier directly
// (same script, same scope) rather than reading it back off `window`.
export function buildBrowserRecorderInitScript(options: BrowserRecorderInit): string {
  return `${readBundleSource()}\n;DomRecorderBootstrap.browserRecorderBootstrap(${JSON.stringify(options)});`;
}

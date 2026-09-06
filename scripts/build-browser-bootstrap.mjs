// Bundles packages/core/src/browser-bootstrap.ts into a single self-contained script.
//
// The recorder logic in browser-bootstrap.ts imports from the rest of packages/core
// (selectors/snapshot/mutations/redaction) so there is exactly one implementation of
// selector generation, snapshotting, and mutation handling. But the two runtime consumers
// that inject it into a live page — Playwright's page.addInitScript/page.evaluate, and
// Chrome's chrome.scripting.executeScript({ files }) — need a plain script with no import
// statements. This script produces that bundle once; consumers read the built file instead
// of re-bundling at runtime.
import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = join(root, 'packages/core/dist/browser-bootstrap.bundle.js');

await build({
  entryPoints: [join(root, 'packages/core/src/browser-bootstrap.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'DomRecorderBootstrap',
  target: 'es2022',
  outfile,
  logLevel: 'info',
});

// apps/extension is loaded unpacked by Chrome with no build step of its own, so the bundle
// must physically live inside the extension's own directory for
// chrome.scripting.executeScript({ files: [...] }) to find it.
const extensionCopyPath = join(root, 'apps/extension/browser-bootstrap.bundle.js');
await mkdir(dirname(extensionCopyPath), { recursive: true });
await copyFile(outfile, extensionCopyPath);
console.log(`Copied bundle to ${extensionCopyPath}`);

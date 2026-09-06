// Copies packages/core's compiled JS (not the .d.ts files) into apps/extension/core/.
//
// apps/extension/shared.js wants to import packages/core's real correlateRecording/
// buildSemanticDiff instead of maintaining its own duplicate, but an unpacked Chrome
// extension can only load files that live inside its own directory — unlike apps/devtools,
// it can't fetch packages/core's compiled output from the repo's dist/ over HTTP. This copies
// that output into the extension's own tree so it can import it like any other local module.
//
// Requires `tsc -p tsconfig.build.json` (npm run build) to have already produced dist/.
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDir = join(root, 'dist/packages/core/src');
const targetDir = join(root, 'apps/extension/core');

await rm(targetDir, { recursive: true, force: true });
await mkdir(targetDir, { recursive: true });

const entries = await readdir(sourceDir, { withFileTypes: true });
const jsFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.js'));
await Promise.all(jsFiles.map((entry) => cp(join(sourceDir, entry.name), join(targetDir, entry.name))));

console.log(`Copied ${jsFiles.length} compiled core modules to ${targetDir}`);

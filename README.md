# dom-mutation-recorder

Local-first DOM recording toolkit for browser extensions and Playwright/E2E debugging.

## What it does

- captures an initial DOM snapshot
- records user actions, DOM mutations, and navigation
- correlates actions with related mutations
- exports concise AI-facing evidence and full lossless JSON

## Architecture

- `packages/core` — snapshots, selectors, mutation normalization, correlation, semantic diff, JSON serialization
- `packages/playwright` — Playwright recorder attachment and browser bootstrap
- `packages/exporter` — Markdown/JSON/HTML evidence export
- `packages/chrome` — Chrome-side recorder bootstrap adapter
- `apps/demo` — local demo app for recording
- `apps/devtools` — simple recorder inspection UI
- `apps/cli` — local CLI for inspect/export

## Recording flow

Human interaction  
↓  
Browser recording  
↓  
DOM + actions  
↓  
Semantic correlation  
↓  
AI export  
↓  
AI coding agent  
↓  
Extension / E2E code

## Install

```bash
npm install
```

## Run tests

```bash
npm test
```

## Playwright usage

```ts
import { chromium } from 'playwright';
import { DomRecorder } from './packages/playwright/src/index.js';

const browser = await chromium.launch();
const page = await browser.newPage();
const recorder = await DomRecorder.attach(page);

await page.goto('http://localhost:3000');
await page.getByRole('button', { name: 'Add item' }).click();

const recording = await recorder.stop();
await recorder.export('./test-results/add-item', 'concise');
```

## CLI

```bash
npm run cli -- inspect recording.json
npm run cli -- export recording.json --out ./recording --mode developer
```

## Demo app

```bash
npm run demo
```

The demo includes buttons, forms, async updates, list mutations, a modal, loading state, and notifications.

## DevTools UI

Open the DevTools panel at the demo server URL and use the real control bar to:

- load a target page
- start/stop recording
- inspect live events
- export recording/evidence

The same UI still supports loading a `recording.json` file for inspection.

## AI export

Exports:

- `recording.json` — full lossless recording
- `evidence.json` — transactions + semantic changes
- `summary.md` — concise AI-facing narrative
- `initial.html` — initial DOM
- `final.html` — final DOM

## Privacy

Recordings may contain page content and should be treated as sensitive artifacts. Input values and passwords are redacted by default.

## Limitations

- accessibility naming is heuristic, not a full accessibility tree
- navigation correlation is basic and can be extended
- the Chrome side is currently an adapter package, not a full packaged extension

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
- `apps/devtools` — simple recorder inspection UI (has its own separate, not-yet-unified copy
  of the selector/mutation logic below — see Limitations)
- `apps/cli` — local CLI for inspect/export

`packages/core/src/browser-bootstrap.ts` is the single implementation of the in-page recorder
(selector generation, DOM snapshotting, mutation handling) that actually runs inside a
recorded page. Both `packages/playwright` and the Chrome extension (`apps/extension`) inject
it, but neither can hand it to the browser as-is: Playwright's `page.addInitScript`/
`page.evaluate` and Chrome's `chrome.scripting.executeScript({ func })` serialize a function
by its own source text with no bundling, so a version that imports the rest of `packages/core`
can't be passed to them directly. `scripts/build-browser-bootstrap.mjs` (esbuild) bundles it
into one self-contained script; `npm run build:browser-bootstrap` produces it (also run
automatically before `npm test` and `npm run build`). If you're loading `apps/extension`
unpacked in Chrome, run that script (or `npm run build`) at least once first — its output
(`apps/extension/browser-bootstrap.bundle.js`) isn't checked into git.

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

As a dependency in your own project:

```bash
npm install dom-mutation-recorder
```

Available entry points: `dom-mutation-recorder` (core), `dom-mutation-recorder/playwright`,
`dom-mutation-recorder/exporter`, `dom-mutation-recorder/chrome`. A `domrec` CLI binary is
also installed (see CLI below).

To work on this repo itself:

```bash
npm install
```

## Run tests

```bash
npm test
```

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run build       # compile packages/* + apps/cli to dist/, and bundle browser-bootstrap
```

`npm run build` is what `npm publish` runs automatically (via `prepublishOnly`); CI also runs
it on every push/PR so a build break surfaces immediately rather than only at release time.

## Playwright usage

```ts
import { chromium } from 'playwright';
import { DomRecorder } from 'dom-mutation-recorder/playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
const recorder = await DomRecorder.attach(page);

await page.goto('http://localhost:3000');
await page.getByRole('button', { name: 'Add item' }).click();

const recording = await recorder.stop();
await recorder.export('./test-results/add-item', 'concise');
```

Typical test workflow:

1. Attach the recorder before `page.goto()`.
2. Run the test as usual.
3. On success or failure, call `stop()` and `export()`.
4. Read the files from `test-results/<test-name>/`.

The export folder contains:

- `recording.json`
- `evidence.json`
- `summary.md`
- `initial.html`
- `final.html`

For failed tests, the AI-ready files are usually `summary.md` and `evidence.json`.

If you want old export artifacts cleared at the start of a run, keep the default
`storeOldResults: false`. Set `storeOldResults: true` only if you want to retain
older export artifacts in the directory.

Example `afterEach` export:

```ts
let recorder;

test.beforeEach(async ({ page }) => {
  recorder = await DomRecorder.attach(page, { storeOldResults: false });
});

test.afterEach(async (_, testInfo) => {
  const resultDir = testInfo.outputPath('dom-recorder');

  if (testInfo.status !== testInfo.expectedStatus) {
    await recorder.export(resultDir, 'developer');
  }
});
```

## CLI

If installed as a dependency, a `domrec` binary is available:

```bash
domrec inspect recording.json
domrec export recording.json --out ./recording --mode developer
```

Working in this repo directly:

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
- navigate within the target while recording
- inspect live events
- copy an AI chat drop summary
- export recording/evidence

The same UI still supports loading a `recording.json` file for inspection.

## Chrome extension workflow

Run `npm run build:browser-bootstrap` (or `npm run build`) at least once first — it generates
`apps/extension/browser-bootstrap.bundle.js`, which the extension loads and isn't checked
into git. Re-run it after pulling changes to `packages/core`.

Load `apps/extension` as an unpacked extension in Chrome. Then:

1. Open the extension panel.
2. Navigate the active tab to any page, including Google.
3. Click **Start recording**.
4. Perform the interaction.
5. Click **Stop**.
6. Click **Copy AI drop** or **Copy JSON**.
7. If you want files instead of clipboard text, save the recording from the side panel export actions and use the same `recording.json`, `evidence.json`, `summary.md`, `initial.html`, and `final.html` artifact set.

The extension attaches to the active tab and reinjects the recorder after same-tab navigations, so search-result navigations are captured too.

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

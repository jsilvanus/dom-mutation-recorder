# dom-mutation-recorder

Local-first DOM recording toolkit for browser extensions and Playwright/E2E debugging.

## What it does

- captures an initial DOM snapshot
- records user actions, DOM mutations, and navigation
- correlates actions with related mutations
- exports concise AI-facing evidence and full lossless JSON

## Architecture

- `packages/core` — snapshots, selectors, mutation normalization, redaction, correlation,
  semantic diff, JSON serialization, AI-drop clipboard text
- `packages/playwright` — Playwright recorder attachment and browser bootstrap
- `packages/exporter` — Markdown/JSON/HTML evidence export (file-based; Node-only)
- `packages/chrome` — Chrome-side recorder bootstrap adapter, for consumers who bundle it into
  their own content script
- `apps/extension` — the packaged Chrome extension (side panel + service worker); see Chrome
  extension workflow below
- `apps/demo` — local demo app for recording
- `apps/devtools` — live recorder inspection UI, attaches directly to a same-origin preview
  `<iframe>` and imports `packages/core`'s compiled output as plain ES modules
- `apps/cli` — local CLI for inspect/export

There is exactly one implementation of selector generation, DOM snapshotting, and mutation
handling — `packages/core`'s `selectors.ts`/`snapshot.ts`/`mutations.ts`/`redaction.ts` — used
by every recording surface, in whichever way each one is able to consume it:

- `apps/devtools/app.js` runs in the same JS realm as its own top-level script (it just holds
  a reference to a same-origin iframe's DOM), so it imports `packages/core`'s compiled output
  directly as ES modules — no bundling needed, just `npm run build` having been run once.
- `packages/playwright` and the Chrome extension (`apps/extension`) instead *inject* the
  recorder into a page they don't otherwise share a scope with. Neither can hand it the real
  TypeScript module graph as-is: Playwright's `page.addInitScript`/`page.evaluate` and
  Chrome's `chrome.scripting.executeScript({ func })` serialize a function by its own source
  text with no bundling, so a version that imports the rest of `packages/core` can't be passed
  to them directly. `packages/core/src/browser-bootstrap.ts` is that in-page entry point
  (reusing the same core functions); `scripts/build-browser-bootstrap.mjs` (esbuild) bundles
  it into one self-contained script that both consumers inject instead. `npm run
  build:browser-bootstrap` produces it (also run automatically before `npm test` and `npm run
  build`). If you're loading `apps/extension` unpacked in Chrome, run that script (or `npm run
  build`) at least once first — its output (`apps/extension/browser-bootstrap.bundle.js`)
  isn't checked into git.

Either way, `npm run build` needs to have been run at least once for `apps/devtools` and
`apps/extension` to work — `apps/demo`'s server serves the compiled `dist/` output at `/dist/*`
for the DevTools panel to import, and `scripts/copy-core-for-extension.mjs` (`npm run
build:extension-core`, part of `npm run build`) copies the same compiled output into
`apps/extension/core/` so the extension's side panel/service worker (`apps/extension/shared.js`)
can import `correlateRecording`/`buildAiDropText` from it too — an unpacked extension can only
load files from within its own directory, so it can't fetch `dist/` over HTTP the way DevTools
does. Both UIs' "Copy AI drop" buttons render the same clipboard text format from the same
`packages/core/src/ai-drop.ts` function.

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

Run `npm run build` at least once first — the panel imports `packages/core`'s compiled output,
which `apps/demo`'s server serves at `/dist/*`. Re-run it after pulling changes to
`packages/core`.

Open the DevTools panel at the demo server URL and use the real control bar to:

- load a target page
- start/stop recording
- navigate within the target while recording
- inspect live events
- copy an AI chat drop summary
- export recording/evidence

The same UI still supports loading a `recording.json` file for inspection.

## Chrome extension workflow

Run `npm run build` at least once first — it generates `apps/extension/browser-bootstrap.bundle.js`
and `apps/extension/core/` (a copy of `packages/core`'s compiled output), which the extension
loads and which aren't checked into git. Re-run it after pulling changes to `packages/core`.

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
- `packages/chrome` is a thin adapter for consumers who bundle it into their own content
  script — `apps/extension` is the actual packaged extension, and doesn't use it

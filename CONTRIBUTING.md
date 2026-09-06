# Contributing

## Don't hand-duplicate the in-page recorder logic

`packages/core/src/browser-bootstrap.ts` is the single implementation of selector generation,
DOM snapshotting, and mutation handling that runs inside a recorded page. It imports the rest
of `packages/core` (`selectors.ts`, `snapshot.ts`, `mutations.ts`, `redaction.ts`) normally —
there is exactly one copy of this logic to fix or extend.

It gets to the browser two ways:

- `packages/playwright` bundles it (`scripts/build-browser-bootstrap.mjs`, esbuild) into a
  self-contained script and injects that as raw content via `page.addInitScript`/
  `page.evaluate`.
- `apps/extension`'s service worker injects the same bundle via
  `chrome.scripting.executeScript({ files: ['browser-bootstrap.bundle.js'] })`.

Neither can be handed the function directly: `page.addInitScript`/`page.evaluate(fn)` and
`chrome.scripting.executeScript({ func })` serialize a function by its own source text alone,
with no bundling of its imports — a version that imports sibling modules would throw
`ReferenceError`s at runtime. If you add a new capability to the recorder, add it to
`browser-bootstrap.ts` (reusing `packages/core`'s functions) and rebuild the bundle
(`npm run build:browser-bootstrap`); don't copy logic into `apps/extension/shared.js` or
inline it again elsewhere.

`apps/devtools/app.js` attaches directly to a same-origin preview `<iframe>`'s DOM from its
own module scope — it isn't injected anywhere, it just holds a normal (cross-realm) reference
to the iframe's `document`. That means none of the above constraint applies to it: it imports
`packages/core`'s compiled output (`npm run build`) as plain ES modules
(`../dist/packages/core/src/index.js`, served by `apps/demo`'s server at `/dist/*`) and calls
`describeElement`/`captureRecordingSnapshot`/`describeMutationRecord`/etc. directly. Those
core functions are written to be realm-safe (`nodeType` checks rather than `instanceof`)
specifically so this works — don't introduce an `instanceof Element`/`instanceof
HTMLInputElement` check into `packages/core` without checking whether it'd break on a
cross-realm node. Only the event-handling glue that needs `win.KeyboardEvent`-style
realm-specific classes (there's no core equivalent for reading live DOM `Event`s) stays local
to `apps/devtools/app.js`, mirroring `browser-bootstrap.ts`'s `emitUser`.

`apps/extension/shared.js` also runs in the extension's own module context (service worker /
side panel), not injected into a page, so it isn't under the self-containment constraint
either — but an unpacked Chrome extension can only load files from within its own directory,
unlike `apps/devtools`, which can `import` from the repo's `dist/` over HTTP. So
`scripts/copy-core-for-extension.mjs` (`npm run build:extension-core`) copies `packages/core`'s
compiled output into `apps/extension/core/`, and `shared.js` imports `correlateRecording`/
`buildAiDropText` from `./core/index.js` instead of maintaining its own copies. `shared.js`
keeps only `DEFAULT_RECORDING_CONFIG` locally.

`buildAiDropText` (the "PAGE / INITIAL STATE / ACTIONS / FINAL STATE" plain-text clipboard
format used by both `apps/extension`'s and `apps/devtools`'s "Copy AI drop" buttons) lives in
`packages/core/src/ai-drop.ts`, not `packages/exporter`: `packages/exporter` imports
`node:fs/promises` for its file-writing exports, so a browser trying to import anything from
it would fail outright, even for an unrelated function that doesn't touch the filesystem —
`packages/core` has no such Node-only dependency and is already the shared browser+Node
surface both `apps/devtools` and `apps/extension` import from. If you add another
browser-facing formatter/utility, it belongs in `packages/core` for the same reason unless it
is genuinely Node-only (like file export).

## Before pushing

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

`npm test`'s `pretest` script and `npm run build` both rebuild
`apps/extension/browser-bootstrap.bundle.js` and `apps/extension/core/` — if you're testing
the unpacked extension manually in Chrome, re-run one of them after changing `packages/core`.

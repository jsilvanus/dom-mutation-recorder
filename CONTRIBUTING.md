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

`apps/extension/shared.js` still has its own small amount of genuinely extension-specific,
non-injected code (`correlateRecording`, `buildAiDropText`, `DEFAULT_RECORDING_CONFIG`) — that
code runs in the extension's own module context (service worker / side panel), not injected
into a page, so it isn't under the self-containment constraint either. It remains a separate
implementation from `packages/core`'s equivalent functions (`correlateRecording`,
`buildSemanticDiff`) because an unpacked Chrome extension can only load files from within its
own directory — unlike `apps/devtools`, it can't `import` from the repo's `dist/` over HTTP.
Copying `packages/core`'s compiled output into `apps/extension/` at build time (the same way
`scripts/build-browser-bootstrap.mjs` already copies the bundle there) would let it import
from core directly instead.

## Before pushing

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

`npm test`'s `pretest` script and `npm run build` both rebuild
`apps/extension/browser-bootstrap.bundle.js` — if you're testing the unpacked extension
manually in Chrome, re-run one of them after changing `packages/core`.

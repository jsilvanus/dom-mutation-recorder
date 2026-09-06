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

`apps/extension/shared.js` still has its own small amount of genuinely extension-specific,
non-injected code (`correlateRecording`, `buildAiDropText`, `DEFAULT_RECORDING_CONFIG`) — that
code runs in the extension's own module context (service worker / side panel), not injected
into a page, so it isn't under the same constraint. It's currently a separate implementation
from `packages/core`'s equivalent functions (`correlateRecording`, `buildSemanticDiff`) only
because `packages/core` ships as TypeScript with no build step consumable by an unbundled
browser extension; once that changes it should import from core directly instead.

`apps/devtools/app.js` has its own, still-separate implementation of the selector/mutation
logic for its live recording panel — a known, not-yet-addressed duplication. Fixing it means
giving it the same bundle-injection treatment as `apps/extension`.

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

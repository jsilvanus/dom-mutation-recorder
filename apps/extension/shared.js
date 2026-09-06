// apps/extension is loaded unpacked and can only load files from within its own directory —
// unlike apps/devtools (which fetches packages/core's compiled output over HTTP), so
// scripts/copy-core-for-extension.mjs (npm run build:extension-core) copies it in here.
import { buildAiDropText, correlateRecording } from './core/index.js';

export { buildAiDropText, correlateRecording };

export const DEFAULT_RECORDING_CONFIG = {
  redactInputValues: true,
  redactPasswords: true,
  correlationWindowMs: 750,
  scopeSelector: null,
  captureActionSnapshots: true,
  idleSnapshotDelayMs: 600,
};

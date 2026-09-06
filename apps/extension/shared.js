// apps/extension is loaded unpacked and can only load files from within its own directory —
// unlike apps/devtools (which fetches packages/core's compiled output over HTTP), so
// scripts/copy-core-for-extension.mjs (npm run build:extension-core) copies it in here.
import { correlateRecording } from './core/index.js';

export { correlateRecording };

export const DEFAULT_RECORDING_CONFIG = {
  redactInputValues: true,
  redactPasswords: true,
  correlationWindowMs: 750,
  scopeSelector: null,
};

export function buildAiDropText(recording) {
  const transactions = recording.transactions || correlateRecording(recording, DEFAULT_RECORDING_CONFIG);
  const lines = [];
  lines.push('PAGE');
  lines.push(`URL: ${recording.url}`);
  lines.push(`Title: ${recording.title}`);
  lines.push(`Scope: ${recording.scopeSelector || 'entire page'}`);
  lines.push('');
  lines.push('INITIAL STATE');
  lines.push(recording.initialSnapshot?.html || '—');
  lines.push('');
  lines.push('ACTIONS');
  for (const [index, transaction] of transactions.entries()) {
    lines.push(`Action ${index + 1}: ${transaction.action.type}`);
    lines.push(`Target: ${transaction.action.target?.selector || transaction.action.target?.name || 'unknown'}`);
    for (const change of transaction.semanticChanges || []) {
      lines.push(`- ${change.summary}`);
    }
    lines.push('');
  }
  lines.push('FINAL STATE');
  lines.push(recording.finalSnapshot?.html || '—');
  return lines.join('\n');
}

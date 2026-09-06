import type { Recording, RecordingConfig } from './model.js';
import { correlateRecording } from './correlation.js';

// Plain-text clipboard format for pasting a recording straight into an AI chat — distinct
// from packages/exporter's Markdown summary.md, which is a file export (and can't be used
// here anyway: it imports node:fs/promises, which isn't available in a browser).
export function buildAiDropText(recording: Recording, config: RecordingConfig = {}): string {
  const transactions = recording.transactions || correlateRecording(recording, config);
  const lines: string[] = [];
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

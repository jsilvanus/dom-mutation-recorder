import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ActionTransaction, Recording, SemanticChange } from '../../core/src/model.js';
import { correlateRecording } from '../../core/src/correlation.js';
import { serializeRecording } from '../../core/src/serialization.js';

export type ExportMode = 'concise' | 'developer';

export type ExportOptions = {
  mode?: ExportMode;
  storeOldResults?: boolean;
};

const ARTIFACT_FILES = ['recording.json', 'evidence.json', 'summary.md', 'initial.html', 'final.html'];

export async function exportRecordingArtifacts(
  recording: Recording,
  directory: string,
  options: ExportOptions = {},
): Promise<void> {
  if (options.storeOldResults !== true) {
    await clearRecordingArtifacts(directory);
  }
  await mkdir(directory, { recursive: true });
  const mode = options.mode ?? 'concise';
  const transactions = recording.transactions?.length ? recording.transactions : correlateRecording(recording);
  const finalHtml = recording.finalSnapshot?.html || recording.initialSnapshot.html;
  const evidence = { recording: recording.id, mode, transactions };
  await Promise.all([
    writeFile(join(directory, 'recording.json'), serializeRecording({ ...recording, transactions }), 'utf8'),
    writeFile(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf8'),
    writeFile(join(directory, 'summary.md'), renderSummary(recording, transactions, mode), 'utf8'),
    writeFile(join(directory, 'initial.html'), recording.initialSnapshot.html, 'utf8'),
    writeFile(join(directory, 'final.html'), finalHtml, 'utf8'),
  ]);
}

export async function clearRecordingArtifacts(directory: string): Promise<void> {
  await Promise.all(ARTIFACT_FILES.map((name) => rm(join(directory, name), { force: true })));
}

export function renderSummary(recording: Recording, transactions: ActionTransaction[], mode: ExportMode): string {
  const lines: string[] = [];
  lines.push('# DOM Recording');
  lines.push(`URL: ${recording.url}`);
  lines.push(`Title: ${recording.title}`);
  lines.push('');
  lines.push('## Actions');
  if (!transactions.length) {
    lines.push('- None');
  }
  for (const [index, transaction] of transactions.entries()) {
    lines.push('');
    lines.push(`### Action ${index + 1}`);
    lines.push(`- Type: ${transaction.action.type}`);
    lines.push(`- Target: ${describeTarget(transaction.action.target)}`);
    if (transaction.semanticChanges.length) {
      lines.push('- Changes:');
      for (const change of transaction.semanticChanges) {
        lines.push(`  - ${renderChange(change, mode)}`);
      }
    }
  }
  return lines.join('\n');
}

function renderChange(change: SemanticChange, mode: ExportMode): string {
  if (mode === 'developer' && change.before !== undefined && change.after !== undefined) {
    return `${change.summary} (${String(change.before)} → ${String(change.after)})`;
  }
  return change.summary;
}

function describeTarget(target: { selector?: string; name?: string | null; tagName?: string | null; path?: string | null } | undefined): string {
  if (!target) return 'unknown';
  return target.selector || target.name || target.path || target.tagName || 'unknown';
}

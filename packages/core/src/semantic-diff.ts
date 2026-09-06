import type { ActionTransaction, RecordingEvent, SemanticChange } from './model.js';

export function buildSemanticDiff(transaction: ActionTransaction): SemanticChange[] {
  const changes: SemanticChange[] = [];
  for (const mutation of transaction.mutations) {
    if (mutation.type === 'dom.attributes') {
      const attribute = String(mutation.data.attribute || '');
      if (isNoiseAttribute(attribute)) continue;
      changes.push({
        kind: 'attribute',
        summary: `${describeTarget(mutation)} attribute ${attribute} changed`,
        target: mutation.target,
        before: mutation.data.oldValue as string | null,
        after: mutation.data.newValue as string | null,
        selector: mutation.target?.selector,
      });
    } else if (mutation.type === 'dom.text') {
      const oldText = String(mutation.data.oldText || '');
      const newText = String(mutation.data.newText || '');
      if (oldText === newText) continue;
      changes.push({
        kind: 'text',
        summary: `${describeTarget(mutation)} text changed`,
        target: mutation.target,
        before: oldText,
        after: newText,
        selector: mutation.target?.selector,
      });
    } else if (mutation.type === 'dom.added') {
      changes.push({
        kind: 'node-added',
        summary: `${describeTarget(mutation)} added`,
        target: mutation.target,
        selector: mutation.target?.selector,
      });
    } else if (mutation.type === 'dom.removed') {
      changes.push({
        kind: 'node-removed',
        summary: `${describeTarget(mutation)} removed`,
        target: mutation.target,
        selector: mutation.target?.selector,
      });
    }
  }
  return dedupe(changes);
}

export function buildRecordingTransactions(recording: {
  events: RecordingEvent[];
  transactions?: ActionTransaction[];
}): ActionTransaction[] {
  if (recording.transactions?.length) return recording.transactions;
  return [];
}

function describeTarget(event: RecordingEvent): string {
  const target = event.target;
  if (!target) return 'Target';
  if (target.name) return `${target.tagName || 'element'} "${target.name}"`;
  if (target.selector) return target.selector;
  if (target.path) return target.path;
  return target.tagName || 'element';
}

function isNoiseAttribute(attribute: string): boolean {
  return (
    attribute === 'style' ||
    attribute.startsWith('data-react') ||
    attribute.startsWith('data-v-') ||
    attribute.startsWith('ng-') ||
    attribute.startsWith('data-svelte') ||
    attribute.startsWith('data-emotion')
  );
}

function dedupe(changes: SemanticChange[]): SemanticChange[] {
  const seen = new Set<string>();
  return changes.filter((change) => {
    const key = `${change.kind}:${change.selector || change.summary}:${String(change.before)}:${String(change.after)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

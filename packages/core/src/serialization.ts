import type { Recording } from './model.js';

export function serializeRecording(recording: Recording): string {
  return JSON.stringify(sortValue(recording), null, 2);
}

export function deserializeRecording(serialized: string): Recording {
  return JSON.parse(serialized) as Recording;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortValue(entry)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

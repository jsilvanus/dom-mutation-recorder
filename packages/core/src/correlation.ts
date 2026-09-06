import type { ActionTransaction, Recording, RecordingEvent, RecordingConfig } from './model.js';
import { buildSemanticDiff } from './semantic-diff.js';

export function correlateRecording(
  recording: Recording,
  config: RecordingConfig = {},
): ActionTransaction[] {
  const windowMs = config.correlationWindowMs ?? 750;
  const userEvents = recording.events.filter((event) => event.type.startsWith('user.'));
  const mutations = recording.events.filter((event) => event.type.startsWith('dom.'));
  const transactions: ActionTransaction[] = userEvents.map((action) => ({
    id: action.id,
    action,
    mutations: [],
    semanticChanges: [],
  }));

  for (const mutation of mutations) {
    const actionIndex = findActionIndex(userEvents, mutation.timestamp, windowMs);
    if (actionIndex >= 0) {
      transactions[actionIndex].mutations.push(mutation);
    }
  }

  for (const transaction of transactions) {
    transaction.semanticChanges = buildSemanticDiff(transaction);
  }

  return transactions;
}

function findActionIndex(actions: RecordingEvent[], timestamp: string, windowMs: number): number {
  const time = Date.parse(timestamp);
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < actions.length; index += 1) {
    const actionTime = Date.parse(actions[index].timestamp);
    const distance = time - actionTime;
    if (distance < 0 || distance > windowMs) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

import type { RecordingEvent } from './model.js';

export function findActionIndex(actions: RecordingEvent[], timestamp: string, windowMs: number): number {
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

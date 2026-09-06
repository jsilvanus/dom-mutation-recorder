export const DEFAULT_RECORDING_CONFIG = {
  redactInputValues: true,
  redactPasswords: true,
  correlationWindowMs: 750,
  scopeSelector: null,
};

export function correlateRecording(recording, windowMs = DEFAULT_RECORDING_CONFIG.correlationWindowMs) {
  const userEvents = recording.events.filter((event) => event.type.startsWith('user.'));
  const transactions = userEvents.map((action) => ({
    id: action.id,
    action,
    mutations: [],
    semanticChanges: [],
  }));
  for (const event of recording.events) {
    if (!event.type.startsWith('dom.')) continue;
    const actionIndex = findActionIndex(userEvents, event.timestamp, windowMs);
    if (actionIndex >= 0) {
      transactions[actionIndex].mutations.push(event);
    }
  }
  for (const transaction of transactions) {
    transaction.semanticChanges = transaction.mutations.map((mutation) => ({
      kind:
        mutation.type === 'dom.text'
          ? 'text'
          : mutation.type === 'dom.attributes'
            ? 'attribute'
            : mutation.type === 'dom.added'
              ? 'node-added'
              : 'node-removed',
      summary: describeMutation(mutation),
      target: mutation.target,
      selector: mutation.target?.selector,
      before: mutation.data?.oldText ?? mutation.data?.oldValue ?? undefined,
      after: mutation.data?.newText ?? mutation.data?.newValue ?? undefined,
    }));
  }
  return transactions;
}

export function buildAiDropText(recording) {
  const transactions = recording.transactions || correlateRecording(recording);
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

function findActionIndex(actions, timestamp, windowMs) {
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

function describeMutation(mutation) {
  if (mutation.type === 'dom.text') return `${mutation.target?.selector || 'element'} text changed`;
  if (mutation.type === 'dom.attributes') return `${mutation.target?.selector || 'element'} attribute changed`;
  if (mutation.type === 'dom.added') return `${mutation.target?.selector || 'element'} added`;
  if (mutation.type === 'dom.removed') return `${mutation.target?.selector || 'element'} removed`;
  return mutation.type;
}

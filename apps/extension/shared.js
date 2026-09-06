export const DEFAULT_RECORDING_CONFIG = {
  redactInputValues: true,
  redactPasswords: true,
  correlationWindowMs: 750,
};

export function browserRecorderBootstrap(options) {
  const config = options.config || {};
  const tabId = options.tabId;
  const send = (payload) => {
    chrome.runtime.sendMessage({
      type: 'domrecorder:event',
      tabId,
      payload,
    });
  };

  if (window.__domRecorderInstalled) return;
  window.__domRecorderInstalled = true;

  const clean = (value) => value.replace(/\s+/g, ' ').trim();
  const truncate = (value, max = config.maxTextLength ?? 2000) =>
    value.length > max ? `${value.slice(0, max)}…` : value;
  const cssEscape = (value) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'");
  const attrEscape = (value) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const roleFor = (element) => {
    const explicit = element.getAttribute('role');
    if (explicit) return explicit;
    const tag = element.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a' && element.hasAttribute('href')) return 'link';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const type = (element.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
      return 'textbox';
    }
    if (tag === 'select') return 'combobox';
    return null;
  };
  const nameFor = (element) => {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return clean(ariaLabel);
    const title = element.getAttribute('title');
    if (title) return clean(title);
    const text = clean(element.textContent || '');
    return text || null;
  };
  const pathFor = (element) => {
    const parts = [];
    let current = element;
    while (current) {
      const tag = current.tagName.toLowerCase();
      const siblings = Array.from(current.parentElement?.children || []).filter((candidate) => candidate.tagName === current?.tagName);
      const index = siblings.length > 1 ? siblings.indexOf(current) + 1 : 0;
      parts.unshift(index > 0 ? `${tag}:nth-of-type(${index})` : tag);
      current = current.parentElement;
    }
    return parts.join(' > ');
  };
  const selectorsFor = (element) => {
    const selectors = [];
    if (element.id) selectors.push(`#${cssEscape(element.id)}`);
    const testId = element.getAttribute('data-testid') || element.getAttribute('data-test') || element.getAttribute('data-qa');
    if (testId) selectors.push(`[data-testid="${attrEscape(testId)}"]`);
    const role = roleFor(element);
    const name = nameFor(element);
    if (role && name) selectors.push(`getByRole("${role}", { name: ${JSON.stringify(name)} })`);
    const className = Array.from(element.classList).filter(Boolean).slice(0, 2).join('.');
    if (className) selectors.push(`${element.tagName.toLowerCase()}.${className}`);
    selectors.push(pathFor(element));
    return selectors;
  };
  const describeElement = (element) => {
    const selectors = selectorsFor(element);
    return {
      selector: selectors[0],
      selectors,
      role: roleFor(element),
      name: nameFor(element),
      tagName: element.tagName.toLowerCase(),
      id: element.id || null,
      classes: Array.from(element.classList),
      path: pathFor(element),
      text: truncate(clean(element.textContent || '')),
      attributes: Object.fromEntries(Array.from(element.attributes).map((attribute) => [attribute.name, truncate(attribute.value)])),
    };
  };
  const shouldRedactFieldValue = (tag, type) => {
    if (tag !== 'input' && tag !== 'textarea') return false;
    if (type === 'password') return config.redactPasswords !== false || config.redactInputValues !== false;
    return config.redactInputValues !== false && ['text', 'search', 'email', 'url', 'tel', 'number'].includes(type);
  };
  const snapshotNode = (node, depth = 0) => {
    if (depth > 20) return null;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = truncate(clean(node.textContent || ''));
      return text ? { kind: 'text', text } : null;
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_NODE) return null;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : null;
    const attributes = {};
    if (element) {
      for (const attr of Array.from(element.attributes)) {
        if (attr.name === 'style') continue;
        const tag = element.tagName.toLowerCase();
        const type = element.getAttribute('type')?.toLowerCase() || 'text';
        if (attr.name === 'value' && shouldRedactFieldValue(tag, type)) {
          attributes[attr.name] = '[redacted]';
          continue;
        }
        attributes[attr.name] = truncate(attr.value);
      }
    }
    const children = Array.from(node.childNodes)
      .slice(0, config.maxSubtreeSize ?? 500)
      .map((child) => snapshotNode(child, depth + 1))
      .filter(Boolean);
    const selectors = element ? selectorsFor(element) : [];
    return {
      kind: node.nodeType === Node.DOCUMENT_NODE ? 'document' : 'element',
      tagName: element?.tagName.toLowerCase(),
      text: element ? truncate(clean(element.textContent || '')) || undefined : undefined,
      attributes: element ? attributes : undefined,
      children,
      selector: selectors[0],
      path: element ? pathFor(element) : 'document',
    };
  };
  const serializeHtml = (doc) => {
    const clone = doc.documentElement.cloneNode(true);
    for (const script of Array.from(clone.querySelectorAll('script, noscript'))) {
      script.textContent = '[omitted]';
    }
    for (const field of Array.from(clone.querySelectorAll('input, textarea'))) {
      const tag = field.tagName.toLowerCase();
      const type = (field.getAttribute('type') || 'text').toLowerCase();
      if (shouldRedactFieldValue(tag, type)) field.setAttribute('value', '[redacted]');
    }
    return `<!doctype html>\n${clone.outerHTML}`;
  };
  const snapshot = () => ({
    url: config.redactUrls ? redactUrl(document.URL) : document.URL,
    title: document.title,
    html: serializeHtml(document),
    document: snapshotNode(document) || { kind: 'document', children: [], path: 'html' },
  });
  const redactUrl = (value) => {
    try {
      const parsed = new URL(value);
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return value;
    }
  };

  const lastValues = new WeakMap();
  const documentListeners = [];
  const emitUser = (type, event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const element = describeElement(target);
    const data = {};
    if ('clientX' in event && typeof event.clientX === 'number') {
      data.coordinates = { x: event.clientX, y: event.clientY || 0 };
    }
    if (event instanceof KeyboardEvent) {
      const tag = target.tagName.toLowerCase();
      const typeValue = target.getAttribute('type')?.toLowerCase() || 'text';
      const redacted = shouldRedactFieldValue(tag, typeValue);
      data.key = redacted && event.key.length === 1 ? '[redacted]' : event.key;
      data.code = event.code;
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      if (type === 'user.input' || type === 'user.change') {
        const tag = target.tagName.toLowerCase();
        const typeValue = target.getAttribute('type')?.toLowerCase() || 'text';
        const redacted = shouldRedactFieldValue(tag, typeValue);
        data.before = lastValues.get(target) ?? (redacted ? '[redacted]' : target.value);
        data.after = redacted ? '[redacted]' : target.value;
        lastValues.set(target, data.after);
      }
    }
    send({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type,
      target: element,
      data,
    });
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'childList') {
        const parent = record.target instanceof Element ? describeElement(record.target) : undefined;
        for (const node of Array.from(record.addedNodes)) {
          send({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            type: 'dom.added',
            target: parent,
            data: {
              parent,
              position: Math.max(0, Array.from(record.target.childNodes).indexOf(node)),
              subtree: snapshotNode(node),
            },
          });
        }
        for (const node of Array.from(record.removedNodes)) {
          send({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            type: 'dom.removed',
            target: parent,
            data: {
              parent,
              position: Math.max(0, record.previousSibling ? Array.from(record.target.childNodes).indexOf(record.previousSibling) + 1 : 0),
              subtree: snapshotNode(node),
            },
          });
        }
      } else if (record.type === 'attributes' && record.target instanceof Element) {
        send({
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          type: 'dom.attributes',
          target: describeElement(record.target),
          data: {
            attribute: record.attributeName || '',
            oldValue: record.oldValue,
            newValue: record.target.getAttribute(record.attributeName || '') ?? null,
          },
        });
      } else if (record.type === 'characterData' && record.target instanceof CharacterData) {
        send({
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          type: 'dom.text',
          target: record.target.parentElement ? describeElement(record.target.parentElement) : undefined,
          data: {
            oldText: record.oldValue || '',
            newText: record.target.data,
          },
        });
      }
    }
  });

  observer.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
    attributeOldValue: true,
    characterDataOldValue: true,
  });

  for (const type of ['click', 'dblclick', 'input', 'change', 'keydown', 'keyup', 'focus', 'blur']) {
    const handler = (event) => emitUser(`user.${type}`, event);
    document.addEventListener(type, handler, true);
    documentListeners.push([type, handler]);
  }

  send({ snapshot: snapshot() });
  window.__domRecorderSnapshot = snapshot;
  window.__domRecorderStop = () => {
    observer.disconnect();
    for (const [type, handler] of documentListeners) {
      document.removeEventListener(type, handler, true);
    }
    window.__domRecorderInstalled = false;
  };
}

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

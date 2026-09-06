const state = {
  loadedRecording: null,
  recording: null,
  selected: null,
  session: null,
  targetUrl: '/index.html',
  iframeReady: false,
};

const recordingOptions = {
  redactInputValues: true,
  redactPasswords: true,
};

let lastValues = new WeakMap();

const els = {
  targetUrl: document.querySelector('#target-url'),
  loadTarget: document.querySelector('#load-target'),
  startRecording: document.querySelector('#start-recording'),
  stopRecording: document.querySelector('#stop-recording'),
  exportRecording: document.querySelector('#export-recording'),
  exportEvidence: document.querySelector('#export-evidence'),
  status: document.querySelector('#status'),
  file: document.querySelector('#file'),
  copySelector: document.querySelector('#copy-selector'),
  copyAiDrop: document.querySelector('#copy-ai-drop'),
  copyEvidence: document.querySelector('#copy-evidence'),
  events: document.querySelector('#events'),
  preview: document.querySelector('#preview'),
  selected: document.querySelector('#selected'),
  selectedMeta: document.querySelector('#selected-meta'),
  meta: document.querySelector('#meta'),
};

els.targetUrl.value = state.targetUrl;
void loadPreviewTarget(state.targetUrl);

els.targetUrl.addEventListener('change', () => {
  state.targetUrl = els.targetUrl.value.trim() || '/index.html';
});

els.loadTarget.addEventListener('click', () => {
  state.targetUrl = els.targetUrl.value.trim() || '/index.html';
  void loadPreviewTarget(state.targetUrl);
  state.iframeReady = false;
  setStatus('Loading target…', 'idle');
});

els.preview.addEventListener('load', () => {
  state.iframeReady = true;
  const sameOrigin = canAccessPreview();
  if (state.session) {
    if (sameOrigin) {
      handlePreviewNavigation();
      setStatus('Recording target navigation…', 'recording');
    } else {
      stopRecording(false);
      setStatus('Cross-origin navigation ended recording', 'error');
    }
  } else {
    setStatus(sameOrigin ? 'Target ready' : 'Target loaded (cross-origin, live recording disabled)', 'idle');
  }
  updateButtons();
});

els.startRecording.addEventListener('click', async () => {
  if (!canAccessPreview()) {
    setStatus('Load a same-origin page to start recording', 'error');
    return;
  }
  startRecording();
});

els.stopRecording.addEventListener('click', () => stopRecording(false));
els.exportRecording.addEventListener('click', () => exportCurrentRecording('recording.json', exportRecordingJson));
els.exportEvidence.addEventListener('click', () => exportCurrentRecording('evidence.json', exportEvidenceJson));
els.copySelector.addEventListener('click', async () => {
  const selector = state.selected?.target?.selector;
  if (selector) await navigator.clipboard.writeText(selector);
});
els.copyAiDrop.addEventListener('click', async () => {
  const recording = currentRecording();
  if (recording) await navigator.clipboard.writeText(buildAiDropText(recording));
});
els.copyEvidence.addEventListener('click', async () => {
  const recording = currentRecording();
  if (recording) await navigator.clipboard.writeText(JSON.stringify(recording, null, 2));
});

els.file.addEventListener('change', async () => {
  const file = els.file.files?.[0];
  if (!file) return;
  try {
    const content = await file.text();
    const parsed = JSON.parse(content);
    if (!isRecordingLike(parsed)) {
      throw new Error('Invalid recording file');
    }
    state.loadedRecording = parsed;
    state.recording = null;
    state.session = null;
    renderLoadedRecording();
    setStatus('Loaded recording file', 'idle');
    updateButtons();
  } catch {
    setStatus('Invalid recording file', 'error');
  }
});

function canAccessPreview() {
  try {
    void els.preview.contentWindow.location.href;
    return Boolean(els.preview.contentWindow?.document);
  } catch {
    return false;
  }
}

async function loadPreviewTarget(value) {
  const target = normalizeTargetUrl(value);
  state.targetUrl = target;
  els.targetUrl.value = target;
  els.preview.src = new URL(target, location.origin).href;
}

function normalizeTargetUrl(value) {
  const fallback = '/index.html';
  const trimmed = value.trim() || fallback;
  try {
    const parsed = new URL(trimmed, location.href);
    if (parsed.origin !== location.origin) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

function startRecording() {
  lastValues = new WeakMap();
  const win = els.preview.contentWindow;
  const doc = win.document;
  state.session = {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    events: [],
    initialSnapshot: captureSnapshot(doc),
    finalSnapshot: null,
    observers: [],
    listeners: [],
    window: win,
    document: doc,
  };
  state.selected = null;
  renderEvents([]);
  setStatus('Recording…', 'recording');
  attachRecordingSession(state.session);
  updateButtons();
  renderSummary(currentRecording());
}

function stopRecording(fromNavigation) {
  if (!state.session) return;
  const recording = finalizeSession(state.session);
  state.recording = recording;
  state.loadedRecording = null;
  state.session = null;
  if (!fromNavigation) setStatus('Recording stopped', 'idle');
  renderEvents(recording.events);
  renderSummary(recording);
  updateButtons();
}

function attachRecordingSession(session) {
  const { document: doc, window: win } = session;
  const userEventTypes = ['click', 'dblclick', 'input', 'change', 'keydown', 'keyup', 'focus', 'blur'];
  const handleUserEvent = (type) => (event) => {
    const target = event.target instanceof win.Element ? event.target : null;
    if (!target) return;
    session.events.push(buildUserEvent(type, event, target, doc, win));
    renderEvents(currentEvents());
  };

  for (const type of userEventTypes) {
    const handler = handleUserEvent(`user.${type}`);
    doc.addEventListener(type, handler, true);
    session.listeners.push(() => doc.removeEventListener(type, handler, true));
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      session.events.push(...buildMutationEvents(record, doc, win));
    }
    renderEvents(currentEvents());
  });
  observer.observe(doc, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
    attributeOldValue: true,
    characterDataOldValue: true,
  });
  session.observers.push(observer);
}

function handlePreviewNavigation() {
  if (!state.session) return;
  const session = state.session;
  const previousUrl = session.document.URL;
  cleanupSession(session);
  session.window = els.preview.contentWindow;
  session.document = session.window.document;
  lastValues = new WeakMap();
  session.events.push({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    type: 'navigation',
    target: {
      selector: 'document',
      role: null,
      name: session.document.title || null,
      tagName: '#document',
      id: null,
      classes: [],
      path: 'document',
      text: session.document.title || null,
      attributes: {},
    },
    data: {
      from: previousUrl,
      to: session.document.URL,
      title: session.document.title,
    },
  });
  attachRecordingSession(session);
  renderEvents(currentEvents());
  renderSummary(null);
}

function finalizeSession(session) {
  cleanupSession(session);
  const finalSnapshot = captureSnapshot(session.document);
  const recording = {
    id: session.id,
    version: '1.0.0',
    startedAt: session.startedAt,
    endedAt: new Date().toISOString(),
    url: finalSnapshot.url,
    title: finalSnapshot.title,
    viewport: {
      width: session.window.innerWidth,
      height: session.window.innerHeight,
    },
    userAgent: navigator.userAgent,
    initialSnapshot: session.initialSnapshot,
    finalSnapshot,
    events: session.events,
  };
  recording.transactions = correlateRecording(recording);
  return recording;
}

function cleanupSession(session) {
  for (const disconnect of session.observers) disconnect.disconnect();
  for (const remove of session.listeners) remove();
  session.observers = [];
  session.listeners = [];
}

function currentRecording() {
  return state.recording || state.loadedRecording || null;
}

function currentEvents() {
  return state.session ? state.session.events : currentRecording()?.events || [];
}

function buildUserEvent(type, event, target, doc, win) {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    target: describeElement(target, doc),
    data: buildUserEventData(event, target, win),
  };
}

function buildUserEventData(event, target, win) {
  const data = {};
  if ('clientX' in event && typeof event.clientX === 'number') {
    data.coordinates = { x: event.clientX, y: event.clientY || 0 };
  }
  if (win && event instanceof win.KeyboardEvent) {
    data.key = isRedactedField(target) && event.key.length === 1 ? '[redacted]' : event.key;
    data.code = event.code;
  }
  if (win && (target instanceof win.HTMLInputElement || target instanceof win.HTMLTextAreaElement)) {
    if (event.type === 'input' || event.type === 'change') {
      data.before = lastValues.get(target) ?? (isRedactedField(target) ? '[redacted]' : target.value);
      data.after = isRedactedField(target) ? '[redacted]' : target.value;
      lastValues.set(target, data.after);
    }
  }
  return data;
}

function buildMutationEvents(record, doc, win) {
  const timestamp = new Date().toISOString();
  const parent = win && record.target instanceof win.Element ? describeElement(record.target, doc) : undefined;
  const events = [];
  if (record.type === 'childList') {
    for (const node of Array.from(record.addedNodes)) {
      events.push({
        id: crypto.randomUUID(),
        timestamp,
        type: 'dom.added',
        target: parent,
        data: {
          parent,
          position: Math.max(0, Array.from(record.target.childNodes).indexOf(node)),
          subtree: snapshotNode(node, doc),
        },
      });
    }
    for (const node of Array.from(record.removedNodes)) {
      events.push({
        id: crypto.randomUUID(),
        timestamp,
        type: 'dom.removed',
        target: parent,
        data: {
          parent,
          position: Math.max(0, record.previousSibling ? Array.from(record.target.childNodes).indexOf(record.previousSibling) + 1 : 0),
          subtree: snapshotNode(node, doc),
        },
      });
    }
  } else if (win && record.type === 'attributes' && record.target instanceof win.Element) {
    events.push({
      id: crypto.randomUUID(),
      timestamp,
      type: 'dom.attributes',
      target: describeElement(record.target, doc),
      data: {
        attribute: record.attributeName || '',
        oldValue: record.oldValue,
        newValue: record.target.getAttribute(record.attributeName || '') ?? null,
      },
    });
  } else if (win && record.type === 'characterData' && record.target instanceof win.CharacterData) {
    events.push({
      id: crypto.randomUUID(),
      timestamp,
      type: 'dom.text',
      target: record.target.parentElement ? describeElement(record.target.parentElement, doc) : undefined,
      data: {
        oldText: record.oldValue || '',
        newText: record.target.data,
      },
    });
  }
  return events;
}

function captureSnapshot(doc) {
  return {
    url: redactUrl(doc.URL),
    title: doc.title,
    html: serializeHtml(doc),
    document: snapshotNode(doc, doc),
  };
}

function snapshotNode(node, doc, depth = 0) {
  if (depth > 20) return null;
  if (node.nodeType === Node.TEXT_NODE) {
    const text = clean(node.textContent || '');
    return text ? { kind: 'text', text } : null;
  }
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_NODE) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? node : null;
  const attributes = {};
  if (element) {
    for (const attr of Array.from(element.attributes)) {
      if (attr.name === 'style') continue;
      if (attr.name === 'value' && isRedactedField(element)) {
        attributes[attr.name] = '[redacted]';
        continue;
      }
      attributes[attr.name] = truncate(attr.value);
    }
  }
  const children = Array.from(node.childNodes).slice(0, 500).map((child) => snapshotNode(child, doc, depth + 1)).filter(Boolean);
  const selectors = element ? selectorsFor(element, doc) : [];
  return {
    kind: node.nodeType === Node.DOCUMENT_NODE ? 'document' : 'element',
    tagName: element?.tagName.toLowerCase(),
    text: element ? truncate(clean(element.textContent || '')) || undefined : undefined,
    attributes: element ? attributes : undefined,
    children,
    selector: selectors[0],
    path: element ? buildPath(element) : 'document',
  };
}

function serializeHtml(doc) {
  const clone = doc.documentElement.cloneNode(true);
  for (const script of Array.from(clone.querySelectorAll('script, noscript'))) {
    script.textContent = '[omitted]';
  }
  for (const field of Array.from(clone.querySelectorAll('input, textarea'))) {
    const type = (field.getAttribute('type') || 'text').toLowerCase();
    if (shouldRedactValue(type)) field.setAttribute('value', '[redacted]');
  }
  return `<!doctype html>\n${clone.outerHTML}`;
}

function describeElement(element, doc) {
  const selectors = selectorsFor(element, doc);
  return {
    selector: selectors[0],
    selectors,
    role: roleFor(element),
    name: nameFor(element),
    tagName: element.tagName.toLowerCase(),
    id: element.id || null,
    classes: Array.from(element.classList),
    path: buildPath(element),
    text: truncate(clean(element.textContent || '')),
    attributes: Object.fromEntries(Array.from(element.attributes).map((attribute) => [attribute.name, truncate(attribute.value)])),
  };
}

function selectorsFor(element, doc) {
  const candidates = [];
  if (element.id) candidates.push(`#${cssEscape(element.id)}`);
  const testId = element.getAttribute('data-testid') || element.getAttribute('data-test') || element.getAttribute('data-qa');
  if (testId) candidates.push(`[data-testid="${attrEscape(testId)}"]`);
  const role = roleFor(element);
  const name = nameFor(element);
  if (role && name) candidates.push(`getByRole("${role}", { name: ${JSON.stringify(name)} })`);
  const className = Array.from(element.classList).filter(Boolean).slice(0, 2).join('.');
  if (className) candidates.push(`${element.tagName.toLowerCase()}.${className}`);
  candidates.push(buildPath(element));
  return candidates;
}

function roleFor(element) {
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
}

function nameFor(element) {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return clean(ariaLabel);
  const title = element.getAttribute('title');
  if (title) return clean(title);
  const text = clean(element.textContent || '');
  return text || null;
}

function buildPath(element) {
  const parts = [];
  let current = element;
  while (current) {
    const tag = current.tagName.toLowerCase();
    const siblings = Array.from(current.parentElement?.children || []).filter((candidate) => candidate.tagName === current.tagName);
    const index = siblings.length > 1 ? siblings.indexOf(current) + 1 : 0;
    parts.unshift(index > 0 ? `${tag}:nth-of-type(${index})` : tag);
    current = current.parentElement;
  }
  return parts.join(' > ');
}

function isRedactedField(element) {
  return (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') && shouldRedactValue((element.getAttribute('type') || 'text').toLowerCase());
}

function shouldRedactValue(type) {
  if (type === 'password') return recordingOptions.redactPasswords !== false;
  return recordingOptions.redactInputValues !== false && ['text', 'search', 'email', 'url', 'tel', 'number'].includes(type);
}

function truncate(value, max = 2000) {
  const normalized = clean(value);
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function clean(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function cssEscape(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'");
}

function attrEscape(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function redactUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return value;
  }
}

function correlateRecording(recording) {
  const transactions = [];
  const windowMs = 750;
  const userEvents = recording.events.filter((event) => event.type.startsWith('user.'));
  for (const action of userEvents) {
    transactions.push({ id: action.id, action, mutations: [], semanticChanges: [] });
  }
  for (const event of recording.events) {
    if (!event.type.startsWith('dom.')) continue;
    const actionIndex = findActionIndex(userEvents, event.timestamp, windowMs);
    if (actionIndex < 0) continue;
    transactions[actionIndex].mutations.push(event);
  }
  for (const transaction of transactions) {
    transaction.semanticChanges = transaction.mutations.map((mutation) => ({
      kind: mutation.type === 'dom.text' ? 'text' : mutation.type === 'dom.attributes' ? 'attribute' : mutation.type === 'dom.added' ? 'node-added' : 'node-removed',
      summary: describeMutation(mutation),
      target: mutation.target,
      selector: mutation.target?.selector,
      before: mutation.data?.oldText ?? mutation.data?.oldValue ?? undefined,
      after: mutation.data?.newText ?? mutation.data?.newValue ?? undefined,
    }));
  }
  return transactions;
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


function exportRecordingJson(recording) {
  return JSON.stringify(recording, null, 2);
}

function exportEvidenceJson(recording) {
  return JSON.stringify({ recording: recording.id, transactions: recording.transactions, events: recording.events }, null, 2);
}

function exportCurrentRecording(filename, serializer) {
  const recording = currentRecording();
  if (!recording) return;
  download(filename, serializer(recording));
}

function download(filename, content) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderEvents(events) {
  els.events.innerHTML = '';
  for (const event of events) {
    const item = document.createElement('li');
    item.textContent = `${event.type} ${event.target?.selector || ''}`.trim();
    item.addEventListener('click', () => selectEvent(event, item));
    els.events.append(item);
  }
}

function selectEvent(event, item) {
  state.selected = event;
  [...els.events.children].forEach((child) => child.classList.toggle('selected', child === item));
  els.selected.textContent = JSON.stringify(event, null, 2);
  els.selectedMeta.innerHTML = '';
  for (const [label, value] of [
    ['Type', event.type],
    ['Target', event.target?.selector || '—'],
    ['Name', event.target?.name || '—'],
    ['Role', event.target?.role || '—'],
  ]) {
    const row = document.createElement('div');
    row.innerHTML = `<strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span>`;
    els.selectedMeta.append(row);
  }
  updateButtons();
}

function renderSummary(recording) {
  els.meta.innerHTML = '';
  if (!recording) {
    if (state.session) {
      addMeta('Recording', 'LIVE');
      addMeta('URL', state.session.document.URL);
      addMeta('Title', state.session.document.title || '—');
      addMeta('Events', String(state.session.events.length));
      addMeta('Navigation events', String(state.session.events.filter((event) => event.type === 'navigation').length));
    } else {
      addMeta('Recording', 'No recording loaded');
      addMeta('URL', '—');
    }
    return;
  }
  addMeta('Recording', recording.id);
  addMeta('URL', recording.url);
  addMeta('Title', recording.title);
  addMeta('Events', String(recording.events.length));
  addMeta('Transactions', String(recording.transactions?.length || 0));
  addMeta('Initial state', recording.initialSnapshot?.title || '—');
  addMeta('Final state', recording.finalSnapshot?.title || '—');
}

function renderLoadedRecording() {
  renderEvents(state.loadedRecording?.events || []);
  renderSummary(state.loadedRecording);
  state.selected = null;
  els.selected.textContent = '';
  els.selectedMeta.textContent = '';
  updateButtons();
}

function addMeta(label, value) {
  const strong = document.createElement('strong');
  strong.textContent = label;
  const span = document.createElement('span');
  span.textContent = value;
  els.meta.append(strong, span);
}

function setStatus(text, kind) {
  els.status.textContent = text;
  els.status.className = `status ${kind}`;
}

function updateButtons() {
  const recording = Boolean(state.session);
  const hasRecording = Boolean(currentRecording());
  els.startRecording.disabled = recording || !canAccessPreview();
  els.stopRecording.disabled = !recording;
  els.exportRecording.disabled = !hasRecording;
  els.exportEvidence.disabled = !hasRecording;
  els.copySelector.disabled = !state.selected?.target?.selector;
  els.copyAiDrop.disabled = !hasRecording;
  els.copyEvidence.disabled = !hasRecording;
}

function buildAiDropText(recording) {
  const lines = [];
  lines.push('PAGE');
  lines.push(`URL: ${recording.url}`);
  lines.push(`Title: ${recording.title}`);
  lines.push('');
  lines.push('INITIAL STATE');
  lines.push(recording.initialSnapshot?.html || '—');
  lines.push('');
  lines.push('ACTIONS');
  for (const [index, transaction] of (recording.transactions || []).entries()) {
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function isRecordingLike(value) {
  return Boolean(value && typeof value === 'object' && Array.isArray(value.events));
}

renderSummary(null);

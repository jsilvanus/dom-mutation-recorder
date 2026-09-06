// apps/devtools attaches directly to a same-origin <iframe>'s DOM from its own module scope
// (no chrome.scripting.executeScript / page.addInitScript involved), so — unlike
// browser-bootstrap.ts's two injection paths — it can just import packages/core's real
// selector/snapshot/mutation/redaction functions as normal ES modules. They're written to be
// realm-safe (nodeType checks rather than `instanceof`), which is exactly what's needed here
// since the iframe's DOM nodes belong to a different realm than this script's own globals.
import {
  buildAiDropText,
  captureRecordingSnapshot,
  correlateRecording as correlateRecordingCore,
  describeElement as describeElementCore,
  describeMutationRecord,
  shouldRedactElementValue,
} from '../dist/packages/core/src/index.js';

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
    initialSnapshot: captureRecordingSnapshot(doc, recordingOptions),
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
    session.events.push(buildUserEvent(type, event, target, win));
    renderEvents(currentEvents());
  };

  for (const type of userEventTypes) {
    const handler = handleUserEvent(`user.${type}`);
    doc.addEventListener(type, handler, true);
    session.listeners.push(() => doc.removeEventListener(type, handler, true));
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      session.events.push(...describeMutationRecord(record, recordingOptions));
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
  const finalSnapshot = captureRecordingSnapshot(session.document, recordingOptions);
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
  recording.transactions = correlateRecordingCore(recording, recordingOptions);
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

function buildUserEvent(type, event, target, win) {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    target: describeElementCore(target, recordingOptions),
    data: buildUserEventData(event, target, win),
  };
}

function buildUserEventData(event, target, win) {
  const data = {};
  if ('clientX' in event && typeof event.clientX === 'number') {
    data.coordinates = { x: event.clientX, y: event.clientY || 0 };
  }
  if (win && event instanceof win.KeyboardEvent) {
    data.key = shouldRedactElementValue(target, recordingOptions) && event.key.length === 1 ? '[redacted]' : event.key;
    data.code = event.code;
  }
  if (win && (target instanceof win.HTMLInputElement || target instanceof win.HTMLTextAreaElement)) {
    // Update lastValues on every event that touches this field (not just input/change) so
    // the very first keystroke has a real "before" value captured from an earlier
    // focus/keydown, instead of falling back to the just-changed current value.
    const current = shouldRedactElementValue(target, recordingOptions) ? '[redacted]' : target.value;
    const before = lastValues.get(target) ?? current;
    if (event.type === 'input' || event.type === 'change') {
      data.before = before;
      data.after = current;
    }
    lastValues.set(target, current);
  }
  return data;
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

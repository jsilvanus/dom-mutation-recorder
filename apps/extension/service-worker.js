import { DEFAULT_RECORDING_CONFIG, browserRecorderBootstrap, correlateRecording } from './shared.js';

const STORAGE_KEY = 'domRecorderExtensionState';

const state = {
  activeTabId: null,
  recording: null,
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  void syncState();
});

chrome.runtime.onStartup?.addListener(() => {
  void syncState();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && state.activeTabId === tabId && state.recording) {
    void injectRecorder(tabId, { scopeSelector: state.recording.scopeSelector });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error(error);
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
  return true;
});

async function handleMessage(message, sender) {
  if (message?.type !== 'domrecorder:event') {
    await syncState();
  }
  if (message?.type === 'domrecorder:get-state') {
    return buildSnapshotState();
  }
  if (message?.type === 'domrecorder:start') {
    const tabId = message.tabId ?? (await getActiveTabId());
    await startRecording(tabId, message.config || {});
    return buildSnapshotState();
  }
  if (message?.type === 'domrecorder:stop') {
    await stopRecording();
    return buildSnapshotState();
  }
  if (message?.type === 'domrecorder:pick') {
    const tabId = message.tabId ?? (await getActiveTabId());
    await startPicking(tabId);
    return { ok: true };
  }
  if (message?.type === 'domrecorder:pick-cancel') {
    await stopPicking(message.tabId ?? sender.tab?.id ?? null);
    return { ok: true };
  }
  if (message?.type === 'domrecorder:pick-result') {
    return { ok: true };
  }
  if (message?.type === 'domrecorder:event' && sender.tab?.id === state.activeTabId && state.recording) {
    appendEvent(message.payload);
    await persist();
    return { ok: true };
  }
  return { ok: false };
}

async function startRecording(tabId, config = {}) {
  if (tabId == null) throw new Error('No active tab');
  await clearActiveRecording();
  state.activeTabId = tabId;
  state.recording = {
    id: crypto.randomUUID(),
    version: '1.0.0',
    startedAt: new Date().toISOString(),
    endedAt: null,
    url: '',
    title: '',
    viewport: null,
    userAgent: '',
    initialSnapshot: null,
    finalSnapshot: null,
    scopeSelector: config.scopeSelector || null,
    events: [],
  };
  await persist();
  await injectRecorder(tabId, config);
}

async function stopRecording() {
  if (!state.recording || state.activeTabId == null) {
    return;
  }
  const tabId = state.activeTabId;
  const snapshot = await getSnapshotFromTab(tabId);
  if (snapshot) {
    state.recording.finalSnapshot = snapshot;
    if (!state.recording.initialSnapshot) state.recording.initialSnapshot = snapshot;
    state.recording.url = snapshot.url || state.recording.url;
    state.recording.title = snapshot.title || state.recording.title;
  }
  state.recording.endedAt = new Date().toISOString();
  state.recording.transactions = correlateRecording(state.recording, DEFAULT_RECORDING_CONFIG.correlationWindowMs);
  await stopRecorderInTab(tabId);
  state.activeTabId = null;
  await persist();
}

function appendEvent(payload) {
  if (!state.recording) return;
  if (payload && typeof payload === 'object' && 'snapshot' in payload && payload.snapshot) {
    if (!state.recording.initialSnapshot) state.recording.initialSnapshot = payload.snapshot;
    state.recording.finalSnapshot = payload.snapshot;
    state.recording.url = payload.snapshot.url || state.recording.url;
    state.recording.title = payload.snapshot.title || state.recording.title;
    return;
  }
  if (payload && typeof payload === 'object' && typeof payload.type === 'string') {
    state.recording.events.push(payload);
  }
}

async function injectRecorder(tabId, config = {}) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: browserRecorderBootstrap,
    args: [{ tabId, config: { ...DEFAULT_RECORDING_CONFIG, ...config } }],
  });
}

async function startPicking(tabId) {
  if (tabId == null) throw new Error('No active tab');
  await chrome.scripting.executeScript({
    target: { tabId },
    func: installSelectionPicker,
    args: [tabId],
  });
}

async function stopPicking(tabId) {
  if (tabId == null) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        window.__domRecorderPickerStop?.();
      },
    });
  } catch {
    // ignored
  }
}

async function stopRecorderInTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        window.__domRecorderStop?.();
      },
    });
  } catch {
    // ignored
  }
}

async function getSnapshotFromTab(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.__domRecorderSnapshot?.() || null,
    });
    return result || null;
  } catch {
    return null;
  }
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function clearActiveRecording() {
  if (state.activeTabId != null) {
    await stopRecorderInTab(state.activeTabId);
  }
  state.activeTabId = null;
  state.recording = null;
  await persist();
}

async function syncState() {
  const stored = await chrome.storage.session.get(STORAGE_KEY);
  if (stored?.[STORAGE_KEY]) {
    state.activeTabId = stored[STORAGE_KEY].activeTabId ?? null;
    state.recording = stored[STORAGE_KEY].recording ?? null;
  }
}

async function persist() {
  await chrome.storage.session.set({
    [STORAGE_KEY]: {
      activeTabId: state.activeTabId,
      recording: state.recording,
    },
  });
}

function buildSnapshotState() {
  return {
    activeTabId: state.activeTabId,
    recording: state.recording,
    live: Boolean(state.recording && state.activeTabId != null),
  };
}

function installSelectionPicker(tabId) {
  if (window.__domRecorderPickerInstalled) return;
  window.__domRecorderPickerInstalled = true;

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
    if (ariaLabel) return ariaLabel.trim();
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const name = labelledBy
        .split(/\s+/)
        .map((id) => element.ownerDocument.getElementById(id)?.textContent?.trim() || '')
        .filter(Boolean)
        .join(' ')
        .trim();
      if (name) return name;
    }
    const title = element.getAttribute('title');
    if (title) return title.trim();
    const text = element.textContent?.replace(/\s+/g, ' ').trim();
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
  const scopeSelectorFor = (element) => selectorsFor(element).find((candidate) => !candidate.startsWith('getByRole(')) || selectorsFor(element)[0] || null;
  let hoverCleanup = null;

  const clearHover = () => {
    if (typeof hoverCleanup === 'function') hoverCleanup();
    hoverCleanup = null;
  };
  const stop = () => {
    clearHover();
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    window.__domRecorderPickerInstalled = false;
    window.__domRecorderPickerStop = undefined;
  };
  const onMove = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    clearHover();
    target.style.outline = '2px solid #2563eb';
    target.style.outlineOffset = '2px';
    hoverCleanup = () => {
      target.style.outline = '';
      target.style.outlineOffset = '';
    };
  };
  const onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const selector = scopeSelectorFor(target);
    const description = {
      selector,
      selectors: selectorsFor(target),
      role: roleFor(target),
      name: nameFor(target),
      tagName: target.tagName.toLowerCase(),
      id: target.id || null,
      classes: Array.from(target.classList),
      path: pathFor(target),
      text: target.textContent?.replace(/\s+/g, ' ').trim() || null,
      attributes: Object.fromEntries(Array.from(target.attributes).map((attribute) => [attribute.name, attribute.value])),
    };
    chrome.runtime.sendMessage({
      type: 'domrecorder:pick-result',
      tabId,
      selector,
      target: description,
    });
    stop();
  };

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  window.__domRecorderPickerStop = stop;
}

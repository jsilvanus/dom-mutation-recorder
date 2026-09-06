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
    void injectRecorder(tabId);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse);
  return true;
});

async function handleMessage(message, sender) {
  await syncState();
  if (message?.type === 'domrecorder:get-state') {
    return buildSnapshotState();
  }
  if (message?.type === 'domrecorder:start') {
    const tabId = message.tabId ?? (await getActiveTabId());
    await startRecording(tabId);
    return buildSnapshotState();
  }
  if (message?.type === 'domrecorder:stop') {
    await stopRecording();
    return buildSnapshotState();
  }
  if (message?.type === 'domrecorder:event' && sender.tab?.id === state.activeTabId && state.recording) {
    appendEvent(message.payload);
    await persist();
    return { ok: true };
  }
  return { ok: false };
}

async function startRecording(tabId) {
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
    events: [],
  };
  await persist();
  await injectRecorder(tabId);
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
  await persist();
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

async function injectRecorder(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: browserRecorderBootstrap,
    args: [{ tabId, config: DEFAULT_RECORDING_CONFIG }],
  });
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

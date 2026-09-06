import { buildAiDropText } from './shared.js';

const els = {
  status: document.querySelector('#status'),
  refresh: document.querySelector('#refresh'),
  start: document.querySelector('#start'),
  pick: document.querySelector('#pick'),
  page: document.querySelector('#page'),
  stop: document.querySelector('#stop'),
  clear: document.querySelector('#clear'),
  copyAi: document.querySelector('#copy-ai'),
  copyJson: document.querySelector('#copy-json'),
  tabInfo: document.querySelector('#tab-info'),
  scopeInfo: document.querySelector('#scope-info'),
  preview: document.querySelector('#preview'),
  hideNoisy: document.querySelector('#hide-noisy'),
};

let currentState = null;
let activeTab = null;
let selectedScopeSelector = null;
let selectedScopeLabel = null;
let picking = false;
// Set when a message round-trip to the background fails (e.g. the extension was reloaded
// while this panel/tab was still connected to the old instance). Kept separate from
// currentState so a single flaky message can't make the panel look like the recording
// vanished — the data is untouched in the background, only this message failed.
let connectionError = null;

function aiDropConfig() {
  return { skipNoisyActionsInAiDrop: els.hideNoisy.checked };
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'domrecorder:pick-result') return;
  if (message.tabId !== activeTab?.id) return;
  selectedScopeSelector = message.selector || null;
  selectedScopeLabel = message.target?.selector || message.target?.name || message.target?.tagName || 'element';
  picking = false;
  render();
});

els.refresh.addEventListener('click', () => void refresh());
els.start.addEventListener('click', () => void startRecording());
els.pick.addEventListener('click', () => void startPicking());
els.page.addEventListener('click', () => {
  selectedScopeSelector = null;
  selectedScopeLabel = null;
  picking = false;
  void cancelPicking();
  render();
});
els.stop.addEventListener('click', () => void stopRecording());
els.clear.addEventListener('click', () => void clearRecording());
els.copyAi.addEventListener('click', async () => {
  const recording = currentState?.recording;
  if (recording) await navigator.clipboard.writeText(buildAiDropText(recording, aiDropConfig()));
});
els.copyJson.addEventListener('click', async () => {
  const recording = currentState?.recording;
  if (recording) await navigator.clipboard.writeText(JSON.stringify(recording, null, 2));
});
els.hideNoisy.addEventListener('change', () => render());

chrome.tabs.onActivated?.addListener(() => void refresh());
chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
  if (activeTab?.id === tabId && changeInfo.status === 'complete') {
    void refresh();
  }
});

await refresh();

async function refresh() {
  activeTab = await getActiveTab();
  await applyState(() => sendMessage({ type: 'domrecorder:get-state' }));
  if (currentState?.recording) {
    selectedScopeSelector = currentState.recording.scopeSelector || null;
    selectedScopeLabel = selectedScopeSelector;
  }
  render();
}

async function startRecording() {
  activeTab = await getActiveTab();
  if (!activeTab?.id) return;
  await applyState(() =>
    sendMessage({
      type: 'domrecorder:start',
      tabId: activeTab.id,
      config: { scopeSelector: selectedScopeSelector || null },
    }),
  );
  picking = false;
  render();
}

async function stopRecording() {
  await applyState(() => sendMessage({ type: 'domrecorder:stop' }));
  picking = false;
  render();
}

async function clearRecording() {
  const ok = await applyState(() => sendMessage({ type: 'domrecorder:clear' }));
  if (ok) {
    selectedScopeSelector = null;
    selectedScopeLabel = null;
  }
  picking = false;
  render();
}

// Runs a background message and updates currentState only on success. On failure the
// previous currentState (and whatever it implies about a live/stopped recording) is left
// alone — the background's own data is untouched by a failed message, so the panel
// shouldn't act as if the recording disappeared. Returns whether it succeeded.
async function applyState(send) {
  try {
    currentState = await send();
    connectionError = null;
    return true;
  } catch (error) {
    connectionError = error instanceof Error ? error.message : String(error);
    return false;
  }
}

async function startPicking() {
  activeTab = await getActiveTab();
  if (!activeTab?.id) return;
  picking = true;
  render();
  try {
    await sendMessage({ type: 'domrecorder:pick', tabId: activeTab.id });
  } catch (error) {
    connectionError = error instanceof Error ? error.message : String(error);
    picking = false;
    render();
  }
}

async function cancelPicking() {
  if (!activeTab?.id) return;
  try {
    await sendMessage({ type: 'domrecorder:pick-cancel', tabId: activeTab.id });
  } catch {
    // Best-effort: if the message fails the picker will already be gone with the old page.
  }
}

function render() {
  const recording = currentState?.recording;
  const live = Boolean(currentState?.live);
  els.status.textContent = picking ? 'Picking element' : live ? 'Recording' : recording ? 'Stopped' : 'Idle';
  els.status.className = `status ${picking ? 'picking' : live ? 'live' : recording ? 'stopped' : 'idle'}`;
  els.start.disabled = live || picking || !activeTab?.id;
  els.pick.disabled = live || picking || !activeTab?.id;
  els.page.disabled = live || !activeTab?.id;
  els.stop.disabled = !live;
  els.clear.disabled = !recording;
  els.copyAi.disabled = !recording;
  els.copyJson.disabled = !recording;

  if (activeTab) {
    els.tabInfo.textContent = `Active tab: ${activeTab.title || activeTab.url || 'Unknown'} (${activeTab.url || 'no url'})`;
  } else {
    els.tabInfo.textContent = 'No active tab.';
  }
  if (connectionError) {
    els.tabInfo.textContent =
      `Warning: lost connection to the extension (${connectionError}). ` +
      `Your recording is unaffected — reload this page and try again.\n${els.tabInfo.textContent}`;
  }

  if (recording) {
    const transactions = recording.transactions?.length || 0;
    els.preview.textContent = buildAiDropText(recording, aiDropConfig());
    const parts = [
      `URL: ${recording.url || '—'}`,
      `Title: ${recording.title || '—'}`,
      `Events: ${recording.events?.length || 0}`,
      `Transactions: ${transactions}`,
      `Started: ${recording.startedAt}`,
      `Ended: ${recording.endedAt || 'LIVE'}`,
    ];
    els.tabInfo.textContent = `${els.tabInfo.textContent}\n${parts.join('\n')}`;
  } else {
    els.preview.textContent = 'Start a recording to generate clipboard output.';
  }

  const scope = selectedScopeSelector || recording?.scopeSelector || 'entire page';
  const label = selectedScopeLabel && selectedScopeLabel !== scope ? `\nSelected: ${selectedScopeLabel}` : '';
  els.scopeInfo.textContent = `Scope: ${scope}${label}`;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response || null);
    });
  });
}

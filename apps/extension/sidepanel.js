import { buildAiDropText } from './shared.js';

const els = {
  status: document.querySelector('#status'),
  refresh: document.querySelector('#refresh'),
  start: document.querySelector('#start'),
  pick: document.querySelector('#pick'),
  page: document.querySelector('#page'),
  stop: document.querySelector('#stop'),
  copyAi: document.querySelector('#copy-ai'),
  copyJson: document.querySelector('#copy-json'),
  tabInfo: document.querySelector('#tab-info'),
  scopeInfo: document.querySelector('#scope-info'),
  preview: document.querySelector('#preview'),
};

let currentState = null;
let activeTab = null;
let selectedScopeSelector = null;
let selectedScopeLabel = null;
let picking = false;

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
els.copyAi.addEventListener('click', async () => {
  const recording = currentState?.recording;
  if (recording) await navigator.clipboard.writeText(buildAiDropText(recording));
});
els.copyJson.addEventListener('click', async () => {
  const recording = currentState?.recording;
  if (recording) await navigator.clipboard.writeText(JSON.stringify(recording, null, 2));
});

chrome.tabs.onActivated?.addListener(() => void refresh());
chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
  if (activeTab?.id === tabId && changeInfo.status === 'complete') {
    void refresh();
  }
});

await refresh();

async function refresh() {
  activeTab = await getActiveTab();
  currentState = await sendMessage({ type: 'domrecorder:get-state' });
  if (currentState?.recording) {
    selectedScopeSelector = currentState.recording.scopeSelector || null;
    selectedScopeLabel = selectedScopeSelector;
  }
  render();
}

async function startRecording() {
  activeTab = await getActiveTab();
  if (!activeTab?.id) return;
  currentState = await sendMessage({
    type: 'domrecorder:start',
    tabId: activeTab.id,
    config: { scopeSelector: selectedScopeSelector || null },
  });
  picking = false;
  render();
}

async function stopRecording() {
  currentState = await sendMessage({ type: 'domrecorder:stop' });
  picking = false;
  render();
}

async function startPicking() {
  activeTab = await getActiveTab();
  if (!activeTab?.id) return;
  picking = true;
  render();
  await sendMessage({ type: 'domrecorder:pick', tabId: activeTab.id });
}

async function cancelPicking() {
  if (!activeTab?.id) return;
  await sendMessage({ type: 'domrecorder:pick-cancel', tabId: activeTab.id });
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
  els.copyAi.disabled = !recording;
  els.copyJson.disabled = !recording;

  if (activeTab) {
    els.tabInfo.textContent = `Active tab: ${activeTab.title || activeTab.url || 'Unknown'} (${activeTab.url || 'no url'})`;
  } else {
    els.tabInfo.textContent = 'No active tab.';
  }

  if (recording) {
    const transactions = recording.transactions?.length || 0;
    els.preview.textContent = buildAiDropText(recording);
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
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(response || null));
  });
}

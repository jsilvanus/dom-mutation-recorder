import { buildAiDropText } from './shared.js';

const els = {
  status: document.querySelector('#status'),
  refresh: document.querySelector('#refresh'),
  start: document.querySelector('#start'),
  stop: document.querySelector('#stop'),
  copyAi: document.querySelector('#copy-ai'),
  copyJson: document.querySelector('#copy-json'),
  tabInfo: document.querySelector('#tab-info'),
  preview: document.querySelector('#preview'),
};

let currentState = null;
let activeTab = null;

els.refresh.addEventListener('click', () => void refresh());
els.start.addEventListener('click', () => void startRecording());
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
  render();
}

async function startRecording() {
  activeTab = await getActiveTab();
  if (!activeTab?.id) return;
  currentState = await sendMessage({ type: 'domrecorder:start', tabId: activeTab.id });
  render();
}

async function stopRecording() {
  currentState = await sendMessage({ type: 'domrecorder:stop' });
  render();
}

function render() {
  const recording = currentState?.recording;
  const live = Boolean(currentState?.live);
  els.status.textContent = live ? 'Recording' : recording ? 'Stopped' : 'Idle';
  els.status.className = `status ${live ? 'live' : recording ? 'stopped' : 'idle'}`;
  els.start.disabled = live || !activeTab?.id;
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

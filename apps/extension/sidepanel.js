import { buildAiDropText, pickScopeSelector } from './shared.js';

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
let picking = false;
let pickerCleanup = null;
let hoverCleanup = null;

els.refresh.addEventListener('click', () => void refresh());
els.start.addEventListener('click', () => void startRecording());
els.pick.addEventListener('click', () => void beginPicking());
els.page.addEventListener('click', () => {
  selectedScopeSelector = null;
  picking = false;
  cleanupHover();
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
  render();
}

async function stopRecording() {
  currentState = await sendMessage({ type: 'domrecorder:stop' });
  render();
}

function render() {
  const recording = currentState?.recording;
  const live = Boolean(currentState?.live);
  const sameOrigin = canAccessPreview();
  els.status.textContent = picking ? 'Picking element' : live ? 'Recording' : recording ? 'Stopped' : 'Idle';
  els.status.className = `status ${picking ? 'picking' : live ? 'live' : recording ? 'stopped' : 'idle'}`;
  els.start.disabled = live || picking || !activeTab?.id || !sameOrigin;
  els.pick.disabled = live || picking || !activeTab?.id || !sameOrigin;
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
  els.scopeInfo.textContent = `Scope: ${scope}`;
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

async function beginPicking() {
  if (!canAccessPreview()) return;
  const win = els.preview.contentWindow;
  const doc = win?.document;
  if (!doc) return;
  cleanupHover();
  picking = true;
  render();

  const finish = () => {
   picking = false;
   cleanupHover();
   render();
  };

  const onMove = (event) => {
   const target = event.target instanceof win.Element ? event.target : null;
   if (!target) return;
   if (typeof hoverCleanup === 'function') hoverCleanup();
   target.style.outline = '2px solid #2563eb';
   target.style.outlineOffset = '2px';
   hoverCleanup = () => {
     target.style.outline = '';
     target.style.outlineOffset = '';
   };
  };

  const onClick = (event) => {
   const target = event.target instanceof win.Element ? event.target : null;
   if (!target) return;
   event.preventDefault();
   event.stopPropagation();
   selectedScopeSelector = pickScopeSelector(target);
   finish();
  };

  doc.addEventListener('mousemove', onMove, true);
  doc.addEventListener('click', onClick, true);

  pickerCleanup = () => {
   doc.removeEventListener('mousemove', onMove, true);
   doc.removeEventListener('click', onClick, true);
  };
}

function cleanupHover() {
  if (typeof hoverCleanup === 'function') {
   hoverCleanup();
  }
  hoverCleanup = null;
  if (typeof pickerCleanup === 'function') {
   pickerCleanup();
  }
  pickerCleanup = null;
}

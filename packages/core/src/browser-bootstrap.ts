import type { RecordingConfig, RecordingTarget } from './model.js';
import { describeElement, resolveSelector } from './selectors.js';
import { captureRecordingSnapshot } from './snapshot.js';
import { describeMutationRecord } from './mutations.js';
import { shouldRedactElementValue } from './redaction.js';

export type BrowserRecorderInit = {
  channel: string;
  config?: RecordingConfig;
};

// Native events delegated from `document` in the capture phase. Capturing always traverses
// the ancestor chain down to the real target regardless of an event's `bubbles` flag, so this
// single delegation point also catches non-bubbling types like focus/blur/pointerenter/
// pointerleave/scroll without needing a listener per element.
const DELEGATED_EVENT_TYPES = [
  'click', 'dblclick',
  'pointerdown', 'pointerup', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave',
  'mousedown', 'mouseup', 'mouseover', 'mouseout', 'contextmenu',
  'input', 'change', 'select',
  'keydown', 'keyup', 'keypress',
  'focus', 'blur',
  'submit', 'reset',
  'scroll',
] as const;

// These fire with `window` itself as the target, so they fall outside document's ancestor
// chain and need their own listeners.
const WINDOW_EVENT_TYPES = ['resize', 'popstate', 'hashchange'] as const;

// scroll/resize can fire dozens of times a second while in progress; only the settled end
// state is a meaningful "action" worth an anchor, so these are debounced before emitting.
const DEBOUNCED_EVENT_TYPES = new Set(['scroll', 'resize']);
const DEBOUNCE_DELAY_MS = 200;

const WINDOW_TARGET: RecordingTarget = { selector: 'window', tagName: '#window' };
const DOCUMENT_TARGET: RecordingTarget = { selector: 'document', tagName: '#document' };

// This function is the canonical in-page recorder. It is injected into a live page in two
// ways:
//  - packages/playwright bundles it (via esbuild — see scripts/build-browser-bootstrap.mjs)
//    into a self-contained script and installs it with page.addInitScript/page.evaluate.
//  - packages/chrome re-exports it for consumers who bundle it into their own content script
//    with their own tooling.
// Either way, by the time it runs it is bundled/inlined so it can freely import the rest of
// packages/core (selectors/snapshot/mutations/redaction) — unlike apps/extension/shared.js's
// browserRecorderBootstrap, which Chrome's `chrome.scripting.executeScript({ func })` injects
// by serializing the function's own source with no bundling step, and therefore *must* stay a
// single self-contained function with no outside imports.
export function browserRecorderBootstrap(options: BrowserRecorderInit): void {
  const config = options.config || {};
  const scopeElement = resolveSelector(document, config.scopeSelector);
  const emit = (payload: unknown) => {
    const fn = (window as unknown as Record<string, (value: unknown) => void>)[options.channel];
    if (typeof fn === 'function') fn(payload);
  };

  const snapshot = () => captureRecordingSnapshot(document, config);

  const captureActionSnapshots = config.captureActionSnapshots !== false;
  const idleSnapshotDelayMs = config.idleSnapshotDelayMs ?? 600;

  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const debounce = (key: string, delayMs: number, fn: () => void) => {
    const existing = debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
      key,
      setTimeout(() => {
        debounceTimers.delete(key);
        fn();
      }, delayMs),
    );
  };

  const emitSnapshot = (reason: 'action' | 'idle') => {
    emit({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'snapshot',
      data: { snapshot: snapshot(), reason },
    });
  };

  // Fires once DOM mutation activity has been quiet for idleSnapshotDelayMs, capturing the
  // "response settled" state after a burst of dom.* events (e.g. an SPA re-render).
  const scheduleIdleSnapshot = () => {
    if (!captureActionSnapshots) return;
    debounce('__idle_snapshot__', idleSnapshotDelayMs, () => emitSnapshot('idle'));
  };

  const emitAction = (type: string, target: RecordingTarget, data: Record<string, unknown>) => {
    emit({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type,
      target,
      data,
    });
    if (captureActionSnapshots) emitSnapshot('action');
  };

  const lastValues = new WeakMap<Element, string>();

  const handleDelegated = (type: string, event: Event) => {
    const rawTarget = event.target;
    let target: RecordingTarget;
    if (rawTarget instanceof Element) {
      if (scopeElement && !scopeElement.contains(rawTarget) && rawTarget !== scopeElement) return;
      target = describeElement(rawTarget, config);
    } else if (rawTarget === document) {
      // Whole-page scroll fires with `document` as the target, not an Element.
      if (scopeElement) return;
      target = DOCUMENT_TARGET;
    } else {
      return;
    }

    const data: Record<string, unknown> = {};
    if ('clientX' in event && typeof event.clientX === 'number') {
      data.coordinates = { x: event.clientX, y: 'clientY' in event ? (event as MouseEvent).clientY : 0 };
    }
    if (event instanceof KeyboardEvent) {
      const redact = rawTarget instanceof Element && shouldRedactElementValue(rawTarget, config);
      data.key = redact && event.key.length === 1 ? '[redacted]' : event.key;
      data.code = event.code;
    }
    if (rawTarget instanceof HTMLInputElement || rawTarget instanceof HTMLTextAreaElement) {
      // Update lastValues on every event that touches this field (not just input/change) so
      // the very first keystroke has a real "before" value captured from an earlier
      // focus/keydown, instead of falling back to the just-changed current value.
      const current = shouldRedactElementValue(rawTarget, config) ? '[redacted]' : rawTarget.value;
      const before = lastValues.get(rawTarget) ?? current;
      if (type === 'user.input' || type === 'user.change') {
        data.before = before;
        data.after = current;
      } else if (type === 'user.select') {
        try {
          data.selectionStart = rawTarget.selectionStart;
          data.selectionEnd = rawTarget.selectionEnd;
        } catch {
          // selectionStart/selectionEnd throw for input types that don't support text selection
        }
      }
      lastValues.set(rawTarget, current);
    }
    if (type === 'user.scroll') {
      if (rawTarget instanceof Element) {
        data.scrollTop = rawTarget.scrollTop;
        data.scrollLeft = rawTarget.scrollLeft;
      } else {
        data.scrollX = window.scrollX;
        data.scrollY = window.scrollY;
      }
    }

    const eventName = type.slice('user.'.length);
    if (DEBOUNCED_EVENT_TYPES.has(eventName)) {
      debounce(type, DEBOUNCE_DELAY_MS, () => emitAction(type, target, data));
      return;
    }
    emitAction(type, target, data);
  };

  const documentListeners: Array<[string, EventListener]> = [];
  for (const type of DELEGATED_EVENT_TYPES) {
    const handler = (event: Event) => handleDelegated(`user.${type}`, event);
    document.addEventListener(type, handler, true);
    documentListeners.push([type, handler]);
  }

  const windowListeners: Array<[string, EventListener]> = [];
  for (const type of WINDOW_EVENT_TYPES) {
    const handler = (event: Event) => {
      const emitType = `user.${type}`;
      const data: Record<string, unknown> = {};
      if (type === 'resize') {
        data.width = window.innerWidth;
        data.height = window.innerHeight;
        debounce(emitType, DEBOUNCE_DELAY_MS, () => emitAction(emitType, WINDOW_TARGET, data));
        return;
      }
      if (type === 'popstate') {
        data.url = location.href;
        data.state = safeClone((event as PopStateEvent).state);
      } else if (type === 'hashchange') {
        data.oldURL = (event as HashChangeEvent).oldURL;
        data.newURL = (event as HashChangeEvent).newURL;
      }
      emitAction(emitType, WINDOW_TARGET, data);
    };
    window.addEventListener(type, handler);
    windowListeners.push([type, handler]);
  }

  // history.pushState/replaceState don't dispatch any native event, so SPA route/state
  // transitions that don't happen to touch the DOM would otherwise be invisible.
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);
  history.pushState = (state: unknown, unused: string, url?: string | URL | null) => {
    originalPushState(state, unused, url);
    emitAction('history.pushState', DOCUMENT_TARGET, { url: location.href, state: safeClone(state) });
  };
  history.replaceState = (state: unknown, unused: string, url?: string | URL | null) => {
    originalReplaceState(state, unused, url);
    emitAction('history.replaceState', DOCUMENT_TARGET, { url: location.href, state: safeClone(state) });
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const event of describeMutationRecord(record, config)) {
        emit(event);
      }
    }
    scheduleIdleSnapshot();
  });

  observer.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
    attributeOldValue: true,
    characterDataOldValue: true,
  });

  // This runs as an init script, which can execute before the document has parsed <html> at
  // all (document.documentElement briefly null). Skip the initial snapshot in that case
  // rather than emitting an empty placeholder as if it were real content — a real one
  // follows shortly via __domRecorderSnapshot, called again once navigation completes.
  if (document.documentElement) {
    emit({ snapshot: snapshot() });
  }
  (window as unknown as Record<string, unknown>).__domRecorderSnapshot = snapshot;
  (window as unknown as Record<string, unknown>).__domRecorderStop = () => {
    observer.disconnect();
    for (const timer of debounceTimers.values()) clearTimeout(timer);
    debounceTimers.clear();
    for (const [type, handler] of documentListeners) {
      document.removeEventListener(type, handler, true);
    }
    for (const [type, handler] of windowListeners) {
      window.removeEventListener(type, handler);
    }
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
  };
}

function safeClone(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

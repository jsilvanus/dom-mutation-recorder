import type { RecordingConfig } from './model.js';
import { describeElement, resolveSelector } from './selectors.js';
import { captureRecordingSnapshot } from './snapshot.js';
import { describeMutationRecord } from './mutations.js';
import { shouldRedactElementValue } from './redaction.js';

export type BrowserRecorderInit = {
  channel: string;
  config?: RecordingConfig;
};

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

  const lastValues = new WeakMap<Element, string>();
  const documentListeners: Array<[string, EventListener]> = [];
  const emitUser = (type: string, event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (scopeElement && !scopeElement.contains(target) && target !== scopeElement) return;
    const element = describeElement(target, config);
    const data: Record<string, unknown> = {};
    if ('clientX' in event && typeof event.clientX === 'number') {
      data.coordinates = { x: event.clientX, y: 'clientY' in event ? (event as MouseEvent).clientY : 0 };
    }
    if (event instanceof KeyboardEvent) {
      data.key = shouldRedactElementValue(target, config) && event.key.length === 1 ? '[redacted]' : event.key;
      data.code = event.code;
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      // Update lastValues on every event that touches this field (not just input/change) so
      // the very first keystroke has a real "before" value captured from an earlier
      // focus/keydown, instead of falling back to the just-changed current value.
      const current = shouldRedactElementValue(target, config) ? '[redacted]' : target.value;
      const before = lastValues.get(target) ?? current;
      if (type === 'user.input' || type === 'user.change') {
        data.before = before;
        data.after = current;
      }
      lastValues.set(target, current);
    }
    emit({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type,
      target: element,
      data,
    });
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const event of describeMutationRecord(record, config)) {
        emit(event);
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

  for (const type of ['click', 'dblclick', 'input', 'change', 'keydown', 'keyup', 'focus', 'blur'] as const) {
    const handler = (event: Event) => emitUser(`user.${type}`, event);
    document.addEventListener(type, handler, true);
    documentListeners.push([type, handler]);
  }

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
    for (const [type, handler] of documentListeners) {
      document.removeEventListener(type, handler, true);
    }
  };
}

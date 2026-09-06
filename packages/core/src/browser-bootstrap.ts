import type { RecordingConfig } from './model.js';

export type BrowserRecorderInit = {
  channel: string;
  config?: RecordingConfig;
};

export function browserRecorderBootstrap(options: BrowserRecorderInit): void {
  const config = options.config || {};
  const scopeSelector = config.scopeSelector || null;
  const scopeElement = (() => {
    if (!scopeSelector) return null;
    try {
      if (scopeSelector.startsWith('/') || scopeSelector.startsWith('(')) {
        const result = document.evaluate(scopeSelector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        return result.singleNodeValue instanceof Element ? result.singleNodeValue : null;
      }
      return document.querySelector(scopeSelector);
    } catch {
      return null;
    }
  })();
  const shouldRedactFieldValue = (tagName: string, type: string): boolean => {
    if (tagName === 'textarea') return config.redactInputValues !== false;
    if (tagName !== 'input') return false;
    if (type === 'password') {
      return config.redactPasswords !== false || config.redactInputValues !== false;
    }
    const nonRedactableInputTypes = new Set(['checkbox', 'radio', 'submit', 'button', 'reset', 'image', 'range', 'color', 'file']);
    return config.redactInputValues !== false && !nonRedactableInputTypes.has(type);
  };
  const shouldRedactElementValue = (element: Element): boolean => {
    const tag = element.tagName.toLowerCase();
    const type = element.getAttribute('type')?.toLowerCase() || 'text';
    return shouldRedactFieldValue(tag, type);
  };
  const emit = (payload: unknown) => {
    const fn = (window as unknown as Record<string, (value: unknown) => void>)[options.channel];
    if (typeof fn === 'function') fn(payload);
  };

  const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
  const truncate = (value: string, max = config.maxTextLength ?? 2000) =>
    value.length > max ? `${value.slice(0, max)}…` : value;
  const cssEscape = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'");
  const attrEscape = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const roleFor = (element: Element): string | null => {
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
  const nameFor = (element: Element): string | null => {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return clean(ariaLabel);
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const name = labelledBy
        .split(/\s+/)
        .map((id) => element.ownerDocument.getElementById(id)?.textContent?.trim() || '')
        .filter(Boolean)
        .join(' ')
        .trim();
      if (name) return clean(name);
    }
    const title = element.getAttribute('title');
    if (title) return clean(title);
    const text = clean(element.textContent || '');
    return text || null;
  };
  const pathFor = (element: Element): string => {
    const parts: string[] = [];
    let current: Element | null = element;
    while (current) {
      const tag = current.tagName.toLowerCase();
      const siblings = Array.from(current.parentElement?.children || []).filter((candidate) => candidate.tagName === current?.tagName);
      const index = siblings.length > 1 ? siblings.indexOf(current) + 1 : 0;
      parts.unshift(index > 0 ? `${tag}:nth-of-type(${index})` : tag);
      current = current.parentElement;
    }
    return parts.join(' > ');
  };
  const selectorsFor = (element: Element) => {
    const selectors: string[] = [];
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
  const describeElement = (element: Element) => {
    const selectors = selectorsFor(element);
    const redactValue = shouldRedactElementValue(element);
    return {
      selector: selectors[0],
      selectors,
      role: roleFor(element),
      name: nameFor(element),
      tagName: element.tagName.toLowerCase(),
      id: element.id || null,
      classes: Array.from(element.classList),
      path: pathFor(element),
      text: truncate(clean(element.textContent || '')),
      attributes: Object.fromEntries(
        Array.from(element.attributes).map((attribute) => [
          attribute.name,
          attribute.name === 'value' && redactValue ? '[redacted]' : truncate(attribute.value),
        ]),
      ),
    };
  };
  const snapshotNode = (node: Node, depth = 0): unknown => {
    if (depth > 20) return null;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = truncate(clean(node.textContent || ''));
      return text ? { kind: 'text', text } : null;
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_NODE) return null;
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : null;
    const attrs: Record<string, string> = {};
    if (element) {
      for (const attr of Array.from(element.attributes)) {
        if (attr.name === 'style') continue;
        if (attr.name === 'value' && shouldRedactElementValue(element)) {
          attrs[attr.name] = '[redacted]';
          continue;
        }
        attrs[attr.name] = truncate(attr.value);
      }
    }
    const children = Array.from(node.childNodes)
      .slice(0, config.maxSubtreeSize ?? 500)
      .map((child) => snapshotNode(child, depth + 1))
      .filter(Boolean);
    const selectors = element ? selectorsFor(element) : [];
    return {
      kind: node.nodeType === Node.DOCUMENT_NODE ? 'document' : 'element',
      tagName: element?.tagName.toLowerCase(),
      text: element ? truncate(clean(element.textContent || '')) || undefined : undefined,
      attributes: element ? attrs : undefined,
      children,
      selector: selectors[0],
      path: element ? pathFor(element) : 'document',
    };
  };
  const serializeHtml = (doc: Document) => {
    const root = scopeElement ?? doc.documentElement;
    // cloneNode(true) only copies HTML attributes, not the live `.value` IDL property that
    // typing/scripting updates on inputs and textareas — read the live values from the
    // originals (in the same traversal order as the clone) before they're discarded.
    const originalFields = Array.from(root.querySelectorAll('input, textarea'));
    const clone = root.cloneNode(true) as Element;
    for (const script of Array.from(clone.querySelectorAll('script, noscript'))) {
      script.textContent = '[omitted]';
    }
    const clonedFields = Array.from(clone.querySelectorAll('input, textarea'));
    clonedFields.forEach((field, index) => {
      // originalFields[index] is guaranteed to be an <input> or <textarea> by the selector above.
      const original = originalFields[index] as HTMLInputElement | HTMLTextAreaElement | undefined;
      const tag = field.tagName.toLowerCase();
      const type = (field.getAttribute('type') || 'text').toLowerCase();
      const liveValue = original?.value ?? '';
      const value = shouldRedactFieldValue(tag, type) ? '[redacted]' : liveValue;
      if (tag === 'textarea') {
        field.textContent = value;
      } else {
        field.setAttribute('value', value);
      }
    });
    return `<!doctype html>\n${clone.outerHTML}`;
  };
  const redactUrl = (value: string) => {
    try {
      const parsed = new URL(value);
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return value;
    }
  };
  const snapshot = () => ({
    url: config.redactUrls ? redactUrl(document.URL) : document.URL,
    title: document.title,
    html: serializeHtml(document),
    scopeSelector: scopeElement ? scopeSelector : null,
    document: snapshotNode(scopeElement ?? document) || { kind: 'document', children: [], path: 'html' },
  });

  const lastValues = new WeakMap<Element, string>();
  const documentListeners: Array<[string, EventListener]> = [];
  const emitUser = (type: string, event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (scopeElement && !scopeElement.contains(target) && target !== scopeElement) return;
    const element = describeElement(target);
    const data: Record<string, unknown> = {};
    if ('clientX' in event && typeof event.clientX === 'number') {
      data.coordinates = { x: event.clientX, y: 'clientY' in event ? (event as MouseEvent).clientY : 0 };
    }
    if (event instanceof KeyboardEvent) {
      data.key = shouldRedactElementValue(target) && event.key.length === 1 ? '[redacted]' : event.key;
      data.code = event.code;
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const current = shouldRedactElementValue(target) ? '[redacted]' : target.value;
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
      if (scopeElement && !mutationTouchesScope(record, scopeElement)) continue;
      if (record.type === 'childList') {
        const parent = record.target instanceof Element ? describeElement(record.target) : undefined;
        for (const node of Array.from(record.addedNodes)) {
          emit({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            type: 'dom.added',
            target: parent,
            data: {
              parent,
              position: Math.max(0, Array.from(record.target.childNodes).indexOf(node as ChildNode)),
              subtree: snapshotNode(node),
            },
          });
        }
        for (const node of Array.from(record.removedNodes)) {
          const siblings = Array.from(record.target.childNodes);
          const position = record.previousSibling ? Math.max(0, siblings.indexOf(record.previousSibling as ChildNode) + 1) : 0;
          emit({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            type: 'dom.removed',
            target: parent,
            data: {
              parent,
              position,
              subtree: snapshotNode(node),
            },
          });
        }
      } else if (record.type === 'attributes' && record.target instanceof Element) {
        const attribute = record.attributeName || '';
        const redact = attribute === 'value' && shouldRedactElementValue(record.target);
        emit({
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          type: 'dom.attributes',
          target: describeElement(record.target),
          data: {
            attribute,
            oldValue: redact ? '[redacted]' : record.oldValue,
            newValue: redact ? '[redacted]' : record.target.getAttribute(attribute) ?? null,
          },
        });
      } else if (record.type === 'characterData' && record.target instanceof CharacterData) {
        emit({
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          type: 'dom.text',
          target: record.target.parentElement ? describeElement(record.target.parentElement) : undefined,
          data: {
            oldText: record.oldValue || '',
            newText: record.target.data,
          },
        });
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

  emit({ snapshot: snapshot() });
  (window as unknown as Record<string, unknown>).__domRecorderSnapshot = snapshot;
  (window as unknown as Record<string, unknown>).__domRecorderStop = () => {
    observer.disconnect();
    for (const [type, handler] of documentListeners) {
      document.removeEventListener(type, handler, true);
    }
  };

  function mutationTouchesScope(record: MutationRecord, scope: Element): boolean {
    if (record.type === 'attributes' || record.type === 'characterData') {
      return record.target instanceof Node && (record.target === scope || scope.contains(record.target));
    }
    if (record.type === 'childList') {
      if (record.target instanceof Node && (record.target === scope || scope.contains(record.target))) return true;
      for (const node of Array.from(record.addedNodes)) {
        if (node === scope || (node instanceof Element && node.contains(scope))) return true;
      }
      for (const node of Array.from(record.removedNodes)) {
        if (node === scope || (node instanceof Element && node.contains(scope))) return true;
      }
    }
    return false;
  }

}

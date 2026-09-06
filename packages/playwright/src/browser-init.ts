import type { RecordingConfig } from '../../core/src/model.js';

export type BrowserRecorderInit = {
  channel: string;
  config?: RecordingConfig;
};

export function browserRecorderBootstrap(options: BrowserRecorderInit): void {
  const config = options.config || {};
  const emit = (payload: unknown) => {
    const fn = (window as unknown as Record<string, (value: unknown) => void>)[options.channel];
    if (typeof fn === 'function') fn(payload);
  };

  const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
  const truncate = (value: string, max = config.maxTextLength ?? 2000) =>
    value.length > max ? `${value.slice(0, max)}…` : value;
  const cssEscape = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
  const roleFor = (element: Element): string | null => {
    const explicit = element.getAttribute('role');
    if (explicit) return explicit;
    const tag = element.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a' && element.hasAttribute('href')) return 'link';
    if (tag === 'textarea' || tag === 'input') return 'textbox';
    if (tag === 'select') return 'combobox';
    return null;
  };
  const nameFor = (element: Element): string | null => {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return clean(ariaLabel);
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
    if (testId) selectors.push(`[data-testid="${testId}"]`);
    const role = roleFor(element);
    const name = nameFor(element);
    if (role && name) selectors.push(`getByRole("${role}", { name: ${JSON.stringify(name)} })`);
    const className = Array.from(element.classList).filter(Boolean).slice(0, 2).join('.');
    if (className) selectors.push(`${element.tagName.toLowerCase()}.${className}`);
    selectors.push(pathFor(element));
    return selectors;
  };
  const describeElement = (element: Element) => ({
    selector: selectorsFor(element)[0],
    selectors: selectorsFor(element),
    role: roleFor(element),
    name: nameFor(element),
    tagName: element.tagName.toLowerCase(),
    id: element.id || null,
    classes: Array.from(element.classList),
    path: pathFor(element),
    text: truncate(clean(element.textContent || '')),
    attributes: Object.fromEntries(Array.from(element.attributes).map((attribute) => [attribute.name, truncate(attribute.value)])),
  });
  const shouldRedactValue = (element: Element) => {
    if (element instanceof HTMLInputElement && element.type === 'password') return config.redactPasswords !== false;
    return config.redactInputValues !== false && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement);
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
        if (attr.name === 'value' && shouldRedactValue(element)) {
          attrs[attr.name] = '[redacted]';
          continue;
        }
        attrs[attr.name] = truncate(attr.value);
      }
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        attrs.value = shouldRedactValue(element) ? '[redacted]' : truncate(element.value);
      }
    }
    const children = Array.from(node.childNodes).slice(0, config.maxSubtreeSize ?? 500).map((child) => snapshotNode(child, depth + 1)).filter(Boolean);
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
  const snapshot = () => ({
    url: config.redactUrls ? redactUrl(document.URL) : document.URL,
    title: document.title,
    html: serializeHtml(document),
    document: snapshotNode(document.documentElement) || { kind: 'document', children: [], path: 'html' },
  });
  const serializeHtml = (doc: Document) => {
    const clone = doc.documentElement.cloneNode(true) as HTMLElement;
    for (const script of Array.from(clone.querySelectorAll('script, noscript'))) {
      script.textContent = '[omitted]';
    }
    for (const input of Array.from(clone.querySelectorAll('input, textarea'))) {
      const type = (input.getAttribute('type') || 'text').toLowerCase();
      if ((type === 'password' && config.redactPasswords !== false) || (type !== 'password' && config.redactInputValues !== false)) {
        input.setAttribute('value', '[redacted]');
      }
    }
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

  const lastValues = new WeakMap<Element, string>();
  const emitUser = (type: string, event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const element = describeElement(target);
    const data: Record<string, unknown> = {};
    if ('clientX' in event && typeof event.clientX === 'number') {
      data.coordinates = { x: event.clientX, y: 'clientY' in event ? (event as MouseEvent).clientY : 0 };
    }
    if (event instanceof KeyboardEvent) {
      data.key = shouldRedactValue(target) && event.key.length === 1 ? '[redacted]' : event.key;
      data.code = event.code;
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const current = shouldRedactValue(target) ? '[redacted]' : target.value;
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
          emit({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            type: 'dom.removed',
            target: parent,
            data: {
              parent,
              position: Math.max(0, Array.from(record.target.childNodes).length),
              subtree: snapshotNode(node),
            },
          });
        }
      } else if (record.type === 'attributes' && record.target instanceof Element) {
        emit({
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          type: 'dom.attributes',
          target: describeElement(record.target),
          data: {
            attribute: record.attributeName || '',
            oldValue: record.oldValue,
            newValue: record.target.getAttribute(record.attributeName || '') ?? null,
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
    document.addEventListener(type, (event) => emitUser(`user.${type}`, event), true);
  }

  emit({ snapshot: snapshot() });
  (window as unknown as Record<string, unknown>).__domRecorderSnapshot = snapshot;
  (window as unknown as Record<string, unknown>).__domRecorderStop = () => observer.disconnect();
}

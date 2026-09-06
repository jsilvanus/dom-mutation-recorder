import type { DomNodeSnapshot, RecordingConfig, RecordingSnapshot } from './model.js';
import { shouldRedactElementValue, shouldRedactFieldValue } from './redaction.js';
import { buildDomPath, generateSelectors, resolveSelector } from './selectors.js';

export type CaptureSnapshotOptions = {
  // `html` clones and serializes the *entire* subtree with no size bound (unlike `document`,
  // which is capped by maxTextLength/maxSubtreeSize) — cheap for the one-off bookend snapshots
  // a recording takes, but ruinous if repeated on every bracketed action: a handful of clicks
  // on a normal-sized page is enough to blow past chrome.storage.session's 10MB quota (see
  // apps/extension/service-worker.js, which persists the whole growing recording on every
  // event). Callers that only need the bounded `document` tree — e.g. the inline per-action/
  // idle snapshots in browser-bootstrap.ts — should pass `includeHtml: false`.
  includeHtml?: boolean;
};

export function captureRecordingSnapshot(
  document: Document,
  config: RecordingConfig = {},
  options: CaptureSnapshotOptions = {},
): RecordingSnapshot {
  const scopeElement = resolveSelector(document, config.scopeSelector);
  const includeHtml = options.includeHtml ?? true;
  const html = includeHtml ? serializeDocumentHtml(document, config, scopeElement) : '';
  return {
    url: config.redactUrls ? redactUrl(document.URL) : document.URL,
    title: document.title,
    html,
    scopeSelector: scopeElement ? config.scopeSelector ?? null : null,
    document: serializeNode(scopeElement ?? document, config, 0) ?? {
      kind: 'document',
      children: [],
      path: 'html',
    },
  };
}

export function serializeNode(
  node: Node,
  config: RecordingConfig = {},
  depth = 0,
): DomNodeSnapshot | null {
  const maxTextLength = config.maxTextLength ?? 2_000;
  const maxSubtreeSize = config.maxSubtreeSize ?? 500;
  if (depth > 20) return null;

  if (node.nodeType === Node.TEXT_NODE) {
    const text = truncate((node.textContent || '').replace(/\s+/g, ' ').trim(), maxTextLength);
    if (!text) return null;
    return { kind: 'text', text };
  }

  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_NODE) {
    return null;
  }

  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : null;
  const tagName = element?.tagName.toLowerCase();
  const attributes = element ? serializeAttributes(element, config) : undefined;
  const children: DomNodeSnapshot[] = [];
  const childNodes = node.childNodes ? Array.from(node.childNodes) : [];
  for (const child of childNodes.slice(0, maxSubtreeSize)) {
    const childSnapshot = serializeNode(child, config, depth + 1);
    if (childSnapshot) children.push(childSnapshot);
  }
  if (childNodes.length > maxSubtreeSize) {
    children.push({
      kind: 'text',
      text: `[…] ${childNodes.length - maxSubtreeSize} more nodes`,
    });
  }

  const textContent = element
    ? truncate(cleanText(element.textContent || ''), maxTextLength)
    : undefined;
  const path = element ? buildDomPath(element) : 'document';
  const selectors = element ? generateSelectors(element) : [];

  return {
    kind: node.nodeType === Node.DOCUMENT_NODE ? 'document' : 'element',
    tagName,
    text: textContent || undefined,
    attributes,
    children,
    path,
    selector: selectors[0]?.selector,
  };
}

export function serializeDocumentHtml(document: Document, config: RecordingConfig = {}, scopeElement?: Element | null): string {
  const root = scopeElement ?? document.documentElement;
  // documentElement can briefly be null on a document that hasn't started parsing yet (e.g.
  // an init script running at the very start of navigation, before <html> exists).
  if (!root) return '<!doctype html>\n<html></html>';
  // cloneNode(true) only copies HTML attributes, not the live `.value` IDL property that
  // typing/scripting updates on inputs and textareas — read the live values from the
  // originals (in the same traversal order as the clone) before they're discarded.
  const originalFields = Array.from(root.querySelectorAll('input, textarea'));
  const clone = root.cloneNode(true) as HTMLElement;
  for (const script of Array.from(clone.querySelectorAll('script, noscript'))) {
    script.textContent = '[omitted]';
  }
  const clonedFields = Array.from(clone.querySelectorAll('input, textarea'));
  clonedFields.forEach((field, index) => {
    // originalFields[index] is guaranteed to be an <input> or <textarea> by the selector
    // above; read `.value` directly rather than via `instanceof HTMLInputElement`, which can
    // fail when the element comes from a different realm (e.g. a JSDOM window) than the one
    // this module's globals resolve in.
    const original = originalFields[index] as HTMLInputElement | HTMLTextAreaElement | undefined;
    const tag = field.tagName.toLowerCase();
    const type = (field.getAttribute('type') || 'text').toLowerCase();
    const liveValue = original?.value ?? '';
    const value = shouldRedactFieldValue(tag, type, config) ? '[redacted]' : liveValue;
    if (tag === 'textarea') {
      field.textContent = value;
    } else {
      field.setAttribute('value', value);
    }
  });
  return `<!doctype html>\n${clone.outerHTML}`;
}

function serializeAttributes(element: Element, config: RecordingConfig): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name === 'style') continue;
    if (attribute.name === 'value' && shouldRedactElementValue(element, config)) {
      attributes[attribute.name] = '[redacted]';
      continue;
    }
    attributes[attribute.name] = truncate(attribute.value, config.maxTextLength ?? 2_000);
  }
  const tag = element.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') {
    const valueSource = tag === 'input'
      ? (element as HTMLInputElement).value
      : (element as HTMLTextAreaElement).value;
    const value = shouldRedactElementValue(element, config) ? '[redacted]' : truncate(valueSource, config.maxTextLength ?? 2_000);
    attributes.value = value;
  }
  return attributes;
}

function truncate(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

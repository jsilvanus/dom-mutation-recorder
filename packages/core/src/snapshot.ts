import type { DomNodeSnapshot, RecordingConfig, RecordingSnapshot } from './model.js';
import { shouldRedactFieldValue } from './redaction.js';
import { buildDomPath, generateSelectors, resolveSelector } from './selectors.js';

export function captureRecordingSnapshot(
  document: Document,
  config: RecordingConfig = {},
): RecordingSnapshot {
  const scopeElement = resolveSelector(document, config.scopeSelector);
  const html = serializeDocumentHtml(document, config, scopeElement);
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
  const clone = (scopeElement ?? document.documentElement).cloneNode(true) as HTMLElement;
  for (const script of Array.from(clone.querySelectorAll('script, noscript'))) {
    script.textContent = '[omitted]';
  }
  for (const input of Array.from(clone.querySelectorAll('input, textarea'))) {
    const type = (input.getAttribute('type') || 'text').toLowerCase();
    const tag = input.tagName.toLowerCase();
    if (shouldRedactFieldValue(tag, type, config)) {
      input.setAttribute('value', '[redacted]');
    }
  }
  return `<!doctype html>\n${clone.outerHTML}`;
}

function serializeAttributes(element: Element, config: RecordingConfig): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name === 'style') continue;
    if (attribute.name === 'value' && shouldRedactValue(element, config)) {
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
    const value = shouldRedactValue(element, config) ? '[redacted]' : truncate(valueSource, config.maxTextLength ?? 2_000);
    attributes.value = value;
  }
  return attributes;
}

function shouldRedactValue(element: Element, config: RecordingConfig): boolean {
  const tag = element.tagName.toLowerCase();
  const type = element.getAttribute('type')?.toLowerCase() || 'text';
  return shouldRedactFieldValue(tag, type, config);
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

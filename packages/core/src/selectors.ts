import type { DomNodeSnapshot, RecordingConfig, RecordingTarget, SelectorCandidate } from './model.js';
import { shouldRedactElementValue } from './redaction.js';

export function cssEscape(value: string): string {
  const css = (globalThis as { CSS?: { escape?: (input: string) => string } }).CSS?.escape;
  if (css) return css(value);
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'");
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function getRole(element: Element): string | null {
  const explicit = element.getAttribute('role');
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a' && element.hasAttribute('href')) return 'link';
  if (tag === 'input') {
    const type = (element.getAttribute('type') || 'text').toLowerCase();
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
    return 'textbox';
  }
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  return null;
}

export function getAccessibleName(element: Element): string | null {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim() || null;
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const name = labelledBy
      .split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent?.trim() || '')
      .filter(Boolean)
      .join(' ')
      .trim();
    if (name) return name;
  }
  const title = element.getAttribute('title');
  if (title) return title.trim() || null;
  const text = element.textContent?.replace(/\s+/g, ' ').trim();
  return text || null;
}

export function buildDomPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const tag = current.tagName.toLowerCase();
    const siblings = Array.from(current.parentElement?.children || []).filter(
      (candidate) => candidate.tagName === current?.tagName,
    );
    const index = siblings.length > 1 ? siblings.indexOf(current) + 1 : 0;
    parts.unshift(index > 0 ? `${tag}:nth-of-type(${index})` : tag);
    current = current.parentElement;
  }
  return parts.join(' > ');
}

export function buildXPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current) {
    const tag = current.tagName.toLowerCase();
    const siblings = Array.from(current.parentElement?.children || []).filter(
      (candidate) => candidate.tagName === current?.tagName,
    );
    const index = siblings.length > 1 ? siblings.indexOf(current) + 1 : 1;
    parts.unshift(`/${tag}[${index}]`);
    current = current.parentElement;
  }
  return parts.join('');
}

export function resolveSelector(document: Document, selector?: string | null): Element | null {
  if (!selector) return null;
  try {
    if (selector.startsWith('/') || selector.startsWith('(')) {
      const result = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return result.singleNodeValue instanceof Element ? result.singleNodeValue : null;
    }
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

export function isWithinScope(node: Node, scope: Element): boolean {
  return node === scope || scope.contains(node);
}

export function generateSelectors(element: Element): SelectorCandidate[] {
  const candidates: SelectorCandidate[] = [];
  const tag = element.tagName.toLowerCase();
  const stableId = element.getAttribute('data-testid') || element.getAttribute('data-test') || element.getAttribute('data-qa');
  const id = element.id;
  if (id) {
    candidates.push({ type: 'stable-id', selector: `#${cssEscape(id)}`, confidence: 1 });
  }
  if (stableId) {
    candidates.push({ type: 'data-testid', selector: `[data-testid="${escapeAttributeValue(stableId)}"]`, confidence: 0.98 });
  }
  const role = getRole(element);
  const name = getAccessibleName(element);
  if (role && name) {
    candidates.push({ type: 'aria', selector: `getByRole("${role}", { name: ${JSON.stringify(name)} })`, confidence: 0.95 });
    candidates.push({ type: 'role', selector: `[role="${role}"]`, confidence: 0.75 });
  }
  const attrs = Array.from(element.attributes)
    .filter((attr) => !['id', 'class', 'style'].includes(attr.name))
    .filter((attr) => attr.name.startsWith('data-') || attr.name.startsWith('aria-') || attr.name === 'name' || attr.name === 'type');
  for (const attr of attrs.slice(0, 3)) {
    candidates.push({
      type: 'data-attribute',
      selector: `${tag}[${attr.name}="${escapeAttributeValue(attr.value)}"]`,
      confidence: 0.8,
    });
  }
  const classNames = element.classList.length > 0 ? Array.from(element.classList).filter(Boolean).slice(0, 3) : [];
  if (classNames.length) {
    candidates.push({
      type: 'class',
      selector: `${tag}.${classNames.map(cssEscape).join('.')}`,
      confidence: 0.6,
    });
  }
  if (!id && classNames.length) {
    candidates.push({
      type: 'attribute',
      selector: `${tag}[class*="${escapeAttributeValue(classNames[0])}"]`,
      confidence: 0.45,
    });
  }
  candidates.push({ type: 'css-path', selector: buildDomPath(element), confidence: 0.3 });
  candidates.push({ type: 'xpath', selector: buildXPath(element), confidence: 0.1 });
  return dedupeCandidates(candidates);
}

function dedupeCandidates(candidates: SelectorCandidate[]): SelectorCandidate[] {
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => {
      const key = `${candidate.type}:${candidate.selector}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.confidence - a.confidence);
}

export function describeElement(element: Element, config: RecordingConfig = {}): RecordingTarget {
  const selectors = generateSelectors(element);
  const role = getRole(element);
  const name = getAccessibleName(element);
  const redactValue = shouldRedactElementValue(element, config);
  return {
    selector: selectors[0]?.selector,
    selectors,
    role,
    name,
    tagName: element.tagName.toLowerCase(),
    id: element.id || null,
    classes: Array.from(element.classList),
    path: buildDomPath(element),
    text: element.textContent?.replace(/\s+/g, ' ').trim() || null,
    attributes: Object.fromEntries(
      Array.from(element.attributes).map((attribute) => [
        attribute.name,
        attribute.name === 'value' && redactValue ? '[redacted]' : attribute.value,
      ]),
    ),
  };
}

export function describeSnapshotTarget(snapshot: DomNodeSnapshot | undefined): RecordingTarget | undefined {
  if (!snapshot || snapshot.kind !== 'element') return undefined;
  return {
    selector: snapshot.selector,
    path: snapshot.path,
    tagName: snapshot.tagName || null,
    text: snapshot.text || null,
    attributes: snapshot.attributes,
  };
}

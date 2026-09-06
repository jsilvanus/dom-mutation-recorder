import type { DomEventType, RecordingConfig, RecordingEvent, RecordingTarget } from './model.js';
import { describeElement, isWithinScope, resolveSelector } from './selectors.js';
import { serializeNode } from './snapshot.js';
import { shouldRedactElementValue } from './redaction.js';

export type MutationEventData =
  | {
      type: 'dom.added';
      parent?: RecordingTarget;
      position: number;
      subtree?: unknown;
    }
  | {
      type: 'dom.removed';
      parent?: RecordingTarget;
      position: number;
      subtree?: unknown;
    }
  | {
      type: 'dom.attributes';
      attribute: string;
      oldValue: string | null;
      newValue: string | null;
    }
  | {
      type: 'dom.text';
      oldText: string;
      newText: string;
    };

export function describeMutationRecord(record: MutationRecord, config: RecordingConfig = {}): RecordingEvent[] {
  const document = (record.target as Node & { ownerDocument?: Document | null }).ownerDocument || (record.target as Document);
  const scope = resolveSelector(document, config.scopeSelector);
  if (scope && !mutationTouchesScope(record, scope)) {
    return [];
  }

  const timestamp = new Date().toISOString();
  const events: RecordingEvent[] = [];

  if (record.type === 'childList') {
    const parent = isElementLike(record.target) ? describeElement(record.target, config) : undefined;
    for (const addedNode of Array.from(record.addedNodes)) {
      const position = Array.from(record.target.childNodes).indexOf(addedNode as ChildNode);
      events.push({
        id: crypto.randomUUID(),
        timestamp,
        type: 'dom.added',
        target: parent,
        data: {
          parent,
          position: Math.max(0, position),
          subtree: serializeNode(addedNode, config),
        },
      });
    }
    for (const removedNode of Array.from(record.removedNodes)) {
      const siblings = Array.from(record.target.childNodes);
      const position = record.previousSibling ? Math.max(0, siblings.indexOf(record.previousSibling as ChildNode) + 1) : 0;
      events.push({
        id: crypto.randomUUID(),
        timestamp,
        type: 'dom.removed',
        target: parent,
        data: {
          parent,
          position,
          subtree: serializeNode(removedNode, config),
        },
      });
    }
  }

  if (record.type === 'attributes' && isElementLike(record.target)) {
    const attribute = record.attributeName || '';
    const redact = attribute === 'value' && shouldRedactElementValue(record.target, config);
    events.push({
      id: crypto.randomUUID(),
      timestamp,
      type: 'dom.attributes',
      target: describeElement(record.target, config),
      data: {
        attribute,
        oldValue: redact ? '[redacted]' : record.oldValue,
        newValue: redact ? '[redacted]' : record.target.getAttribute(attribute) ?? null,
      },
    });
  }

  if (record.type === 'characterData' && isCharacterDataLike(record.target)) {
    events.push({
      id: crypto.randomUUID(),
      timestamp,
      type: 'dom.text',
      target: isElementLike(record.target.parentElement) ? describeElement(record.target.parentElement, config) : undefined,
      data: {
        oldText: record.oldValue || '',
        newText: record.target.data,
      },
    });
  }

  return events;
}

export function isMutationEventType(type: string): type is DomEventType {
  return type === 'dom.added' || type === 'dom.removed' || type === 'dom.attributes' || type === 'dom.text';
}

function mutationTouchesScope(record: MutationRecord, scope: Element): boolean {
  if (record.type === 'attributes' || record.type === 'characterData') {
    return isNodeLike(record.target) && isWithinScope(record.target, scope);
  }
  if (record.type === 'childList') {
    if (isNodeLike(record.target) && isWithinScope(record.target, scope)) return true;
    for (const node of Array.from(record.addedNodes)) {
      if (node === scope || (isElementLike(node) && node.contains(scope))) return true;
    }
    for (const node of Array.from(record.removedNodes)) {
      if (node === scope || (isElementLike(node) && node.contains(scope))) return true;
    }
  }
  return false;
}

function isNodeLike(value: unknown): value is Node {
  return Boolean(value && typeof value === 'object' && 'nodeType' in value);
}

function isElementLike(value: unknown): value is Element {
  return Boolean(value && typeof value === 'object' && 'nodeType' in value && (value as Element).nodeType === 1);
}

const CHARACTER_DATA_NODE_TYPES = new Set([3, 4, 7, 8]); // Text, CDATASection, ProcessingInstruction, Comment

function isCharacterDataLike(value: unknown): value is CharacterData {
  return Boolean(
    value && typeof value === 'object' && 'nodeType' in value && CHARACTER_DATA_NODE_TYPES.has((value as CharacterData).nodeType),
  );
}

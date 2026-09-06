import type { DomEventType, RecordingConfig, RecordingEvent, RecordingTarget } from './model.js';
import { describeElement } from './selectors.js';
import { serializeNode } from './snapshot.js';

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

export function describeMutationRecord(
  record: MutationRecord,
  config: RecordingConfig = {},
): RecordingEvent[] {
  const timestamp = new Date().toISOString();
  const events: RecordingEvent[] = [];
  if (record.type === 'childList') {
    const parent = isElementNode(record.target) ? describeElement(record.target as Element) : undefined;
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

  if (record.type === 'attributes' && isElementNode(record.target)) {
    events.push({
      id: crypto.randomUUID(),
      timestamp,
      type: 'dom.attributes',
      target: describeElement(record.target as Element),
      data: {
        attribute: record.attributeName || '',
        oldValue: record.oldValue,
        newValue: record.target.getAttribute(record.attributeName || '') ?? null,
      },
    });
  }

  if (record.type === 'characterData' && isTextNode(record.target)) {
    events.push({
      id: crypto.randomUUID(),
      timestamp,
      type: 'dom.text',
      target: (record.target as CharacterData).parentElement ? describeElement((record.target as CharacterData).parentElement!) : undefined,
      data: {
        oldText: record.oldValue || '',
        newText: (record.target as CharacterData).data,
      },
    });
  }

  return events;
}

export function isMutationEventType(type: string): type is DomEventType {
  return type === 'dom.added' || type === 'dom.removed' || type === 'dom.attributes' || type === 'dom.text';
}

function isElementNode(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

function isTextNode(node: Node): node is CharacterData {
  return node.nodeType === Node.TEXT_NODE;
}

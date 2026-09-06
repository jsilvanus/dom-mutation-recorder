import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  buildSemanticDiff,
  captureRecordingSnapshot,
  correlateRecording,
  describeElement,
  describeMutationRecord,
  generateSelectors,
  serializeRecording,
} from '../packages/core/src/index.js';
import type { Recording } from '../packages/core/src/model.js';

describe('core recording', () => {
  it('captures and redacts DOM snapshots', () => {
    const dom = new JSDOM(`
      <!doctype html>
      <html>
        <body>
          <button data-testid="save-button">Save</button>
          <input type="password" value="secret" />
        </body>
      </html>
    `);
    const snapshot = captureRecordingSnapshot(dom.window.document, {});
    expect(snapshot.document.kind).toBe('document');
    expect(snapshot.html).toContain('[redacted]');
    expect(snapshot.html).toContain('Save');
  });

  it('captures and filters a scoped selection', () => {
    const dom = new JSDOM(`
      <!doctype html>
      <html>
        <body>
          <div id="root">
            <button id="inside">Inside</button>
          </div>
          <button id="outside">Outside</button>
        </body>
      </html>
    `);
    const { document } = dom.window;
    const snapshot = captureRecordingSnapshot(document, { scopeSelector: '#root' });
    expect(snapshot.scopeSelector).toBe('#root');
    expect(snapshot.document.kind).toBe('element');
    expect(snapshot.html).toContain('Inside');
    expect(snapshot.html).not.toContain('Outside');

    const inside = document.querySelector('#inside')!;
    const outside = document.querySelector('#outside')!;
    const scoped = describeMutationRecord(
      {
        type: 'attributes',
        target: inside,
        attributeName: 'data-state',
        oldValue: null,
      } as unknown as MutationRecord,
      { scopeSelector: '#root' },
    );
    const skipped = describeMutationRecord(
      {
        type: 'attributes',
        target: outside,
        attributeName: 'data-state',
        oldValue: null,
      } as unknown as MutationRecord,
      { scopeSelector: '#root' },
    );
    expect(scoped).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });

  it('generates robust selector candidates', () => {
    const dom = new JSDOM(`<button id="save" data-testid="save-button" aria-label="Save changes">Save</button>`);
    const element = dom.window.document.querySelector('button')!;
    const selectors = generateSelectors(element);
    expect(selectors[0]?.selector).toBe('#save');
    expect(selectors.some((candidate) => candidate.selector.includes('getByRole'))).toBe(true);
    expect(describeElement(element).name).toBe('Save changes');
  });

  it('records mutation observer events', async () => {
    const dom = new JSDOM(`<div id="root"><span id="label">before</span></div>`, { pretendToBeVisual: true });
    const { document } = dom.window;
    const events: ReturnType<typeof describeMutationRecord> = [];

    const root = document.querySelector('#root')!;
    const label = document.querySelector('#label')!;
    events.push(
      ...describeMutationRecord(
        {
          type: 'characterData',
          target: label.firstChild!,
          oldValue: 'before',
        } as unknown as MutationRecord,
        {},
      ),
      ...describeMutationRecord(
        {
          type: 'attributes',
          target: root,
          attributeName: 'data-state',
          oldValue: null,
        } as unknown as MutationRecord,
        {},
      ),
      ...describeMutationRecord(
        {
          type: 'childList',
          target: root,
          addedNodes: [document.createElement('p')],
          removedNodes: [],
        } as unknown as MutationRecord,
        {},
      ),
      ...describeMutationRecord(
        {
          type: 'childList',
          target: root,
          addedNodes: [],
          removedNodes: [label],
        } as unknown as MutationRecord,
        {},
      ),
    );

    expect(events.some((event) => event.type === 'dom.attributes')).toBe(true);
    expect(events.some((event) => event.type === 'dom.added')).toBe(true);
    expect(events.some((event) => event.type === 'dom.removed')).toBe(true);
    expect(events.some((event) => event.type === 'dom.text')).toBe(true);
  });

  it('correlates actions with mutations and builds semantic diffs', () => {
    const recording: Recording = {
      id: 'rec',
      version: '1.0.0',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:01.000Z',
      url: 'https://example.com',
      title: 'Example',
      userAgent: 'test',
      initialSnapshot: captureRecordingSnapshot(new JSDOM('<button>Add</button>').window.document, {}),
      events: [
        {
          id: 'a1',
          timestamp: '2026-01-01T00:00:00.000Z',
          type: 'user.click',
          target: { selector: 'button', name: 'Add', tagName: 'button', path: 'button' },
          data: {},
        },
        {
          id: 'm1',
          timestamp: '2026-01-01T00:00:00.100Z',
          type: 'dom.added',
          target: { selector: '.item', tagName: 'div', path: 'div' },
          data: { subtree: { kind: 'element' } },
        },
        {
          id: 'm2',
          timestamp: '2026-01-01T00:00:00.120Z',
          type: 'dom.text',
          target: { selector: '#count', tagName: 'span', path: 'span' },
          data: { oldText: '2', newText: '3' },
        },
        {
          id: 'm3',
          timestamp: '2026-01-01T00:00:05.000Z',
          type: 'dom.text',
          target: { selector: '#noise', tagName: 'span', path: 'span' },
          data: { oldText: 'x', newText: 'y' },
        },
      ],
    };

    const transactions = correlateRecording(recording, { correlationWindowMs: 500 });
    expect(transactions).toHaveLength(1);
    expect(transactions[0].mutations).toHaveLength(2);
    expect(buildSemanticDiff(transactions[0]).some((change) => change.kind === 'text')).toBe(true);
  });

  it('redacts a password value attribute change in mutation events', () => {
    const dom = new JSDOM(`<input type="password" id="pw" value="secret">`);
    const input = dom.window.document.querySelector('#pw')!;
    const events = describeMutationRecord(
      {
        type: 'attributes',
        target: input,
        attributeName: 'value',
        oldValue: 'old-secret',
      } as unknown as MutationRecord,
      { redactPasswords: true },
    );
    expect(events).toHaveLength(1);
    expect(events[0].data.oldValue).toBe('[redacted]');
    expect(events[0].data.newValue).toBe('[redacted]');
  });

  it('redacts the value attribute in describeElement output for password fields', () => {
    const dom = new JSDOM(`<input type="password" value="hunter2">`);
    const input = dom.window.document.querySelector('input')!;
    const target = describeElement(input, { redactPasswords: true });
    expect(target.attributes?.value).toBe('[redacted]');
  });

  it('captures characterData mutations on comment nodes, not just text nodes', () => {
    const dom = new JSDOM(`<div id="root"><!--placeholder--></div>`);
    const comment = dom.window.document.querySelector('#root')!.firstChild!;
    const events = describeMutationRecord(
      {
        type: 'characterData',
        target: comment,
        oldValue: 'placeholder',
      } as unknown as MutationRecord,
      {},
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('dom.text');
  });

  it('reflects live typed values in the html snapshot and always redacts passwords', () => {
    const dom = new JSDOM(`
      <input id="name" type="text" />
      <input id="pw" type="password" />
      <textarea id="notes"></textarea>
    `);
    const { document } = dom.window;
    (document.querySelector('#name') as HTMLInputElement).value = 'Jane Doe';
    (document.querySelector('#pw') as HTMLInputElement).value = 'hunter2';
    (document.querySelector('#notes') as HTMLTextAreaElement).value = 'secret notes';

    const snapshot = captureRecordingSnapshot(document, { redactInputValues: false });
    expect(snapshot.html).toContain('Jane Doe');
    expect(snapshot.html).toContain('secret notes');
    expect(snapshot.html).not.toContain('hunter2');
    expect(snapshot.html).toContain('[redacted]');
  });

  it('serializes and deserializes deterministically', () => {
    const recording: Recording = {
      id: 'x',
      version: '1.0.0',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:01.000Z',
      url: 'https://example.com',
      title: 'Example',
      userAgent: 'test',
      initialSnapshot: captureRecordingSnapshot(new JSDOM('<p>Hello</p>').window.document, {}),
      events: [],
    };
    const serialized = serializeRecording(recording);
    expect(serialized).toContain('"id": "x"');
    expect(serialized.indexOf('"endedAt"')).toBeLessThan(serialized.indexOf('"initialSnapshot"'));
  });
});

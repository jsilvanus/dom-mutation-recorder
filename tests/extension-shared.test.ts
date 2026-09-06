import { describe, expect, it } from 'vitest';
// apps/extension is plain JS (browser-injected, not part of the typechecked build).
// @ts-expect-error no type declarations for this plain-JS module
import { buildAiDropText, correlateRecording, DEFAULT_RECORDING_CONFIG } from '../apps/extension/shared.js';

function baseRecording() {
  return {
    id: 'rec-1',
    version: '1.0.0',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:01.000Z',
    url: 'https://example.com',
    title: 'Example',
    scopeSelector: null,
    userAgent: 'test',
    initialSnapshot: { url: 'https://example.com', title: 'Example', html: '<html>initial</html>' },
    finalSnapshot: { url: 'https://example.com', title: 'Example', html: '<html>final</html>' },
    events: [
      {
        id: 'a1',
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'user.click',
        target: { selector: 'button', name: 'Add', tagName: 'button' },
        data: {},
      },
      {
        id: 'm1',
        timestamp: '2026-01-01T00:00:00.100Z',
        type: 'dom.text',
        target: { selector: '#count', tagName: 'span' },
        data: { oldText: '2', newText: '3' },
      },
      {
        id: 'm2',
        timestamp: '2026-01-01T00:00:05.000Z',
        type: 'dom.text',
        target: { selector: '#noise', tagName: 'span' },
        data: { oldText: 'x', newText: 'y' },
      },
    ],
  };
}

describe('extension shared: correlateRecording', () => {
  it('attributes mutations to the nearest preceding action within the window', () => {
    const transactions = correlateRecording(baseRecording(), 500);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].mutations).toHaveLength(1);
    expect(transactions[0].mutations[0].id).toBe('m1');
  });

  it('builds a semantic change summary with before/after for text mutations', () => {
    const transactions = correlateRecording(baseRecording(), 500);
    const [change] = transactions[0].semanticChanges;
    expect(change.kind).toBe('text');
    expect(change.summary).toContain('text changed');
    expect(change.before).toBe('2');
    expect(change.after).toBe('3');
  });

  it('defaults the correlation window to DEFAULT_RECORDING_CONFIG.correlationWindowMs', () => {
    const transactions = correlateRecording(baseRecording());
    // default window is 750ms, so only the near mutation (m1, +100ms) should attach
    expect(transactions[0].mutations.map((m: { id: string }) => m.id)).toEqual(['m1']);
    expect(DEFAULT_RECORDING_CONFIG.correlationWindowMs).toBe(750);
  });
});

describe('extension shared: buildAiDropText', () => {
  it('renders page metadata, actions, and initial/final state', () => {
    const text = buildAiDropText(baseRecording());
    expect(text).toContain('URL: https://example.com');
    expect(text).toContain('Title: Example');
    expect(text).toContain('Scope: entire page');
    expect(text).toContain('INITIAL STATE');
    expect(text).toContain('<html>initial</html>');
    expect(text).toContain('Action 1: user.click');
    expect(text).toContain('#count text changed');
    expect(text).toContain('FINAL STATE');
    expect(text).toContain('<html>final</html>');
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// apps/extension is plain JS (browser-injected, not part of the typechecked build); see the
// note above browserRecorderBootstrap in shared.js for why it can't share core's .ts helpers.
// @ts-expect-error no type declarations for this plain-JS module
import { browserRecorderBootstrap } from '../apps/extension/shared.js';

describe('extension recorder bootstrap', () => {
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = '<input id="name" type="text" />';
    sendMessage = vi.fn();
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage },
    };
  });

  afterEach(() => {
    (window as unknown as { __domRecorderStop?: () => void }).__domRecorderStop?.();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it('captures the correct "before" value on the very first keystroke', () => {
    browserRecorderBootstrap({ tabId: 1, config: { redactInputValues: false } });
    const input = document.querySelector('#name') as HTMLInputElement;

    input.dispatchEvent(new Event('focus'));
    input.value = 'a';
    input.dispatchEvent(new Event('input'));

    const calls = sendMessage.mock.calls as Array<[{ payload: Record<string, unknown> }]>;
    const inputEvent = calls
      .map(([message]) => message.payload)
      .find((payload) => payload?.type === 'user.input');

    expect(inputEvent).toBeDefined();
    expect((inputEvent!.data as Record<string, unknown>).before).toBe('');
    expect((inputEvent!.data as Record<string, unknown>).after).toBe('a');
  });
});

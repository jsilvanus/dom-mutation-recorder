// @vitest-environment jsdom
//
// Smoke test for the esbuild-bundled browser-bootstrap.ts (see
// scripts/build-browser-bootstrap.mjs). Playwright and the Chrome extension inject this
// bundle as a plain script (page.addInitScript/evaluate, chrome.scripting.executeScript
// files), not as an imported module, so this test executes it the same way — via
// node:vm's runInThisContext, which (like a real <script> tag) makes the bundle's top-level
// `var DomRecorderBootstrap` a real global instead of a module-scoped binding.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInThisContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bundlePath = resolve(process.cwd(), 'packages/core/dist/browser-bootstrap.bundle.js');
const bundleSource = readFileSync(bundlePath, 'utf8');

type Emitted = Record<string, unknown>;

declare global {
  var DomRecorderBootstrap: { browserRecorderBootstrap: (options: unknown) => void } | undefined;
}

describe('browser-bootstrap bundle', () => {
  let events: Emitted[];

  beforeEach(() => {
    document.body.innerHTML = '<button id="save">Save</button><input id="pw" type="password" />';
    events = [];
    (window as unknown as Record<string, unknown>).__testChannel = (payload: Emitted) => events.push(payload);
  });

  afterEach(() => {
    (window as unknown as { __domRecorderStop?: () => void }).__domRecorderStop?.();
    delete (window as unknown as Record<string, unknown>).__testChannel;
    globalThis.DomRecorderBootstrap = undefined;
    vi.useRealTimers();
    window.history.replaceState(null, '', '/');
  });

  function install(config: Record<string, unknown> = {}) {
    runInThisContext(bundleSource, { filename: 'browser-bootstrap.bundle.js' });
    globalThis.DomRecorderBootstrap!.browserRecorderBootstrap({ channel: '__testChannel', config });
    events.length = 0; // drop the initial snapshot emitted synchronously on install
  }

  it('installs a working recorder that captures clicks, mutations, and redacts passwords', async () => {
    runInThisContext(bundleSource, { filename: 'browser-bootstrap.bundle.js' });
    expect(typeof globalThis.DomRecorderBootstrap?.browserRecorderBootstrap).toBe('function');

    globalThis.DomRecorderBootstrap!.browserRecorderBootstrap({
      channel: '__testChannel',
      config: { redactPasswords: true },
    });

    // An initial snapshot is emitted synchronously on install.
    expect(events.some((event) => 'snapshot' in event)).toBe(true);

    document.querySelector('#save')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const clickEvent = events.find((event) => event.type === 'user.click') as
      | { target: { selector: string } }
      | undefined;
    expect(clickEvent?.target.selector).toBe('#save');

    document.querySelector('#pw')!.setAttribute('value', 'hunter2');
    await new Promise<void>((resolve) => queueMicrotask(resolve)); // MutationObserver callbacks are async

    const attributeEvent = events.find((event) => event.type === 'dom.attributes') as
      | { data: { attribute: string; newValue: string } }
      | undefined;
    expect(attributeEvent?.data.attribute).toBe('value');
    expect(attributeEvent?.data.newValue).toBe('[redacted]');
  });

  it('captures the correct "before" value on a field\'s very first keystroke', () => {
    document.body.innerHTML = '<input id="name" type="text" />';
    runInThisContext(bundleSource, { filename: 'browser-bootstrap.bundle.js' });

    globalThis.DomRecorderBootstrap!.browserRecorderBootstrap({
      channel: '__testChannel',
      config: { redactInputValues: false },
    });

    const input = document.querySelector('#name') as HTMLInputElement;
    input.dispatchEvent(new Event('focus'));
    input.value = 'a';
    input.dispatchEvent(new Event('input'));

    const inputEvent = events.find((event) => event.type === 'user.input') as
      | { data: { before: string; after: string } }
      | undefined;
    expect(inputEvent?.data.before).toBe('');
    expect(inputEvent?.data.after).toBe('a');
  });

  it('captures pointer, mouse, keyboard, and form events beyond click/input', () => {
    document.body.innerHTML = '<form id="f"><input id="name" /><button id="go">Go</button></form>';
    install({ captureActionSnapshots: false });

    const button = document.querySelector('#go')!;
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    const input = document.querySelector('#name')!;
    input.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: 'a' }));
    const form = document.querySelector('#f')!;
    form.addEventListener('submit', (event) => event.preventDefault());
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('reset', { bubbles: true, cancelable: true }));

    const types = events.map((event) => event.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'user.pointerdown',
        'user.pointerup',
        'user.mousedown',
        'user.mouseup',
        'user.contextmenu',
        'user.keypress',
        'user.submit',
        'user.reset',
      ]),
    );
  });

  it('debounces rapid scroll and resize into a single settled action', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="box"></div>';
    install({ captureActionSnapshots: false });

    const box = document.querySelector('#box')!;
    for (let i = 0; i < 5; i += 1) {
      box.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(50);
    }
    expect(events.filter((event) => event.type === 'user.scroll')).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(events.filter((event) => event.type === 'user.scroll')).toHaveLength(1);

    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(200);
    expect(events.filter((event) => event.type === 'user.resize')).toHaveLength(1);
  });

  it('captures window-level popstate and hashchange events', () => {
    install({ captureActionSnapshots: false });

    window.dispatchEvent(new PopStateEvent('popstate', { state: { page: 2 } }));
    window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: 'http://x/#a', newURL: 'http://x/#b' }));

    const pop = events.find((event) => event.type === 'user.popstate') as { data: { state: unknown } } | undefined;
    expect(pop?.data.state).toEqual({ page: 2 });
    const hash = events.find((event) => event.type === 'user.hashchange') as
      | { data: { oldURL: string; newURL: string } }
      | undefined;
    expect(hash?.data.newURL).toBe('http://x/#b');
  });

  it('instruments history.pushState/replaceState and restores them on stop', () => {
    install({ captureActionSnapshots: false });
    const patchedPushState = history.pushState;

    history.pushState({ step: 1 }, '', '#step-1');
    const pushEvent = events.find((event) => event.type === 'history.pushState') as
      | { data: { state: unknown; url: string } }
      | undefined;
    expect(pushEvent?.data.state).toEqual({ step: 1 });

    history.replaceState({ step: 2 }, '', '#step-2');
    expect(events.some((event) => event.type === 'history.replaceState')).toBe(true);

    (window as unknown as { __domRecorderStop?: () => void }).__domRecorderStop?.();
    expect(history.pushState).not.toBe(patchedPushState);

    events.length = 0;
    history.pushState({ step: 3 }, '', '#step-3');
    expect(events.some((event) => event.type === 'history.pushState')).toBe(false);
  });

  it('brackets actions with inline snapshots and settles once mutation activity quiets down', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<button id="go">Go</button><div id="out"></div>';
    install({ idleSnapshotDelayMs: 50 });

    document.querySelector('#go')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(events.map((event) => event.type)).toEqual(['user.click', 'snapshot']);
    expect((events[1] as { data: { reason: string } }).data.reason).toBe('action');

    document.querySelector('#out')!.textContent = 'done';
    await new Promise<void>((resolveMicrotask) => queueMicrotask(resolveMicrotask)); // flush the MutationObserver callback
    expect(events.some((event) => event.type === 'dom.added')).toBe(true);
    expect(events.some((event) => event.type === 'snapshot' && (event as { data: { reason: string } }).data.reason === 'idle')).toBe(
      false,
    );

    vi.advanceTimersByTime(50);
    const idleSnapshots = events.filter(
      (event) => event.type === 'snapshot' && (event as { data: { reason: string } }).data.reason === 'idle',
    );
    expect(idleSnapshots).toHaveLength(1);
  });
});

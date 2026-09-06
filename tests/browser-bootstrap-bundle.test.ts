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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
  });

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
});

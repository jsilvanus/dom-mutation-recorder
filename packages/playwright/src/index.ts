import type { Frame, Page } from 'playwright';
import type { Recording, RecordingConfig, RecordingEvent, RecordingSnapshot } from '../../core/src/model.js';
import { correlateRecording } from '../../core/src/correlation.js';
import { createId, isoNow, RECORDING_SCHEMA_VERSION } from '../../core/src/model.js';
import { serializeRecording } from '../../core/src/serialization.js';
import { buildBrowserRecorderInitScript } from './browser-init.js';
import { exportRecordingArtifacts } from '../../exporter/src/index.js';

type RecorderState = {
  id: string;
  startedAt: string;
  events: RecordingEvent[];
  initialSnapshot: RecordingSnapshot | null;
  finalSnapshot: RecordingSnapshot | null;
  finalRecording?: Recording;
};

type SnapshotApi = {
  __domRecorderStop?: () => void;
  __domRecorderSnapshot?: () => RecordingSnapshot | null;
};

export class DomRecorder {
  private navigationListener?: (frame: Frame) => Promise<void>;

  private constructor(private readonly page: Page, private readonly config: RecordingConfig, private readonly state: RecorderState) {}

  static async attach(page: Page, config: RecordingConfig = {}): Promise<DomRecorder> {
    const channel = `__domRecorderEmit_${createId('channel')}`;
    const state: RecorderState = {
      id: createId(),
      startedAt: isoNow(),
      events: [],
      initialSnapshot: null,
      finalSnapshot: null,
    };

    await page.exposeFunction(channel, (payload: unknown) => {
      const event = payload as
        | RecordingEvent
        | { snapshot?: RecordingSnapshot | null; data?: Record<string, unknown> };
      if (event && typeof event === 'object' && 'snapshot' in event && event.snapshot) {
        if (!state.initialSnapshot) state.initialSnapshot = event.snapshot;
        state.finalSnapshot = event.snapshot;
        return;
      }
      if (event && typeof event === 'object' && typeof (event as RecordingEvent).type === 'string') {
        state.events.push(event as RecordingEvent);
      }
    });

    const initScript = buildBrowserRecorderInitScript({ channel, config });
    await page.addInitScript({ content: initScript });
    if (page.url() !== 'about:blank') {
      await page.evaluate(initScript);
      await hydrateSnapshot(page, state);
    }

    const recorder = new DomRecorder(page, config, state);
    recorder.navigationListener = async (frame) => {
      if (frame !== page.mainFrame()) return;
      await hydrateSnapshot(page, state);
    };
    page.on('framenavigated', recorder.navigationListener);
    return recorder;
  }

  async stop(): Promise<Recording> {
    if (this.state.finalRecording) {
      return this.state.finalRecording;
    }
    await this.page.evaluate(() => {
      const api = window as unknown as SnapshotApi;
      api.__domRecorderStop?.();
      return null;
    }).catch(() => null);
    if (this.navigationListener) {
      this.page.off('framenavigated', this.navigationListener);
    }
    const recording = { ...(await this.snapshot()), endedAt: isoNow() };
    this.state.finalRecording = recording;
    return recording;
  }

  async export(directory: string, mode: 'concise' | 'developer' = 'concise'): Promise<void> {
    const recording = await this.stop();
    await exportRecordingArtifacts(recording, directory, {
      mode,
      storeOldResults: this.config.storeOldResults,
      correlationWindowMs: this.config.correlationWindowMs,
    });
  }

  serialize(): Promise<string> {
    return this.stop().then((recording) => serializeRecording(recording));
  }

  private async snapshot(): Promise<Omit<Recording, 'endedAt'>> {
    await hydrateSnapshot(this.page, this.state);
    const initialSnapshot = this.state.initialSnapshot ?? (await captureSnapshotFallback(this.page, this.config));
    const finalSnapshot = this.state.finalSnapshot ?? initialSnapshot;
    const recording = {
      id: this.state.id,
      version: RECORDING_SCHEMA_VERSION,
      startedAt: this.state.startedAt,
      url: finalSnapshot.url,
      title: finalSnapshot.title,
      scopeSelector: finalSnapshot.scopeSelector ?? initialSnapshot.scopeSelector ?? this.config.scopeSelector ?? null,
      viewport: this.page.viewportSize() || undefined,
      userAgent: await this.page.evaluate(() => navigator.userAgent).catch(() => ''),
      initialSnapshot,
      finalSnapshot,
      events: [...this.state.events],
    };
    return {
      ...recording,
      transactions: correlateRecording({ ...recording, endedAt: null }, this.config),
    };
  }
}

async function hydrateSnapshot(
  page: Page,
  state: RecorderState,
): Promise<void> {
  const snapshot = await page.evaluate(() => {
    const api = window as unknown as SnapshotApi;
    return api.__domRecorderSnapshot?.() || null;
  }).catch(() => null);
  if (!snapshot) return;
  if (!state.initialSnapshot) state.initialSnapshot = snapshot;
  state.finalSnapshot = snapshot;
}

async function captureSnapshotFallback(page: Page, config: RecordingConfig): Promise<RecordingSnapshot> {
  return page.evaluate((options) => {
    const redactUrls = options.redactUrls;
    const scopeSelector = options.scopeSelector || null;
    const scope = scopeSelector
      ? document.querySelector(scopeSelector)
      : null;
    const url = new URL(location.href);
    if (redactUrls) {
      url.search = '';
      url.hash = '';
    }
    const root = scope || document.documentElement;
    return {
      url: url.toString(),
      title: document.title,
      html: `<!doctype html>\n${root.outerHTML}`,
      scopeSelector: scope ? scopeSelector : null,
      document: {
        kind: scope ? 'element' : 'document',
        children: [],
        path: scope ? scopeSelector || root.tagName.toLowerCase() : 'html',
        selector: scope ? scopeSelector || undefined : undefined,
        tagName: scope ? root.tagName.toLowerCase() : undefined,
      },
    };
  }, config);
}

import type { Frame, Page } from 'playwright';
import type { Recording, RecordingConfig, RecordingEvent, RecordingSnapshot } from '../../core/src/model.js';
import { correlateRecording } from '../../core/src/correlation.js';
import { createId, isoNow, RECORDING_SCHEMA_VERSION } from '../../core/src/model.js';
import { serializeRecording } from '../../core/src/serialization.js';
import { browserRecorderBootstrap } from './browser-init.js';
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
        else state.finalSnapshot = event.snapshot;
        return;
      }
      if (event && typeof event === 'object' && typeof (event as RecordingEvent).type === 'string') {
        state.events.push(event as RecordingEvent);
      }
    });

    await page.addInitScript(browserRecorderBootstrap, { channel, config });
    if (page.url() !== 'about:blank') {
      await page.evaluate(browserRecorderBootstrap, { channel, config });
      await hydrateSnapshot(page, state, config);
    }

    const recorder = new DomRecorder(page, config, state);
    recorder.navigationListener = async (frame) => {
      if (frame !== page.mainFrame()) return;
      await hydrateSnapshot(page, state, config);
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
    const recording = await this.snapshot();
    const finalized = { ...recording, endedAt: isoNow() };
    this.state.finalRecording = finalized;
    return finalized;
  }

  async export(directory: string, mode: 'concise' | 'developer' = 'concise'): Promise<void> {
    const recording = await this.stop();
    await exportRecordingArtifacts(recording, directory, { mode });
  }

  toJSON(): Promise<string> {
    return this.snapshot().then((recording) => serializeRecording(recording));
  }

  private async snapshot(): Promise<Recording> {
    await hydrateSnapshot(this.page, this.state, this.config);
    const initialSnapshot = this.state.initialSnapshot ?? (await captureSnapshotFallback(this.page, this.config));
    const finalSnapshot = this.state.finalSnapshot ?? initialSnapshot;
    const recording: Recording = {
      id: this.state.id,
      version: RECORDING_SCHEMA_VERSION,
      startedAt: this.state.startedAt,
      endedAt: null,
      url: finalSnapshot.url,
      title: finalSnapshot.title,
      viewport: this.page.viewportSize() || undefined,
      userAgent: await this.page.evaluate(() => navigator.userAgent).catch(() => ''),
      initialSnapshot,
      finalSnapshot,
      events: [...this.state.events],
    };
    recording.transactions = correlateRecording(recording, this.config);
    return recording;
  }
}

async function hydrateSnapshot(
  page: Page,
  state: RecorderState,
  config: RecordingConfig,
): Promise<void> {
  const snapshot = await page.evaluate(() => {
    const api = window as unknown as SnapshotApi;
    return api.__domRecorderSnapshot?.() || null;
  }).catch(() => null);
  if (!snapshot) return;
  if (!state.initialSnapshot) state.initialSnapshot = snapshot;
  else state.finalSnapshot = snapshot;
}

async function captureSnapshotFallback(page: Page, config: RecordingConfig): Promise<RecordingSnapshot> {
  return page.evaluate((options) => {
    const redactUrls = options.redactUrls;
    const url = new URL(location.href);
    if (redactUrls) {
      url.search = '';
      url.hash = '';
    }
    return {
      url: url.toString(),
      title: document.title,
      html: `<!doctype html>\n${document.documentElement.outerHTML}`,
      document: { kind: 'document', children: [], path: 'html' },
    };
  }, config);
}

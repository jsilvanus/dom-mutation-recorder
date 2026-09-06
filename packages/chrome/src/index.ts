import type { RecordingConfig } from '../../core/src/model.js';
import { browserRecorderBootstrap } from '../../playwright/src/browser-init.js';

export type ChromeRecorderOptions = {
  channel: string;
  config?: RecordingConfig;
};

export function installChromeRecorder(options: ChromeRecorderOptions): void {
  browserRecorderBootstrap(options);
}

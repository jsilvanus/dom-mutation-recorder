import type { RecordingConfig } from '../../core/src/model.js';
import { browserRecorderBootstrap } from '../../core/src/browser-bootstrap.js';

export type ChromeRecorderOptions = {
  channel: string;
  config?: RecordingConfig;
};

export function installChromeRecorder(options: ChromeRecorderOptions): void {
  browserRecorderBootstrap(options);
}

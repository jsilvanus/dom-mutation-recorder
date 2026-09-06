import type { RecordingConfig } from './model.js';

export function shouldRedactFieldValue(tagName: string, type: string, config: RecordingConfig): boolean {
  if (tagName === 'textarea') return config.redactInputValues !== false;
  if (tagName !== 'input') return false;
  if (type === 'password') {
    return config.redactPasswords !== false || config.redactInputValues !== false;
  }
  const textLikeInputTypes = new Set(['text', 'search', 'email', 'url', 'tel', 'number']);
  return config.redactInputValues !== false && textLikeInputTypes.has(type);
}

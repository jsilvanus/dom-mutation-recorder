import type { RecordingConfig } from './model.js';

export function shouldRedactFieldValue(tagName: string, type: string, config: RecordingConfig): boolean {
  if (tagName === 'textarea') return config.redactInputValues !== false;
  if (tagName !== 'input') return false;
  if (type === 'password') {
    return config.redactPasswords !== false || config.redactInputValues !== false;
  }
  const nonRedactableInputTypes = new Set(['checkbox', 'radio', 'submit', 'button', 'reset', 'image', 'range', 'color', 'file']);
  return config.redactInputValues !== false && !nonRedactableInputTypes.has(type);
}

export function shouldRedactElementValue(element: Element, config: RecordingConfig): boolean {
  const tag = element.tagName.toLowerCase();
  const type = element.getAttribute('type')?.toLowerCase() || 'text';
  return shouldRedactFieldValue(tag, type, config);
}

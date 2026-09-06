export const RECORDING_SCHEMA_VERSION = '1.0.0';

export type RecordingTarget = {
  selector?: string;
  selectors?: SelectorCandidate[];
  role?: string | null;
  name?: string | null;
  tagName?: string | null;
  id?: string | null;
  classes?: string[];
  path?: string | null;
  text?: string | null;
  attributes?: Record<string, string>;
};

export type SelectorCandidate = {
  type:
    | 'stable-id'
    | 'data-testid'
    | 'data-attribute'
    | 'aria'
    | 'role'
    | 'class'
    | 'attribute'
    | 'css-path'
    | 'xpath';
  selector: string;
  confidence: number;
};

export type SnapshotConfig = {
  redactInputValues?: boolean;
  redactPasswords?: boolean;
  maxTextLength?: number;
  maxSubtreeSize?: number;
  redactUrls?: boolean;
  scopeSelector?: string | null;
};

export type RecordingConfig = SnapshotConfig & {
  correlationWindowMs?: number;
  storeOldResults?: boolean;
};

export type DomNodeSnapshot = {
  kind: 'document' | 'element' | 'text';
  tagName?: string;
  text?: string;
  attributes?: Record<string, string>;
  children?: DomNodeSnapshot[];
  selector?: string;
  path?: string;
  redacted?: boolean;
};

export type RecordingSnapshot = {
  url: string;
  title: string;
  html: string;
  document: DomNodeSnapshot;
  scopeSelector?: string | null;
};

export type RecordingEventBase = {
  id: string;
  timestamp: string;
  type: string;
  target?: RecordingTarget;
  data: Record<string, unknown>;
};

export type UserEventType =
  | 'user.click'
  | 'user.dblclick'
  | 'user.input'
  | 'user.change'
  | 'user.keydown'
  | 'user.keyup'
  | 'user.focus'
  | 'user.blur';

export type DomEventType =
  | 'dom.added'
  | 'dom.removed'
  | 'dom.attributes'
  | 'dom.text';

export type NavigationEventType = 'navigation';

export type RecordingEvent =
  | (RecordingEventBase & { type: UserEventType; data: Record<string, unknown> })
  | (RecordingEventBase & { type: DomEventType; data: Record<string, unknown> })
  | (RecordingEventBase & { type: NavigationEventType; data: Record<string, unknown> })
  | (RecordingEventBase & { type: string; data: Record<string, unknown> });

export type ActionTransaction = {
  id: string;
  action: RecordingEvent;
  mutations: RecordingEvent[];
  semanticChanges: SemanticChange[];
};

export type SemanticChange = {
  kind: 'text' | 'attribute' | 'node-added' | 'node-removed' | 'navigation' | 'state';
  summary: string;
  target?: RecordingTarget;
  before?: string | number | boolean | null;
  after?: string | number | boolean | null;
  selector?: string;
};

export type Recording = {
  id: string;
  version: string;
  startedAt: string;
  endedAt: string | null;
  url: string;
  title: string;
  scopeSelector?: string | null;
  viewport?: { width: number; height: number };
  userAgent: string;
  initialSnapshot: RecordingSnapshot;
  finalSnapshot?: RecordingSnapshot;
  events: RecordingEvent[];
  transactions?: ActionTransaction[];
};

export function createId(prefix = 'rec'): string {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `${prefix}_${suffix}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

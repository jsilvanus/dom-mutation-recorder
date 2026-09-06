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
  // When true (the default), the recorder emits an inline `snapshot` event right after every
  // action and again once a burst of DOM mutations goes quiet, so a recording's raw event
  // stream can be replayed as state-over-time rather than just a mutation tally.
  captureActionSnapshots?: boolean;
  // How long DOM mutation activity must be quiet before an idle "settled" snapshot fires.
  idleSnapshotDelayMs?: number;
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
  | 'user.pointerdown'
  | 'user.pointerup'
  | 'user.pointerover'
  | 'user.pointerout'
  | 'user.pointerenter'
  | 'user.pointerleave'
  | 'user.mousedown'
  | 'user.mouseup'
  | 'user.mouseover'
  | 'user.mouseout'
  | 'user.contextmenu'
  | 'user.input'
  | 'user.change'
  | 'user.select'
  | 'user.keydown'
  | 'user.keyup'
  | 'user.keypress'
  | 'user.focus'
  | 'user.blur'
  | 'user.submit'
  | 'user.reset'
  | 'user.scroll'
  | 'user.resize'
  | 'user.popstate'
  | 'user.hashchange';

export type DomEventType =
  | 'dom.added'
  | 'dom.removed'
  | 'dom.attributes'
  | 'dom.text';

export type NavigationEventType = 'navigation';

// history.pushState/replaceState don't dispatch any native event, so the recorder monkey-
// patches them to synthesize one — the only way to see SPA route/state transitions that don't
// happen to touch the DOM.
export type HistoryEventType = 'history.pushState' | 'history.replaceState';

// An inline DOM snapshot taken mid-recording (see RecordingConfig.captureActionSnapshots),
// distinct from Recording.initialSnapshot/finalSnapshot which only bookend the whole session.
export type SnapshotEventType = 'snapshot';

export type RecordingEvent =
  | (RecordingEventBase & { type: UserEventType; data: Record<string, unknown> })
  | (RecordingEventBase & { type: DomEventType; data: Record<string, unknown> })
  | (RecordingEventBase & { type: HistoryEventType; data: Record<string, unknown> })
  | (RecordingEventBase & { type: SnapshotEventType; data: { snapshot: RecordingSnapshot; reason: 'action' | 'idle' } })
  | (RecordingEventBase & { type: NavigationEventType; data: Record<string, unknown> })
  | (RecordingEventBase & { type: string; data: Record<string, unknown> });

// Anchors for ActionTransaction correlation: real user input plus the synthetic history
// events, but not dom.* mutations, snapshots, or the devtools-only 'navigation' marker.
export function isActionEventType(type: string): boolean {
  return type.startsWith('user.') || type.startsWith('history.');
}

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

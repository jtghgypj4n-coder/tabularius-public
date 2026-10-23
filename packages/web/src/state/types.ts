// Server-authoritative: the account and its privileges, `$$` variables and globals, record locks and who is viewing, saved finds and sorts, record data and modification counts, the paused script run and what it waits for, the window list as the engine last reported it. Client-authoritative: the window list and its order, each window's found-set definition (`source`), `index`, mode, view, find requests, panels, popover and scroll, the in-progress edit, the active object. Derived or cache: `records`, `formulas`, `groups`, the URL, sessionStorage keys and BroadcastChannel messages.
// Read from the code on 2026-10-22; nothing uses this file yet.

import type { DataRecord, FindRequest, FormulaState, GroupRun, LayoutMeta, PortalRow, RowState, ScriptRun, SortSpec, Value, WindowStyle } from '../types.ts';
import type { SavedFind } from '../finds.ts';

/** Account-level state held across open files; the current app keeps several of these values on separate objects. */
export interface AppSession {
  db: string;
  account: string;
  canDesign: boolean;
  canExplainScripts: boolean;
  prefs: { finds: SavedFind[]; recent: SavedFind[]; sorts: SortSpec[][]; recentRecords: { layout: string; recordId: string }[] };
  offline: { waiting: number; syncing: boolean; copyOnly: boolean };
}

/** One open file; `db` currently comes from its API and the other collections are spread over Session and live-state fields. */
export interface FileSession {
  db: string;
  windows: WindowState[];
  frontId: string;
  siblings: Map<string, { title: string }>;
  lockedBy: Map<string, string>;
  viewers: Map<string, string[]>;
}

/** One represented app window; current browser Session snapshots omit edit and script state and retain layout/render details separately. */
export interface WindowState {
  id: string;
  name: string;
  style: WindowStyle;
  mode: 'browse' | 'find' | 'preview' | 'layout';
  layoutName?: string;
  foundSet: FoundSetState;
  find: { requests: FindRequest[]; current: number; last?: FindRequest[] };
  view: ViewMode;
  active: ActiveState;
  edit?: RecordEditState;
  script: ScriptRunState;
  chrome: { statusToolbarHidden: boolean; toolbarLocked: boolean; zoom?: number; zoomLocked: boolean; menuSetId?: number };
}

/** A window's found-set definition and derived records; the live Session currently stores these as separate fields. */
export interface FoundSetState {
  file: string;
  table: string;
  source: { query?: FindRequest[]; ids?: number[]; sort?: SortSpec[] };
  foundCount: number;
  totalCount: number;
  index: number;
  records: Map<number, DataRecord>;
  formulas: Map<string, FormulaState>;
  groups?: GroupRun[][] | null;
  stale: { ids: Set<string>; pages: Set<number>; reload: boolean };
}

/** The in-progress record edit; current code tracks unsaved fields, conflicts and refused locks in separate collections. */
export interface RecordEditState {
  recordId: string;
  layout: string;
  original: Record<string, Value>;
  created?: boolean;
  unsaved: Map<string, string>;
  conflicts: Map<string, { theirs: string; by?: string }>;
  lockRefused: boolean;
}

/** A window's presentation state; its panels and scroll are currently stored separately and popover state has a DOM-backed form. */
export interface ViewMode {
  kind: 'form' | 'list' | 'table';
  panels: Map<number, number>;
  popover?: number;
  scroll: number;
  preview?: { page: number; pages: number };
}

/** The active layout target; the current app keeps these values in focus and portal event state. */
export interface ActiveState {
  objectId?: number;
  fieldKey?: string;
  portal?: { name: string; rowId?: string };
  selection?: [number, number] | 'all';
}

/** State for a script run; the current browser receives a ScriptRun result and keeps pauses in a separate callback. */
export interface ScriptRunState {
  running: boolean;
  runId?: string;
  frozen: boolean;
  timer?: { id: string; seconds: number };
}

// Keep imported domain shapes visible to this type-only module without creating runtime dependencies.
type _StateModelReferences = LayoutMeta | PortalRow | RowState | ScriptRun;

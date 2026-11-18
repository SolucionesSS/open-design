// Bounded LRU snapshot of resolved project-card cover decisions.
//
// Resolving one card's cover costs a `/files` read plus a HEAD probe (or a
// deck document fetch). Returning to a home surface used to re-run that scan
// for every card in the grid even though nothing changed
// (evidence/electron-project-waterfall-20260727). This cache remembers the
// last successful decision per (workspace identity, project, version) so a remount
// renders covers immediately and only re-probes what actually changed.
//
// Scope and staleness rules (handoff §4.2):
// - The key carries the complete workspace authority identity, project id and the project's
//   `updatedAt` version; a content update that bumps the project version
//   misses the cache naturally, and covers never leak across workspaces.
// - The stored value carries the preview file identity (name + mtime) inside
//   `ProjectCoverOverride`.
// - `team-project-content-ready` (owner pushed new content) explicitly
//   invalidates the project's entries before the forced re-probe.
// - The map is capped: least-recently-used entries fall out, so this never
//   becomes an unbounded process-global cache.

import type { ProjectCoverOverride } from '../components/project-cover';

const MAX_COVER_SNAPSHOT_ENTRIES = 300;

// Persisted twin of the in-memory map: cover decisions survive reloads, so a
// fresh tab skips the `/files` + HEAD-probe waterfall per card and mounts
// iframes with a known src immediately. Keys already carry the workspace
// identity + project version, so entries cannot leak across workspaces and a
// content update misses naturally. Best-effort: quota/privacy failures fall
// back to memory-only behavior.
const COVER_STORAGE_KEY = 'od.project-covers.v1';
const COVER_KINDS = new Set(['html', 'image', 'video', 'logo']);

function isStorableCoverSnapshot(value: unknown): value is ProjectCoverSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const cover = (value as { cover?: unknown }).cover;
  if (cover === null) return true;
  if (!cover || typeof cover !== 'object' || Array.isArray(cover)) return false;
  const candidate = cover as { kind?: unknown; name?: unknown; mtime?: unknown };
  if (!COVER_KINDS.has(candidate.kind as string)) return false;
  if (typeof candidate.name !== 'string' || candidate.name.length === 0) return false;
  return candidate.mtime === undefined || typeof candidate.mtime === 'number';
}

function readStoredSnapshots(): Record<string, ProjectCoverSnapshot> {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(COVER_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, ProjectCoverSnapshot> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isStorableCoverSnapshot(value)) out[key] = { cover: value.cover };
    }
    return out;
  } catch {
    return {};
  }
}

function writeStoredSnapshots(store: Record<string, ProjectCoverSnapshot>): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(COVER_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota or privacy mode: memory cache keeps working, persistence degrades.
  }
}

interface ProjectCoverSnapshot {
  /** `null` is an authoritative "this project has no cover" decision. */
  cover: ProjectCoverOverride | null;
}

const snapshots = new Map<string, ProjectCoverSnapshot>();

export function projectCoverSnapshotKey(
  workspaceIdentity: string | null | undefined,
  projectId: string,
  version: number,
): string {
  return `${workspaceIdentity ?? 'local'}|${projectId}|${version}`;
}

/** `undefined` means "no snapshot"; a snapshot may hold a `null` cover. */
export function getProjectCoverSnapshot(key: string): ProjectCoverSnapshot | undefined {
  const entry = snapshots.get(key);
  if (entry !== undefined) {
    // LRU touch: re-insert so iteration order tracks recency.
    snapshots.delete(key);
    snapshots.set(key, entry);
    return entry;
  }
  // Read-through from the persisted twin (previous session/tab lifetime).
  const stored = readStoredSnapshots()[key];
  if (!isStorableCoverSnapshot(stored)) return undefined;
  const restored: ProjectCoverSnapshot = { cover: stored.cover };
  snapshots.delete(key);
  snapshots.set(key, restored);
  while (snapshots.size > MAX_COVER_SNAPSHOT_ENTRIES) {
    const oldest = snapshots.keys().next().value;
    if (oldest === undefined) break;
    snapshots.delete(oldest);
  }
  return restored;
}

export function setProjectCoverSnapshot(
  key: string,
  cover: ProjectCoverOverride | null,
): void {
  snapshots.delete(key);
  snapshots.set(key, { cover });
  while (snapshots.size > MAX_COVER_SNAPSHOT_ENTRIES) {
    const oldest = snapshots.keys().next().value;
    if (oldest === undefined) break;
    snapshots.delete(oldest);
  }
  // Write-through: persist the bounded map so reloads skip re-probing.
  const store = readStoredSnapshots();
  delete store[key];
  store[key] = { cover };
  const keys = Object.keys(store);
  for (const oldest of keys.slice(0, Math.max(0, keys.length - MAX_COVER_SNAPSHOT_ENTRIES))) {
    delete store[oldest];
  }
  writeStoredSnapshots(store);
}

/**
 * Drop every stored version of one project's cover (all workspaces). Used
 * when authoritative content-changed events arrive so the next request
 * re-probes instead of serving the stale decision.
 */
export function invalidateProjectCoverSnapshots(projectId: string): void {
  for (const key of [...snapshots.keys()]) {
    const parts = key.split('|');
    if (parts[1] === projectId) snapshots.delete(key);
  }
  // Persisted twin: a stale decision must not survive a reload either.
  const store = readStoredSnapshots();
  let changed = false;
  for (const key of Object.keys(store)) {
    if (key.split('|')[1] === projectId) {
      delete store[key];
      changed = true;
    }
  }
  if (changed) writeStoredSnapshots(store);
}

/** Test-only: reset the cache between cases. Also clears the persisted twin so
 *  covers resolved in one test never satisfy the next (same invariant as the
 *  in-memory map; see tests/setup/coalesced-get-reset.ts). */
export function resetProjectCoverSnapshots(): void {
  snapshots.clear();
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(COVER_STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

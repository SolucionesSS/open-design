import {
  workspacePrincipalKey,
  type WorkspaceCollabContext,
} from '@open-design/contracts';

import { workspaceIdentityCacheKey } from '../collab/workspace-identity';
import type { Project } from '../types';

export type ProjectDisplayView = 'all' | 'recent' | 'drafts' | 'team';

export interface ProjectDisplaySnapshotScope {
  accountGeneration: number;
  context: WorkspaceCollabContext | null;
  view: ProjectDisplayView | undefined;
}

export interface ProjectDisplaySnapshot {
  projects: Project[];
  dirty: boolean;
}

interface StoredProjectDisplaySnapshot extends ProjectDisplaySnapshot {
  accountGeneration: number;
  /**
   * WHO this snapshot belongs to — account/workspace/member, not `role`.
   *
   * The KEY (see {@link projectDisplaySnapshotKey}) still folds in the full
   * request identity, because a read and its write always come from the same
   * shell context. Invalidation does not: a share/unshare is issued from the
   * project page, whose context comes from the daemon's scope fast path and
   * therefore always reports the placeholder `role: 'member'`. Matching that
   * against a role-bearing key meant a workspace owner's own share never marked
   * their own home grid dirty, and Back showed the pre-share state. Null when the
   * snapshot has no workspace identity (the local/signed-out bucket); a null
   * principal is never equal to anything, so that bucket stays unreachable from
   * a workspace mutation exactly as it was before.
   */
  workspacePrincipal: string | null;
  view: ProjectDisplayView | undefined;
}

export const MAX_PROJECT_DISPLAY_SNAPSHOTS = 24;

const snapshots = new Map<string, StoredProjectDisplaySnapshot>();

export function projectDisplaySnapshotKey(scope: ProjectDisplaySnapshotScope): string {
  return [
    'project-display',
    scope.accountGeneration,
    workspaceIdentityCacheKey(scope.context),
    scope.context ? scope.view ?? 'recent' : 'local',
  ].join(':');
}

export function readProjectDisplaySnapshot(key: string): ProjectDisplaySnapshot | null {
  const snapshot = snapshots.get(key);
  if (!snapshot) return null;
  // Map insertion order is the LRU order. Touch exact-key hits without ever
  // allowing one account/workspace/member key to answer another.
  snapshots.delete(key);
  snapshots.set(key, snapshot);
  return {
    projects: snapshot.projects,
    dirty: snapshot.dirty,
  };
}

export function writeProjectDisplaySnapshot(
  scope: ProjectDisplaySnapshotScope,
  projects: Project[],
): void {
  const key = projectDisplaySnapshotKey(scope);
  const snapshot: StoredProjectDisplaySnapshot = {
    accountGeneration: scope.accountGeneration,
    workspacePrincipal: workspacePrincipalKey(scope.context),
    view: scope.view,
    projects,
    dirty: false,
  };
  snapshots.delete(key);
  snapshots.set(key, snapshot);
  while (snapshots.size > MAX_PROJECT_DISPLAY_SNAPSHOTS) {
    const oldest = snapshots.keys().next().value as string | undefined;
    if (!oldest) break;
    snapshots.delete(oldest);
  }
}

/**
 * A successful local mutation or a workspace push makes every projection for
 * that exact principal stale. Keep its last-good display value for SWR, but do
 * not touch another account/workspace/member identity.
 */
export function markProjectDisplaySnapshotsDirty(input: {
  context: WorkspaceCollabContext;
  accountGeneration?: number;
}): void {
  const workspacePrincipal = workspacePrincipalKey(input.context);
  if (workspacePrincipal === null) return;
  for (const snapshot of snapshots.values()) {
    if (snapshot.workspacePrincipal !== workspacePrincipal) continue;
    if (
      input.accountGeneration !== undefined
      && snapshot.accountGeneration !== input.accountGeneration
    ) {
      continue;
    }
    snapshot.dirty = true;
  }
}

export function patchProjectDisplaySnapshots(input: {
  context: WorkspaceCollabContext;
  accountGeneration?: number;
  patch: (projects: Project[], view: ProjectDisplayView | undefined) => Project[];
}): void {
  const workspacePrincipal = workspacePrincipalKey(input.context);
  if (workspacePrincipal === null) return;
  for (const snapshot of snapshots.values()) {
    if (snapshot.workspacePrincipal !== workspacePrincipal) continue;
    if (
      input.accountGeneration !== undefined
      && snapshot.accountGeneration !== input.accountGeneration
    ) {
      continue;
    }
    snapshot.projects = input.patch(snapshot.projects, snapshot.view);
    snapshot.dirty = true;
  }
}

export function removeProjectFromDisplaySnapshots(input: {
  context: WorkspaceCollabContext;
  projectId: string;
  accountGeneration?: number;
}): void {
  patchProjectDisplaySnapshots({
    context: input.context,
    accountGeneration: input.accountGeneration,
    patch: (projects) => projects.filter((project) => project.id !== input.projectId),
  });
}

export function resetProjectDisplaySnapshots(): void {
  snapshots.clear();
}

export function projectDisplaySnapshotCount(): number {
  return snapshots.size;
}

// ---------------------------------------------------------------------------
// Cold-boot paint: the in-memory snapshots above are keyed by the resolved
// Workspace identity, which does not exist yet on a fresh boot — so the grid
// opens empty until the (network-backed) context read lands. This persists the
// last rendered list per tab-lineage Workspace/member pair in localStorage so
// boot can paint it instantly while revalidating.
//
// Safety mirrors the sessionStorage selection: reads require the tab's live
// selection to match the stored pair. A new tab has no selection (no paint),
// and sign-out clears the selection (no cross-account leak). Entries are
// best-effort display data, never authorization.
// ---------------------------------------------------------------------------

const LAST_PROJECTS_STORAGE_KEY = 'od.last-projects.v1';
const MAX_LAST_PROJECTS_ENTRIES = 10;
const MAX_LAST_PROJECTS_PER_ENTRY = 200;

interface LastProjectsEntry {
  workspaceId: string;
  workspaceMemberId: string;
  updatedAt: number;
  projects: Project[];
}

function lastProjectsStoreKey(
  selection: { workspaceId: string; workspaceMemberId: string },
  view: string | undefined,
): string {
  return JSON.stringify([selection.workspaceId, selection.workspaceMemberId, view ?? null]);
}

function readLastProjectsStore(): Record<string, LastProjectsEntry> {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LAST_PROJECTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, LastProjectsEntry> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const entry = value as Partial<LastProjectsEntry>;
      if (
        typeof entry.workspaceId !== 'string'
        || typeof entry.workspaceMemberId !== 'string'
        || !Array.isArray(entry.projects)
      ) continue;
      out[key] = {
        workspaceId: entry.workspaceId,
        workspaceMemberId: entry.workspaceMemberId,
        updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : 0,
        projects: entry.projects.filter(
          (project): project is Project =>
            Boolean(project) && typeof project === 'object' && typeof (project as Project).id === 'string',
        ).slice(0, MAX_LAST_PROJECTS_PER_ENTRY),
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writeLastProjectsStore(store: Record<string, LastProjectsEntry>): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    const entries = Object.entries(store).slice(-MAX_LAST_PROJECTS_ENTRIES);
    localStorage.setItem(LAST_PROJECTS_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Quota or privacy mode: instant paint is a progressive enhancement.
  }
}

export function writeLastProjectsSnapshot(
  selection: { workspaceId: string; workspaceMemberId: string },
  view: string | undefined,
  projects: Project[],
): void {
  if (!selection.workspaceId?.trim() || !selection.workspaceMemberId?.trim()) return;
  const store = readLastProjectsStore();
  const key = lastProjectsStoreKey(selection, view);
  delete store[key];
  store[key] = {
    workspaceId: selection.workspaceId,
    workspaceMemberId: selection.workspaceMemberId,
    updatedAt: Date.now(),
    projects: projects.slice(0, MAX_LAST_PROJECTS_PER_ENTRY),
  };
  writeLastProjectsStore(store);
}

export function readLastProjectsSnapshot(
  selection: { workspaceId: string; workspaceMemberId: string } | null | undefined,
  view: string | undefined,
): Project[] | null {
  if (!selection?.workspaceId?.trim() || !selection?.workspaceMemberId?.trim()) return null;
  const entry = readLastProjectsStore()[lastProjectsStoreKey(selection, view)];
  if (!entry) return null;
  return entry.projects;
}

/** Test seam: clear the persisted map between cases. */
export function resetLastProjectsSnapshotForTests(): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(LAST_PROJECTS_STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

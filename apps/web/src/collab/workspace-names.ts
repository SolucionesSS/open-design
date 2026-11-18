// Last-known Workspace display names, persisted across sessions.
//
// The daemon's local/dev authority cannot name a workspace (it only ever sees
// ids), and the directory read that carries names is network-backed and slow
// on cold boot. Without this, first paint labels the workspace with its raw id
// until the directory lands. Remembering the last real name per workspace lets
// the rail show "Soluciones SS" instantly while revalidating.
//
// Only real names are stored: empty strings and id-valued placeholders are
// refused, so a bad read can never poison the cache.

const STORAGE_KEY = 'od.workspace-names.v1';
const MAX_ENTRIES = 50;

type NameMap = Record<string, string>;

function readMap(): NameMap {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: NameMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: NameMap): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const entries = Object.entries(map).slice(-MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Quota or privacy mode: names are a progressive enhancement.
  }
}

export function isRealWorkspaceName(workspaceId: string, name: unknown): name is string {
  return typeof name === 'string' && name.trim().length > 0 && name.trim() !== workspaceId.trim();
}

export function rememberWorkspaceName(workspaceId: string, name: unknown): void {
  if (!workspaceId?.trim() || !isRealWorkspaceName(workspaceId, name)) return;
  const map = readMap();
  map[workspaceId] = (name as string).trim();
  writeMap(map);
}

export function lastKnownWorkspaceName(workspaceId: string | null | undefined): string | null {
  if (!workspaceId?.trim()) return null;
  return readMap()[workspaceId] ?? null;
}

/** Test seam: clear the persisted map between cases. */
export function resetWorkspaceNamesForTests(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

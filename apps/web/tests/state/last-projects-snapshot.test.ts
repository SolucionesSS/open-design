// Cold-boot paint: the in-memory display snapshots are keyed by the resolved
// Workspace identity, which does not exist yet on a fresh boot — so the
// drafts grid opens empty until the (Vela-backed, seconds-long) context read
// lands. This persists the last rendered project list per tab-lineage
// Workspace/member pair so boot can paint it instantly while revalidating.
//
// Safety: reads are gated on the tab's live sessionStorage selection matching
// the stored pair. A new tab has no selection (no paint), and sign-out clears
// the selection (no cross-account leak).

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  readLastProjectsSnapshot,
  resetLastProjectsSnapshotForTests,
  writeLastProjectsSnapshot,
} from '../../src/state/project-display-cache';
import type { Project } from '../../src/types';

function project(id: string): Project {
  return {
    id,
    name: id,
    skillId: null,
    designSystemId: null,
    createdAt: 1,
    updatedAt: 2,
  };
}

const SELECTION = { workspaceId: 'ws-1', workspaceMemberId: 'member-1' };
const VIEW = 'drafts' as const;

describe('last projects snapshot', () => {
  afterEach(() => {
    resetLastProjectsSnapshotForTests();
    vi.unstubAllGlobals();
  });

  it('returns nothing when nothing was stored', () => {
    expect(readLastProjectsSnapshot(SELECTION, VIEW)).toBeNull();
  });

  it('round-trips the last rendered list for the same tab lineage', () => {
    const stored = vi.fn();
    const fakeStore: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => fakeStore[key] ?? null,
      setItem: (key: string, value: string) => { stored(value); fakeStore[key] = String(value); },
      removeItem: (key: string) => { delete fakeStore[key]; },
    } as unknown as Storage);
    writeLastProjectsSnapshot(SELECTION, VIEW, [project('a'), project('b')]);
    expect(stored).toHaveBeenCalledTimes(1);
    expect(readLastProjectsSnapshot(SELECTION, VIEW)?.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('does not answer a different member', () => {
    const fakeStore: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => fakeStore[key] ?? null,
      setItem: (key: string, value: string) => { fakeStore[key] = String(value); },
      removeItem: (key: string) => { delete fakeStore[key]; },
    } as unknown as Storage);
    writeLastProjectsSnapshot(SELECTION, VIEW, [project('a')]);
    expect(readLastProjectsSnapshot({ workspaceId: 'ws-1', workspaceMemberId: 'member-2' }, VIEW)).toBeNull();
    expect(readLastProjectsSnapshot({ workspaceId: 'ws-2', workspaceMemberId: 'member-1' }, VIEW)).toBeNull();
  });

  it('keeps views separate', () => {
    const fakeStore: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => fakeStore[key] ?? null,
      setItem: (key: string, value: string) => { fakeStore[key] = String(value); },
      removeItem: (key: string) => { delete fakeStore[key]; },
    } as unknown as Storage);
    writeLastProjectsSnapshot(SELECTION, VIEW, [project('a')]);
    expect(readLastProjectsSnapshot(SELECTION, 'recent')).toBeNull();
    expect(readLastProjectsSnapshot(SELECTION, VIEW)?.map((p) => p.id)).toEqual(['a']);
  });

  it('remembers an authoritative empty list without hiding it as a miss', () => {
    const fakeStore: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => fakeStore[key] ?? null,
      setItem: (key: string, value: string) => { fakeStore[key] = String(value); },
      removeItem: (key: string) => { delete fakeStore[key]; },
    } as unknown as Storage);
    writeLastProjectsSnapshot(SELECTION, VIEW, []);
    expect(readLastProjectsSnapshot(SELECTION, VIEW)).toEqual([]);
  });

  it('survives a corrupted payload', () => {
    const fakeStore: Record<string, string> = { 'od.last-projects.v1': 'not-json{{{' };
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => fakeStore[key] ?? null,
      setItem: (key: string, value: string) => { fakeStore[key] = String(value); },
      removeItem: (key: string) => { delete fakeStore[key]; },
    } as unknown as Storage);
    expect(readLastProjectsSnapshot(SELECTION, VIEW)).toBeNull();
  });
});

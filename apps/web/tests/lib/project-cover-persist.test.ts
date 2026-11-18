// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getCachedDeckCover,
  loadDeckCover,
} from '../../src/lib/project-cover-pipeline';
import {
  getProjectCoverSnapshot as getCoverSnapshot,
  projectCoverSnapshotKey,
  resetProjectCoverSnapshots,
  setProjectCoverSnapshot as setCoverSnapshot,
} from '../../src/lib/project-cover-cache';

function stubStorage() {
  const fakeStore: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => fakeStore[key] ?? null,
    setItem: (key: string, value: string) => { fakeStore[key] = String(value); },
    removeItem: (key: string) => { delete fakeStore[key]; },
  } as unknown as Storage);
  return fakeStore;
}

describe('cover decision persistence', () => {
  afterEach(() => {
    resetProjectCoverSnapshots();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('serves a stored decision after a reload (fresh module, storage intact)', async () => {
    stubStorage();
    const key = projectCoverSnapshotKey('ws|member', 'proj-a', 42);
    const cover = { kind: 'image' as const, name: 'shot.png', mtime: 42 };
    setCoverSnapshot(key, cover);
    // A reload is a fresh module lifetime with the same storage: the
    // in-memory map is empty, the persisted twin is not.
    vi.resetModules();
    const fresh = await import('../../src/lib/project-cover-cache');
    expect(fresh.getProjectCoverSnapshot(key)?.cover).toEqual(cover);
  });

  it('ignores corrupt stored decisions', () => {
    const store = stubStorage();
    store['od.project-covers.v1'] = 'not-json{{{';
    const key = projectCoverSnapshotKey('ws|member', 'proj-b', 7);
    expect(getCoverSnapshot(key)).toBeUndefined();
  });
});

const DECK_HTML = '<!doctype html><html><head></head><body><div class="slide">one</div></body></html>';

describe('deck cover persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('reuses the parsed srcDoc across module lifetimes without refetching', async () => {
    stubStorage();
    const fetchMock = vi.fn(async () => new Response(DECK_HTML, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const src = '/api/projects/deck-1/raw/deck.html?v=123';

    const first = await loadDeckCover(src);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toContain('data-od-cover-slide');

    // A fresh module lifetime (reload): memory caches are empty, storage is not.
    vi.resetModules();
    const fresh = await import('../../src/lib/project-cover-pipeline');
    const fetchMock2 = vi.fn(async () => { throw new Error('must not refetch'); });
    vi.stubGlobal('fetch', fetchMock2);
    expect(fresh.getCachedDeckCover(src)).toContain('data-od-cover-slide');
    await expect(fresh.loadDeckCover(src)).resolves.toContain('data-od-cover-slide');
    expect(fetchMock2).not.toHaveBeenCalled();
  });
});

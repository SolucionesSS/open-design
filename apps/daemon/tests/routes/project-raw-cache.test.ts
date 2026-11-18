// Version-pinned raw files (`?v=<mtime>`, as minted by `projectCoverUrl`) are
// byte-stable for that URL: the ETag derives from the same size+mtime the
// version names, and an agent rewrite bumps the mtime (hence the URL).
// Serving those immutable lets the browser skip the revalidation roundtrip
// entirely on reload instead of paying one 304 per asset. Unversioned,
// mismatched, or substituted (Vite/bridge-transformed) responses keep the
// revalidate behavior.

import { describe, expect, it } from 'vitest';

import { rawVersionedCacheControl } from '../../src/routes/project/index.js';

describe('rawVersionedCacheControl', () => {
  it('keeps unversioned reads revalidating', () => {
    expect(rawVersionedCacheControl(undefined, 1794689120094, false)).toBe('revalidate');
  });

  it('keeps mismatched versions revalidating', () => {
    expect(rawVersionedCacheControl('1794689120093', 1794689120094, false)).toBe('revalidate');
    expect(rawVersionedCacheControl('abc', 1794689120094, false)).toBe('revalidate');
    expect(rawVersionedCacheControl('', 1794689120094, false)).toBe('revalidate');
  });

  it('marks exact version matches immutable', () => {
    expect(rawVersionedCacheControl('1794689120094', 1794689120094, false)).toBe('immutable');
  });

  it('keeps substituted bytes revalidating even on version match', () => {
    expect(rawVersionedCacheControl('1794689120094', 1794689120094, true)).toBe('revalidate');
  });
});

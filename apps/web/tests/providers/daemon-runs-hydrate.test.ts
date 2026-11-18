// The pet task center polls the runs listing every 2s per tab and only
// reads status/projectId/updatedAt. It must request the light listing
// (`?hydrate=none`) so the daemon skips the per-run strategy-task
// hydration (SQLite N+1 + canonical-XML parse on the event loop).

import { afterEach, describe, expect, it, vi } from 'vitest';

import { listProjectRunsWithScope } from '../../src/providers/daemon';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch() {
  const calls: Array<{ url: unknown; init: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init: unknown) => {
      calls.push({ url, init });
      return Response.json({ runs: [] });
    }),
  );
  return calls;
}

describe('listProjectRunsWithScope hydration', () => {
  it('requests the default hydrated listing without options', async () => {
    const calls = stubFetch();
    await listProjectRunsWithScope(null);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/runs');
  });

  it('requests the light listing with hydrate none', async () => {
    const calls = stubFetch();
    await listProjectRunsWithScope(undefined, { hydrate: 'none' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/runs?hydrate=none');
  });
});

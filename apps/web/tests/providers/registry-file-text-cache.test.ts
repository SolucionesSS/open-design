import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchProjectFileText,
  fetchProjectHtmlSources,
} from '../../src/providers/registry';

// Improvement 2 + 6: fetchProjectFileText reuses the daemon ETag on 304, and
// fetchProjectHtmlSources skips entries whose mtime has not moved.
describe('project file text caching', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sends If-None-Match and reuses cached text on 304', async () => {
    const seen: Array<{ url: unknown; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: input, init });
      if (seen.length === 1) {
        return new Response('<html>v1</html>', {
          status: 200,
          headers: { ETag: 'W/"a-b"' },
        });
      }
      return new Response(null, { status: 304 });
    }));

    await expect(fetchProjectFileText('proj-etag', 'index.html')).resolves.toBe('<html>v1</html>');
    await expect(fetchProjectFileText('proj-etag', 'index.html')).resolves.toBe('<html>v1</html>');
    expect(seen).toHaveLength(2);
    expect(new Headers(seen[1]!.init?.headers).get('If-None-Match')).toBe('W/"a-b"');
  });

  it('refetches only html entries whose mtime moved', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      calls += 1;
      const name = String(input).split('/').pop()!;
      return new Response(`<html>${name}</html>`, { status: 200 });
    }));

    const entries = [
      { name: 'a.html', mtime: 10 },
      { name: 'b.html', mtime: 20 },
    ];
    const first = await fetchProjectHtmlSources('proj-sweep', entries);
    expect(first.size).toBe(2);
    expect(calls).toBe(2);

    const second = await fetchProjectHtmlSources('proj-sweep', entries);
    expect(second).toEqual(first);
    expect(calls).toBe(2);

    const third = await fetchProjectHtmlSources('proj-sweep', [
      { name: 'a.html', mtime: 10 },
      { name: 'b.html', mtime: 30 },
    ]);
    expect(third.size).toBe(2);
    expect(calls).toBe(3);
  });
});

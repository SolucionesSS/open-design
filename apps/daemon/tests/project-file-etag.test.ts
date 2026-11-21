import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

// Improvement 2: GET /api/projects/:id/files/:name serves a weak ETag from
// size+mtime and answers 304 to a matching If-None-Match without reading
// file bytes. The web reader caches text keyed by that ETag.
describe('project file ETag revalidation', () => {
  let server: http.Server;
  let baseUrl: string;
  const projectId = `etag-${randomUUID()}`;

  function projectFilePath(): string {
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    return path.join(dataDir, 'projects', projectId, 'index.html');
  }

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
    const created = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: projectId, name: 'ETag project' }),
    });
    expect(created.status).toBe(200);
    await mkdir(path.dirname(projectFilePath()), { recursive: true });
    await writeFile(projectFilePath(), '<!doctype html><html><body>v1</body></html>');
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('serves an ETag and answers 304 to a matching If-None-Match', async () => {
    const first = await fetch(`${baseUrl}/api/projects/${projectId}/files/index.html`);
    expect(first.status).toBe(200);
    const etag = first.headers.get('ETag');
    expect(etag).toMatch(/^W\//);
    expect(await first.text()).toContain('v1');

    const revalidated = await fetch(`${baseUrl}/api/projects/${projectId}/files/index.html`, {
      headers: { 'If-None-Match': etag! },
    });
    expect(revalidated.status).toBe(304);
    expect(await revalidated.text()).toBe('');
  });

  it('returns 200 for a stale validator and rotates the ETag on rewrite', async () => {
    const first = await fetch(`${baseUrl}/api/projects/${projectId}/files/index.html`);
    const oldEtag = first.headers.get('ETag');
    expect(oldEtag).toBeTruthy();

    const stale = await fetch(`${baseUrl}/api/projects/${projectId}/files/index.html`, {
      headers: { 'If-None-Match': '"definitely-not-it"' },
    });
    expect(stale.status).toBe(200);

    await writeFile(
      projectFilePath(),
      '<!doctype html><html><body>v2 with more content so size differs</body></html>',
    );
    const afterRewrite = await fetch(`${baseUrl}/api/projects/${projectId}/files/index.html`, {
      headers: { 'If-None-Match': oldEtag! },
    });
    expect(afterRewrite.status).toBe(200);
    expect(afterRewrite.headers.get('ETag')).not.toBe(oldEtag);
    expect(await afterRewrite.text()).toContain('v2');
  });
});

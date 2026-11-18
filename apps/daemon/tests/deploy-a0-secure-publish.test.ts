/**
 * PR-A0 hardening (REVIEW FIX) regression suite.
 *
 * Labeled by layer so reviewers can tell what was actually exercised:
 *  - UNIT: pure helpers (`isStrictPublishableDeployPath`,
 *    `resolveIncludeProjectFiles`, `deployIncludeFilesFromCliFlag`) and
 *    in-memory file plans via `buildDeployFilePlan`/`buildDeployFileSet`
 *    (no HTTP, no network, no Cloudflare).
 *  - INTEGRATION (HTTP): malformed `includeProjectFiles` rejected with 400
 *    through a real daemon on a temp data root, plus a CLI `--help`
 *    assertion via a real `tsx` subprocess. No deployment is performed and
 *    no production host is contacted anywhere in this file.
 */
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildDeployFilePlan,
  buildDeployFileSet,
  deployIncludeFilesFromCliFlag,
  isDeployInternalPath,
  isStrictPublishableDeployPath,
  prepareDeployPreflight,
  resolveIncludeProjectFiles,
} from '../src/deploy.js';
import { ensureProject } from '../src/projects.js';

const execFileAsync = promisify(execFile);

async function setupProject(files: Record<string, string>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'od-deploy-a0-'));
  const projectId = 'a0';
  const dir = await ensureProject(path.join(root, 'projects'), projectId);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return { projectsRoot: path.join(root, 'projects'), projectId, dir, root };
}

describe('UNIT: strict publish allowlist', () => {
  it('allows exactly the guide closure types (html/css/js/images/fonts/pdf)', () => {
    for (const p of [
      'index.html',
      'paginas-principales/guia-marca-editorial.html',
      'style.css',
      'app.js',
      'mod.mjs',
      'lib.cjs',
      'marca-oficial/isotipo.svg',
      'assets/logo.svg',
      'photo.png',
      'a.jpg',
      'b.jpeg',
      'c.gif',
      'd.webp',
      'e.avif',
      'f.ico',
      'iteracion-05/fonts/dm-sans-400.ttf',
      'font.woff2',
      'font.woff',
      'font.otf',
      'clip.mp4',
      'guia-marca.pdf',
    ]) {
      expect(isStrictPublishableDeployPath(p)).toBe(true);
    }
  });

  it('refuses internals, sources, data and dot-paths regardless of extension', () => {
    for (const p of [
      // Observed production leak:
      'ESTADO.md',
      'brand-status.json',
      'suites/README.md',
      'paginas-principales/auditoria-coherencia-guia.md',
      'paginas-principales/_build/build.py',
      '_build/sora.ttf',
      // Indirect-ref coverage (never publishable even when referenced):
      'data/config.json',
      'notes/todo.md',
      'src/app.ts',
      'src/server.py',
      'run.sh',
      'state.sqlite',
      'index.html.artifact.json',
      '.od/skills/x.md',
      'a/.hidden/logo.svg',
      'no-extension',
    ]) {
      expect(isStrictPublishableDeployPath(p)).toBe(false);
    }
    // Location rules apply even to allowlisted extensions:
    expect(isStrictPublishableDeployPath('paginas-principales/_build/out.svg')).toBe(false);
    expect(isStrictPublishableDeployPath('brand-status.json')).toBe(false);
  });

  it('keeps the legacy denylist helper consistent', () => {
    expect(isDeployInternalPath('ESTADO.md')).toBe(true);
    expect(isDeployInternalPath('brand-status.json')).toBe(true);
    expect(isDeployInternalPath('index.html')).toBe(false);
    expect(isDeployInternalPath('assets/logo.svg')).toBe(false);
  });

  it('resolveIncludeProjectFiles: omitted/boolean pass, malformed throws', () => {
    expect(resolveIncludeProjectFiles(undefined)).toBe(true);
    expect(resolveIncludeProjectFiles(true)).toBe(true);
    expect(resolveIncludeProjectFiles(false)).toBe(false);
    for (const bad of ['yes', 'false', 1, 0, null, {}, []]) {
      expect(() => resolveIncludeProjectFiles(bad)).toThrow(/expected boolean/);
    }
  });

  it('deployIncludeFilesFromCliFlag: all|referenced map, anything else throws', () => {
    expect(deployIncludeFilesFromCliFlag(undefined)).toBe(undefined);
    expect(deployIncludeFilesFromCliFlag('all')).toBe(true);
    expect(deployIncludeFilesFromCliFlag('referenced')).toBe(false);
    for (const bad of ['yes', 'true', '', 'ALL FILES']) {
      expect(() => deployIncludeFilesFromCliFlag(bad)).toThrow(/referenced/);
    }
  });
});

describe('UNIT: strict file plan (in-memory projects, no HTTP)', () => {
  let root = '';
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = '';
  });

  it('ships a guide-like closure exactly (html+svg+png+ttf)', async () => {
    const s = await setupProject({
      'paginas-principales/guia.html':
        '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head>' +
        '<body><img src="img/logo.svg"><img src="img/photo.png"></body></html>',
      'paginas-principales/style.css': '@font-face{src:url("fonts/a.ttf")}',
      'paginas-principales/img/logo.svg': '<svg></svg>',
      'paginas-principales/img/photo.png': 'png',
      'paginas-principales/fonts/a.ttf': 'font',
      'ESTADO.md': '# internal',
      'brand-status.json': '{}',
    });
    root = s.root;
    const plan = await buildDeployFilePlan(s.projectsRoot, s.projectId, 'paginas-principales/guia.html', {
      includeProjectFiles: false,
    });
    const names = plan.files.map((f) => f.file).sort();
    expect(names).toEqual([
      'index.html',
      'paginas-principales/fonts/a.ttf',
      'paginas-principales/img/logo.svg',
      'paginas-principales/img/photo.png',
      'paginas-principales/style.css',
    ]);
    expect(plan.excluded).toEqual([]);
    expect(names.some((n) => n.endsWith('.md'))).toBe(false);
  });

  it('refuses a directly referenced internal JSON (fail-closed, same list in preflight)', async () => {
    const s = await setupProject({
      // rel=manifest is a followed reference (see shouldCollectHref): a
      // realistic vector for pulling a JSON status file into the artifact.
      'index.html': '<!doctype html><html><head><link rel="manifest" href="brand-status.json"></head><body></body></html>',
      'brand-status.json': '{}',
    });
    root = s.root;
    const plan = await buildDeployFilePlan(s.projectsRoot, s.projectId, 'index.html', {
      includeProjectFiles: false,
    });
    expect(plan.excluded).toContain('brand-status.json');
    await expect(
      buildDeployFileSet(s.projectsRoot, s.projectId, 'index.html', { includeProjectFiles: false }),
    ).rejects.toMatchObject({ code: 'EXCLUDED_REFERENCES' });
    const preflight = await prepareDeployPreflight(s.projectsRoot, s.projectId, 'index.html', {
      includeProjectFiles: false,
    });
    expect(preflight.excluded).toContain('brand-status.json');
    expect(preflight.warnings.some((w) => w.code === 'excluded-reference')).toBe(true);
    // Parity: preflight and deploy resolve through the same walk.
    expect([...preflight.excluded].sort()).toEqual([...plan.excluded].sort());
    expect([...preflight.files.map((f) => f.path)].sort()).toEqual(
      [...plan.files.map((f) => f.file)].sort(),
    );
  });

  it('covers indirect references (entry -> iframe page2 -> SECRET.md)', async () => {
    const s = await setupProject({
      // <a href> is navigation (not walked); <iframe src> is a followed
      // reference, and <link rel=manifest> carries the payload on page2.
      'index.html': '<!doctype html><body><iframe src="page2.html"></iframe></body></html>',
      'page2.html': '<!doctype html><html><head><link rel="manifest" href="SECRET.md"></head><body></body></html>',
      'SECRET.md': '# internal',
    });
    root = s.root;
    await expect(
      buildDeployFileSet(s.projectsRoot, s.projectId, 'index.html', { includeProjectFiles: false }),
    ).rejects.toMatchObject({ code: 'EXCLUDED_REFERENCES' });
  });

  it('covers nested _build and source files even with allowlisted siblings', async () => {
    const s = await setupProject({
      'index.html': '<!doctype html><body><img src="ok/logo.svg"><img src="nested/_build/out.svg"></body></html>',
      'ok/logo.svg': '<svg></svg>',
      'nested/_build/out.svg': '<svg></svg>',
    });
    root = s.root;
    const plan = await buildDeployFilePlan(s.projectsRoot, s.projectId, 'index.html', {
      includeProjectFiles: false,
    });
    expect(plan.excluded).toContain('nested/_build/out.svg');
    await expect(
      buildDeployFileSet(s.projectsRoot, s.projectId, 'index.html', { includeProjectFiles: false }),
    ).rejects.toThrow(/EXCLUDED|non-publishable/);
  });

  it('legacy default (true) preserves the old file set including internals', async () => {
    const s = await setupProject({
      'index.html': '<!doctype html><h1>Hi</h1>',
      'ESTADO.md': '# internal',
      'brand-status.json': '{}',
    });
    root = s.root;
    const plan = await buildDeployFilePlan(s.projectsRoot, s.projectId, 'index.html', {
      includeProjectFiles: true,
    });
    const names = plan.files.map((f) => f.file);
    expect(names).toContain('ESTADO.md');
    expect(names).toContain('brand-status.json');
    expect(plan.excluded).toEqual([]);
  });
});

describe('INTEGRATION (HTTP): malformed includeProjectFiles is rejected with 400', () => {
  it('rejects non-boolean values on deploy and preflight without fixtures', async () => {
    const prev = process.env.OD_DATA_DIR;
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-a0-routes-'));
    process.env.OD_DATA_DIR = dataDir;
    let server: { close: (cb: () => void) => void } | null = null;
    try {
      const { startServer } = (await import('../src/server.js')) as typeof import('../src/server.js');
      const started = (await startServer({ port: 0, returnServer: true })) as unknown as {
        url: string;
        server: { close: (cb: () => void) => void };
      };
      server = started.server;
      for (const bad of ['yes', 1, { all: true }]) {
        const deployResp = await fetch(
          `${started.url}/api/projects/does-not-exist/deploy`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fileName: 'index.html', includeProjectFiles: bad }),
          },
        );
        expect(deployResp.status).toBe(400);
        expect(await deployResp.text()).toContain('includeProjectFiles');
        const preflightResp = await fetch(
          `${started.url}/api/projects/does-not-exist/deploy/preflight`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fileName: 'index.html', includeProjectFiles: bad }),
          },
        );
        expect(preflightResp.status).toBe(400);
        expect(await preflightResp.text()).toContain('includeProjectFiles');
      }
    } finally {
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
      if (prev === undefined) delete process.env.OD_DATA_DIR;
      else process.env.OD_DATA_DIR = prev;
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 120000);

  it('CLI advertises --include-files (real --help subprocess, no deploy)', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const { stdout } = await execFileAsync(path.join(repoRoot, 'node_modules', '.bin', 'tsx'), ['apps/daemon/src/cli.ts', 'deploy', '--help'], {
      cwd: repoRoot,
      timeout: 90000,
    });
    expect(stdout).toContain('--include-files all|referenced');
  }, 120000);
});

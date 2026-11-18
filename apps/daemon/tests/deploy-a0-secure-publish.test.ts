/**
 * PR-A0 FINAL REVIEW FIX regression suite.
 *
 * Labeled by layer so reviewers can tell what was actually exercised:
 *  - UNIT: pure helpers (`isStrictPublishableDeployPath`,
 *    `resolveIncludeProjectFiles`, `deployIncludeFilesFromCliFlag`,
 *    `readDeployPolicy`) and in-memory file plans via
 *    `buildDeployFilePlan`/`buildDeployFileSet` (no HTTP, no network,
 *    no Cloudflare).
 *  - INTEGRATION (HTTP): a real daemon on a temp data root serves a
 *    valid project in restricted mode — malformed `includeProjectFiles`
 *    rejected with 400, official-entry policy enforced without the flag,
 *    preflight-vs-deploy parity without contacting any provider — plus a
 *    CLI `--help` assertion via a real `tsx` subprocess. No deployment is
 *    performed and no production host is contacted anywhere in this file.
 */
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  buildDeployFilePlan,
  buildDeployFileSet,
  DEPLOY_POLICY_FILENAME,
  deployIncludeFilesFromCliFlag,
  isDeployInternalPath,
  isStrictPublishableDeployPath,
  prepareDeployPreflight,
  readDeployPolicy,
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

describe('INTEGRATION (HTTP): one temp-data-root daemon for all HTTP cases', () => {
  // A single server per file: starting two daemons with different
  // OD_DATA_DIR roots in one file shares the module-level sqlite handle
  // and cross-wires projects with data roots. One server, one root.
  let baseUrl = '';
  let dataDir = '';
  let prevDataDir: string | undefined;
  let server: { close: (cb: () => void) => void } | null = null;
  beforeAll(async () => {
    prevDataDir = process.env.OD_DATA_DIR;
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-a0-http-'));
    process.env.OD_DATA_DIR = dataDir;
    const { startServer } = (await import('../src/server.js')) as typeof import('../src/server.js');
    const started = (await startServer({ port: 0, returnServer: true })) as unknown as {
      url: string;
      server: { close: (cb: () => void) => void };
    };
    baseUrl = started.url;
    server = started.server;
  }, 120000);
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (prevDataDir === undefined) delete process.env.OD_DATA_DIR;
    else process.env.OD_DATA_DIR = prevDataDir;
    await rm(dataDir, { recursive: true, force: true });
  });

  it('rejects non-boolean includeProjectFiles with 400 on deploy and preflight', async () => {
    for (const bad of ['yes', 1, { all: true }]) {
      const deployResp = await fetch(`${baseUrl}/api/projects/does-not-exist/deploy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileName: 'index.html', includeProjectFiles: bad }),
      });
      expect(deployResp.status).toBe(400);
      expect(await deployResp.text()).toContain('includeProjectFiles');
      const preflightResp = await fetch(`${baseUrl}/api/projects/does-not-exist/deploy/preflight`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileName: 'index.html', includeProjectFiles: bad }),
      });
      expect(preflightResp.status).toBe(400);
      expect(await preflightResp.text()).toContain('includeProjectFiles');
    }
  });

  it('serves a policy-pinned preflight without the flag and refuses the deploy closed', async () => {
    const projectId = `a0-http-${Date.now().toString(36)}`;
    const createResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: projectId, name: 'A0 HTTP', skillId: null, designSystemId: null }),
    });
    expect(createResp.status).toBe(200);

    // Fixture on disk (simulates the checked-in brand project content).
    // The policy pins the official entry to its exact publish set, so the
    // deployment never depends on remembering includeProjectFiles:false.
    const projDir = path.join(dataDir, 'projects', projectId);
    const entry = 'g/guia.html';
    await mkdir(path.join(projDir, 'g'), { recursive: true });
    await writeFile(
      path.join(projDir, entry),
      '<!doctype html><html><head><link rel="stylesheet" href="s.css"></head>' +
        '<body><img src="a.svg"><link rel="manifest" href="leak.json"></body></html>',
    );
    await writeFile(path.join(projDir, 'g/a.svg'), '<svg></svg>');
    await writeFile(path.join(projDir, 'g/s.css'), 'body{}');
    await writeFile(path.join(projDir, 'g/leak.json'), '{}');
    await writeFile(path.join(projDir, 'ESTADO.md'), '# internal');
    await writeFile(
      path.join(projDir, DEPLOY_POLICY_FILENAME),
      JSON.stringify({ version: 1, entries: [entry], allow: ['g/a.svg', 'g/s.css'] }),
    );

    // 1. Preflight WITHOUT the flag: the policy pins strict mode anyway.
    const preflightResp = await fetch(`${baseUrl}/api/projects/${projectId}/deploy/preflight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: entry }),
    });
    expect(preflightResp.status).toBe(200);
    const preflight = (await preflightResp.json()) as any;
    expect(preflight.policy).toMatchObject({ enforced: true });
    expect(preflight.excluded).toContain('g/leak.json');
    expect(preflight.files.map((f: { path: string }) => f.path).sort()).toEqual([
      'g/a.svg',
      'g/s.css',
      'index.html',
    ]);
    expect(preflight.warnings.some((w: { code: string }) => w.code === 'excluded-reference')).toBe(true);

    // 2. Parity: the deploy route refuses with the IDENTICAL excluded list
    // before reaching any provider (no Cloudflare/Vercel contact: the
    // failure happens in the file_plan stage, for the default provider
    // without credentials configured).
    const deployResp = await fetch(`${baseUrl}/api/projects/${projectId}/deploy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: entry }),
    });
    expect(deployResp.status).toBe(400);
    const deployBody = (await deployResp.json()) as any;
    expect(deployBody.code ?? deployBody.error?.code ?? JSON.stringify(deployBody)).toMatch(/EXCLUDED_REFERENCES/);
    const deployExcluded: string[] =
      deployBody.details?.excluded ?? deployBody.error?.details?.excluded ?? deployBody.excluded ?? [];
    expect([...deployExcluded].sort()).toEqual([...preflight.excluded].sort());
  }, 180000);

  it('CLI advertises --include-files (real --help subprocess, no deploy)', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const { stdout } = await execFileAsync(path.join(repoRoot, 'node_modules', '.bin', 'tsx'), ['apps/daemon/src/cli.ts', 'deploy', '--help'], {
      cwd: repoRoot,
      timeout: 90000,
    });
    expect(stdout).toContain('--include-files all|referenced');
  }, 120000);
});

describe('UNIT: project deploy policy (.deploy-policy.json)', () => {
  let root = '';
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = '';
  });

  async function setupPolicyProject(policy: unknown, files: Record<string, string>) {
    const s = await setupProject(files);
    root = s.root;
    if (policy !== null) {
      await writeFile(path.join(s.dir, DEPLOY_POLICY_FILENAME), typeof policy === 'string' ? policy : JSON.stringify(policy));
    }
    return s;
  }

  it('returns null when the project has no policy file', async () => {
    const s = await setupProject({ 'index.html': '<!doctype html>' });
    root = s.root;
    await expect(readDeployPolicy(s.projectsRoot, s.projectId, undefined)).resolves.toBe(null);
  });

  it('loads entries and allow sets, and never lets the policy file ship itself', async () => {
    const s = await setupPolicyProject(
      { version: 1, entries: ['g/guia.html'], allow: ['g/a.svg', DEPLOY_POLICY_FILENAME] },
      { 'g/guia.html': '<!doctype html>' },
    );
    const loaded = await readDeployPolicy(s.projectsRoot, s.projectId, undefined);
    expect([...loaded!.entries]).toEqual(['g/guia.html']);
    expect([...loaded!.allow].sort()).toEqual(['g/a.svg']);
  });

  it('fails closed on malformed policies (bad JSON, shape, paths)', async () => {
    for (const bad of [
      'not-json{',
      JSON.stringify({ version: 2, entries: ['a.html'], allow: [] }),
      JSON.stringify({ version: 1, entries: [], allow: [] }),
      JSON.stringify({ version: 1, entries: 'a.html', allow: [] }),
      JSON.stringify({ version: 1, entries: ['a.html'], allow: '../escape.html' }),
      JSON.stringify([1, 2]),
    ]) {
      const s = await setupPolicyProject(bad, { 'a.html': '<!doctype html>' });
      await expect(readDeployPolicy(s.projectsRoot, s.projectId, undefined)).rejects.toMatchObject({
        code: 'INVALID_DEPLOY_POLICY',
      });
    }
  });

  it('pins the official entry to its exact set even when the flag asks for legacy', async () => {
    const s = await setupPolicyProject(
      { version: 1, entries: ['g/guia.html'], allow: ['g/a.svg'] },
      {
        'g/guia.html':
          '<!doctype html><html><head><link rel="stylesheet" href="s.css"></head>' +
          '<body><img src="a.svg"><img src="../ESTADO.md"></body></html>',
        'g/a.svg': '<svg></svg>',
        'g/s.css': 'body{}',
        'ESTADO.md': '# internal',
      },
    );
    // Caller asked for the legacy file set: the policy still wins.
    const plan = await buildDeployFilePlan(s.projectsRoot, s.projectId, 'g/guia.html', {
      includeProjectFiles: true,
    });
    expect(plan.policyEnforced).toBe(true);
    expect(plan.files.map((f) => f.file).sort()).toEqual(['g/a.svg', 'index.html']);
    expect(plan.excluded).toContain('ESTADO.md');
    expect(plan.excluded).toContain('g/s.css');
    // s.css is an allowlisted EXTENSION but not in the exact set: the
    // extension gate alone would have shipped it. The exact set refuses.
    await expect(
      buildDeployFileSet(s.projectsRoot, s.projectId, 'g/guia.html', { includeProjectFiles: true }),
    ).rejects.toMatchObject({ code: 'EXCLUDED_REFERENCES' });
  });

  it('leaves other entries and other projects on the legacy behavior', async () => {
    const s = await setupPolicyProject(
      { version: 1, entries: ['g/guia.html'], allow: ['g/a.svg'] },
      {
        'other.html': '<!doctype html><h1>deck</h1>',
        'ESTADO.md': '# internal',
      },
    );
    const plan = await buildDeployFilePlan(s.projectsRoot, s.projectId, 'other.html', {
      includeProjectFiles: true,
    });
    expect(plan.policyEnforced).toBe(false);
    expect(plan.files.map((f) => f.file)).toContain('ESTADO.md');
  });
});

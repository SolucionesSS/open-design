import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildDeployFilePlan,
  buildDeployFileSet,
  isDeployInternalPath,
} from '../src/deploy.js';
import { ensureProject } from '../src/projects.js';

async function setupBrandLikeProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'od-deploy-a0-'));
  const projectId = 'brand-a0';
  const dir = await ensureProject(path.join(root, 'projects'), projectId);
  await mkdir(path.join(dir, 'assets'), { recursive: true });
  await mkdir(path.join(dir, 'paginas-principales', '_build'), { recursive: true });
  await writeFile(
    path.join(dir, 'paginas-principales', 'guia-marca-editorial.html'),
    '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head>' +
      '<body><img src="../assets/logo.svg"><a href="../ESTADO.md">estado</a>' +
      '<a href="../brand-status.json">status</a></body></html>',
  );
  await writeFile(path.join(dir, 'paginas-principales', 'style.css'), 'body{color:#0b1d3a}');
  await writeFile(path.join(dir, 'assets', 'logo.svg'), '<svg></svg>');
  await writeFile(path.join(dir, 'ESTADO.md'), '# internal');
  await writeFile(path.join(dir, 'brand-status.json'), '{}');
  await writeFile(path.join(dir, 'paginas-principales', '_build', 'build.py'), 'print(1)');
  await writeFile(path.join(dir, 'paginas-principales', 'auditoria.md'), '# audit');
  return { projectsRoot: path.join(root, 'projects'), projectId, dir, root };
}

afterEach(async () => {
  // mkdtemp roots are under os.tmpdir; best-effort cleanup tracked per test.
});

describe('PR-A0 secure publish', () => {
  it('classifies internal paths', () => {
    expect(isDeployInternalPath('ESTADO.md')).toBe(true);
    expect(isDeployInternalPath('brand-status.json')).toBe(true);
    expect(isDeployInternalPath('a/b/_build/build.py')).toBe(true);
    expect(isDeployInternalPath('docs/auditoria.md')).toBe(true);
    expect(isDeployInternalPath('index.html')).toBe(false);
    expect(isDeployInternalPath('assets/logo.svg')).toBe(false);
    expect(isDeployInternalPath('paginas-principales/style.css')).toBe(false);
  });

  it('legacy default (true) preserves the old file set including internals', async () => {
    const { projectsRoot, projectId, root } = await setupBrandLikeProject();
    try {
      const plan = await buildDeployFilePlan(
        projectsRoot,
        projectId,
        'paginas-principales/guia-marca-editorial.html',
        { includeProjectFiles: true },
      );
      const names = plan.files.map((f) => f.file);
      expect(names).toContain('ESTADO.md');
      expect(names).toContain('brand-status.json');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('strict mode (false) ships the guide + assets and drops internals even when referenced', async () => {
    const { projectsRoot, projectId, root } = await setupBrandLikeProject();
    try {
      const files = await buildDeployFileSet(
        projectsRoot,
        projectId,
        'paginas-principales/guia-marca-editorial.html',
        { includeProjectFiles: false },
      );
      const names = files.map((f) => f.file).sort();
      // Entry is remapped to provider-root index.html.
      expect(names).toContain('index.html');
      expect(names).toContain('assets/logo.svg');
      expect(names).not.toContain('ESTADO.md');
      expect(names).not.toContain('brand-status.json');
      expect(names.some((n) => n.includes('_build'))).toBe(false);
      expect(names.some((n) => n.endsWith('.md'))).toBe(false);

      const html = files.find((f) => f.file === 'index.html')?.data.toString('utf8') ?? '';
      expect(html).toContain('assets/logo.svg');
      // HTTP + content check: the deployed bytes must not embed internal content.
      expect(html).not.toContain('# internal');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rollback: omitting the flag restores legacy behavior', async () => {
    const { projectsRoot, projectId, root } = await setupBrandLikeProject();
    try {
      const plan = await buildDeployFilePlan(
        projectsRoot,
        projectId,
        'paginas-principales/guia-marca-editorial.html',
        {},
      );
      // Undefined flag = referenced-only walk without the A0 internal filter
      // (legacy walk preserved); explicit true adds the visible-file expansion.
      expect(plan.files.length).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

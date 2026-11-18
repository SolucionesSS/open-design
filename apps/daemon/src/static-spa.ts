import type { Express } from 'express';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

export interface StaticSpaFallbackRequestLike {
  method: string;
  path: string;
  get?: (name: string) => string | undefined;
}

export function isStaticSpaFallbackRequest(req: StaticSpaFallbackRequestLike): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (req.path === '/api' || req.path.startsWith('/api/')) return false;
  if (req.path === '/artifacts' || req.path.startsWith('/artifacts/')) return false;
  if (req.path === '/frames' || req.path.startsWith('/frames/')) return false;
  if (req.path === '/_next' || req.path.startsWith('/_next/')) return false;

  const accept = req.get?.('accept') ?? '';
  return accept.length === 0 || accept.includes('text/html') || accept.includes('*/*');
}

export function resolveStaticSpaFallbackPath(req: StaticSpaFallbackRequestLike, staticDir: string): string | null {
  const indexPath = path.join(staticDir, 'index.html');
  if (!fs.existsSync(indexPath) || !isStaticSpaFallbackRequest(req)) return null;
  return indexPath;
}

export function registerStaticSpaFallback(app: Express, staticDir: string): void {
  app.get('/*splat', (req, res, next) => {
    const indexPath = resolveStaticSpaFallbackPath(req, staticDir);
    if (indexPath == null) return next();
    res.sendFile('index.html', { root: staticDir });
  });
}

/**
 * Serve the built web app. Next.js build assets under `/_next/static` carry
 * content hashes in their filenames, so they are safe to cache immutably:
 * without this every new tab revalidates ~30 chunks (one 304 roundtrip each)
 * before first paint. The shell (`index.html`, icons, …) keeps the default
 * revalidation behavior so deploys take effect immediately.
 */
export function registerWebStatic(app: Express, staticDir: string): void {
  const nextStaticDir = path.join(staticDir, '_next', 'static');
  if (fs.existsSync(nextStaticDir)) {
    app.use('/_next/static', express.static(nextStaticDir, { maxAge: '1y', immutable: true }));
  }
  app.use(express.static(staticDir));
}

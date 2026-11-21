import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  evictAppConfigCache,
  readAppConfig,
  readAppConfigSync,
  writeAppConfig,
} from '../src/app-config.js';

// Improvement 1: mtime-gated app-config cache. These specs pin the
// correctness contract the cache must uphold: external file edits,
// writes through this module, deletion, and sync/async parity all stay
// visible. They pass with or without the cache (no-regression net); the
// perf win is two stat calls replacing two full read+parse+validate cycles.
describe('app-config read cache', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-appconfig-cache-'));
  });

  afterEach(async () => {
    evictAppConfigCache(dataDir);
    await rm(dataDir, { recursive: true, force: true });
  });

  it('serves repeated reads and still sees external file edits', async () => {
    await writeFile(
      path.join(dataDir, 'app-config.json'),
      JSON.stringify({ onboardingCompleted: true }),
    );
    expect((await readAppConfig(dataDir)).onboardingCompleted).toBe(true);
    // Second read may hit the cache; an external edit must still invalidate it.
    await writeFile(
      path.join(dataDir, 'app-config.json'),
      JSON.stringify({ onboardingCompleted: false }),
    );
    expect((await readAppConfig(dataDir)).onboardingCompleted).toBe(false);
  });

  it('does not let callers mutate the cached value', async () => {
    await writeFile(
      path.join(dataDir, 'app-config.json'),
      JSON.stringify({ onboardingCompleted: true }),
    );
    const first = await readAppConfig(dataDir);
    (first as Record<string, unknown>).onboardingCompleted = 'corrupted';
    expect((await readAppConfig(dataDir)).onboardingCompleted).toBe(true);
  });

  it('sees writes through writeAppConfig and file deletion', async () => {
    await writeAppConfig(dataDir, { onboardingCompleted: true });
    expect((await readAppConfig(dataDir)).onboardingCompleted).toBe(true);
    await writeAppConfig(dataDir, { onboardingCompleted: false });
    expect((await readAppConfig(dataDir)).onboardingCompleted).toBe(false);
    await rm(path.join(dataDir, 'app-config.json'));
    // Deleted file falls back to defaults (telemetry defaulted, flag absent).
    expect((await readAppConfig(dataDir)).onboardingCompleted).toBeUndefined();
  });

  it('keeps sync and async readers consistent', async () => {
    await writeAppConfig(dataDir, { onboardingCompleted: true });
    expect(readAppConfigSync(dataDir).onboardingCompleted).toBe(true);
    expect((await readAppConfig(dataDir)).onboardingCompleted).toBe(true);
    await writeFile(
      path.join(dataDir, 'app-config.json'),
      JSON.stringify({ onboardingCompleted: false }),
    );
    expect(readAppConfigSync(dataDir).onboardingCompleted).toBe(false);
    expect((await readAppConfig(dataDir)).onboardingCompleted).toBe(false);
  });
});

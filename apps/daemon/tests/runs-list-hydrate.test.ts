// `GET /api/runs` hydrates a full strategy-task projection per run
// (SQLite N+1 + canonical-XML bundle parse on the event loop). The pet task
// center polls this listing every 2s from every open tab and only reads
// `status`/`projectId`/`updatedAt`, so it needs a light mode that skips the
// hydration: `?hydrate=none` must return runs without `strategyTask` while
// the default listing keeps it.

import http from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  closeDatabase,
  getWorkspaceProject,
  getWorkspaceProjectByProjectId,
  ensureWorkspaceProject,
  insertProject,
  openDatabase,
} from '../src/db.js';
import { registerRunRoutes } from '../src/routes/runs.js';
import { connectorService } from '../src/connectors/service.js';

let server: http.Server | null = null;
let tempDir: string | null = null;

afterEach(async () => {
  if (server) {
    const toClose = server;
    server = null;
    await new Promise<void>((resolve) => toClose.close(() => resolve()));
  }
  closeDatabase();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

const UNBOUND_PROJECT = 'p-unbound-hydrate';
const TERMINAL = new Set(['succeeded', 'failed', 'canceled']);

function sendApiError(
  res: any,
  status: number,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  return res.status(status).json({ error: { code, message, ...details } });
}

async function startServer() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-runs-hydrate-'));
  const db = openDatabase(tempDir);
  const now = Date.now();
  insertProject(db, { id: UNBOUND_PROJECT, name: UNBOUND_PROJECT, createdAt: now, updatedAt: now });

  const runs = new Map<string, any>();
  runs.set('run-hydrate-running', {
    id: 'run-hydrate-running',
    projectId: UNBOUND_PROJECT,
    agentId: 'claude',
    status: 'running',
    conversationId: 'conv-hydrate',
    events: [],
    clients: new Set(),
    // Simulates the lifecycle projection `onEventEmitted` attaches to live
    // in-memory runs: the heavy payload light pollers must not pay for.
    strategyTask: { marker: 'heavy-projection' },
  });

  const runsService = {
    get: (id: string) => runs.get(id) ?? null,
    list: (filters: { projectId?: unknown; status?: unknown } = {}) =>
      Array.from(runs.values()).filter(
        (run) =>
          (typeof filters.projectId !== 'string' || run.projectId === filters.projectId)
          && (filters.status !== 'active' || !TERMINAL.has(run.status)),
      ),
    statusBody: (run: any) => ({ ...run }),
    isTerminal: (status: string) => TERMINAL.has(status),
  };

  const app = express();
  app.use(express.json());
  registerRunRoutes(app, {
    db,
    design: {
      runs: runsService,
      analytics: { capture: () => {} },
      getAppVersion: () => 'test',
    },
    http: {
      createSseResponse: () => ({ send() {}, end() {}, cleanup() {} }),
      sendApiError,
    },
    paths: { PROJECTS_DIR: tempDir, RUNTIME_DATA_DIR: tempDir },
    agents: { detectAgents: async () => [], getAgentDef: () => null },
    chat: { startChatRun: async () => undefined },
    byokCredentials: { has: async () => false },
    lifecycle: { isDaemonShuttingDown: () => false },
    plugins: {
      connectorService,
      detectSkillPluginCandidateOnRunSuccess: () => {},
      firePipelineForRun: () => {},
      loadPluginRegistryView: async () => ({} as any),
      renderPluginBriefTemplate: (template: string) => template,
    },
    telemetry: {
      reportRunCompletionTelemetryFallback: () => {},
      resolveRunProjectKindForAnalytics: () => null,
      runArtifactBaselines: { take: () => undefined },
      runRetryEventsForAnalytics: () => [],
    },
    messages: {
      pinAssistantMessageOnRunCreate: () => ({ ok: true }),
      reconcileAssistantMessageOnRunEnd: () => {},
    },
    amrWorkspaceScope: { isSignedIn: () => false },
    projectStore: {
      getWorkspaceProject,
      getWorkspaceProjectByProjectId,
      ensureWorkspaceProject: (dbArg: any, input: any) => ensureWorkspaceProject(dbArg, input),
    },
  } as any);
  const created = http.createServer(app);
  server = created;
  await new Promise<void>((resolve) => created.listen(0, '127.0.0.1', resolve));
  const address = created.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { baseUrl: `http://127.0.0.1:${port}` };
}

describe('GET /api/runs ?hydrate=none', () => {
  it('keeps the strategyTask projection by default', async () => {
    const { baseUrl } = await startServer();
    const resp = await fetch(`${baseUrl}/api/runs?projectId=${UNBOUND_PROJECT}`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { runs: Array<Record<string, unknown>> };
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).toHaveProperty('strategyTask');
  });

  it('omits the strategyTask projection with hydrate=none', async () => {
    const { baseUrl } = await startServer();
    const resp = await fetch(`${baseUrl}/api/runs?projectId=${UNBOUND_PROJECT}&hydrate=none`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { runs: Array<Record<string, unknown>> };
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).not.toHaveProperty('strategyTask');
    expect(body.runs[0]).toMatchObject({ id: 'run-hydrate-running', status: 'running' });
  });
});

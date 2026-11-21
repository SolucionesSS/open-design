import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  closeDatabase,
  insertConversation,
  insertProject,
  listConversationsAwaitingInput,
  listProjectsAwaitingInput,
  openDatabase,
  upsertMessage,
} from '../src/db.js';

// Improvement 3: the awaiting-input scans accept an id scope so hot routes
// (/api/runs every 4s, /api/projects) only scan the partitions they render.
// Scoped results must equal the unscoped result intersected with the scope.
const FORM =
  'Pick one <question-form>{"questions":[{"id":"a","label":"A?"}]}</question-form>';

let tempDir: string | null = null;

afterEach(() => {
  closeDatabase();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function seed() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-awaiting-scope-'));
  const db = openDatabase(tempDir);
  const now = Date.now();
  for (const id of ['p-asked', 'p-answered', 'p-quiet']) {
    insertProject(db, { id, name: id, createdAt: now, updatedAt: now });
  }
  insertConversation(db, { id: 'conv-asked', projectId: 'p-asked', createdAt: 1, updatedAt: 1 });
  upsertMessage(db, 'conv-asked', {
    id: 'm-ask', role: 'assistant', content: FORM, createdAt: 10,
  });
  insertConversation(db, { id: 'conv-answered', projectId: 'p-answered', createdAt: 1, updatedAt: 1 });
  upsertMessage(db, 'conv-answered', {
    id: 'm-ask2', role: 'assistant', content: FORM, createdAt: 10,
  });
  upsertMessage(db, 'conv-answered', {
    id: 'm-reply', role: 'user', content: 'done', createdAt: 20,
  });
  insertConversation(db, { id: 'conv-quiet', projectId: 'p-quiet', createdAt: 1, updatedAt: 1 });
  return db;
}

describe('awaiting-input scoping', () => {
  it('scopes project results to the given ids', () => {
    const db = seed();
    expect(listProjectsAwaitingInput(db)).toEqual(new Set(['p-asked']));
    expect(listProjectsAwaitingInput(db, ['p-asked'])).toEqual(new Set(['p-asked']));
    expect(listProjectsAwaitingInput(db, ['p-quiet', 'p-answered'])).toEqual(new Set());
    expect(listProjectsAwaitingInput(db, [])).toEqual(new Set());
  });

  it('scopes conversation results to the given ids', () => {
    const db = seed();
    expect(listConversationsAwaitingInput(db)).toEqual(new Set(['conv-asked']));
    expect(listConversationsAwaitingInput(db, ['conv-asked'])).toEqual(new Set(['conv-asked']));
    expect(listConversationsAwaitingInput(db, ['conv-quiet'])).toEqual(new Set());
    expect(listConversationsAwaitingInput(db, [])).toEqual(new Set());
  });
});

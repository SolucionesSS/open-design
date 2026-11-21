import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { insertSnapshotIntent, markSnapshotReady, migrateChatArtifacts, replaceMessageArtifacts } from '../src/chat-artifacts/store.js';
import { projectChatArtifactRefs, projectConversationChatArtifactRefs } from '../src/chat-artifacts/refs.js';
import { closeDatabase, insertConversation, insertProject, openDatabase } from '../src/db.js';

// Improvement 4: conversation refs bulk-fetch snapshots in one query instead
// of one per artifact row. The bulk path must agree with the per-message path.
let tempDir: string | null = null;

afterEach(() => {
  closeDatabase();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function seed() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-refs-bulk-'));
  const db = openDatabase(tempDir);
  migrateChatArtifacts(db);
  const now = Date.now();
  insertProject(db, { id: 'proj', name: 'proj', createdAt: now, updatedAt: now });
  insertConversation(db, { id: 'conv', projectId: 'proj', createdAt: 1, updatedAt: 1 });
  for (const [i, snapshotId] of (['snap-1', 'snap-2'] as const).entries()) {
    const messageId = `msg-${i}`;
    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, position, created_at)
       VALUES (?, 'conv', 'assistant', '', ?, ?)`,
    ).run(messageId, i, now);
    insertSnapshotIntent(db, {
      id: snapshotId, projectId: 'proj', sourcePathAtCapture: `shot-${i}.png`, kind: 'image',
      tempKey: null,
    });
    markSnapshotReady(db, { id: snapshotId, contentDigest: `content-${i}`, thumbnailDigest: `thumb-${i}` });
    replaceMessageArtifacts(db, messageId, [{
      label: `shot-${i}.png`, kind: 'image', displayPolicy: 'immutable_snapshot', snapshotId,
    }]);
  }
  return db;
}

describe('conversation chat-artifact refs', () => {
  it('resolves snapshot urls for every message and matches the per-message path', () => {
    const db = seed();
    const grouped = projectConversationChatArtifactRefs(db, 'proj', 'conv');
    expect([...grouped.keys()].sort()).toEqual(['msg-0', 'msg-1']);
    for (const [messageId, refs] of grouped) {
      expect(refs).toHaveLength(1);
      expect(refs[0]!.snapshotState).toBe('ready');
      expect(refs[0]!.snapshotUrl).toContain(refs[0]!.snapshotId!);
      expect(refs[0]!.thumbnailUrl).toBeTruthy();
      expect(refs).toEqual(projectChatArtifactRefs(db, 'proj', messageId));
    }
  });
});

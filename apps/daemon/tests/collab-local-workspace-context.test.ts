// The local/dev workspace authority must not fabricate a display name.
// Synthesizing `workspaceName` from the workspace id makes every consumer's
// "missing name" detection fail: the rail shows a truncated id instead of
// the persisted/directory name, and `enrichVerifiedWorkspaceContext` keeps
// the placeholder over Vela's real name.

import { describe, expect, it } from 'vitest';

import { synthesizeLocalWorkspaceContextFromClaimed } from '../src/collab/request-workspace-context.js';
import {
  enrichVerifiedWorkspaceContext,
  verifiedWorkspaceNameOrNull,
} from '../src/routes/collab-context.js';

const CLAIMED = {
  workspaceId: 'e5lwx06xmcqt8msimaguq11i',
  workspaceType: 'personal' as const,
  workspaceMemberId: 'zedzt5uz1326ly995hjv2o4e',
  role: 'owner' as const,
  memberStatus: 'active' as const,
  lifecycleState: 'active' as const,
};

describe('synthesizeLocalWorkspaceContextFromClaimed', () => {
  it('does not fabricate workspaceName from the workspace id', () => {
    const context = synthesizeLocalWorkspaceContextFromClaimed(CLAIMED);
    expect(context.workspaceId).toBe('e5lwx06xmcqt8msimaguq11i');
    expect(context).not.toHaveProperty('workspaceName');
  });
});

describe('verifiedWorkspaceNameOrNull', () => {
  it('treats a missing name as missing', () => {
    expect(verifiedWorkspaceNameOrNull({ workspaceId: 'w' })).toBeNull();
    expect(verifiedWorkspaceNameOrNull({ workspaceId: 'w', workspaceName: '  ' })).toBeNull();
  });

  it('treats an id-valued name as missing', () => {
    expect(
      verifiedWorkspaceNameOrNull({ workspaceId: 'e5lwx06xmcqt8msimaguq11i', workspaceName: 'e5lwx06xmcqt8msimaguq11i' }),
    ).toBeNull();
  });

  it('keeps a real name', () => {
    expect(
      verifiedWorkspaceNameOrNull({ workspaceId: 'e5lwx06xmcqt8msimaguq11i', workspaceName: 'Soluciones SS' }),
    ).toBe('Soluciones SS');
  });
});

describe('enrichVerifiedWorkspaceContext', () => {
  const base = (overrides: Record<string, unknown> = {}) => ({
    workspaceId: 'e5lwx06xmcqt8msimaguq11i',
    workspaceType: 'personal' as const,
    workspaceMemberId: 'zedzt5uz1326ly995hjv2o4e',
    role: 'owner' as const,
    memberStatus: 'active' as const,
    lifecycleState: 'active' as const,
    billingState: 'active' as const,
    planId: null,
    providerMode: 'platform_credits' as const,
    seatSummary: { seatLimit: 0, usedSeats: 0, availableSeats: 0, isSeatFull: true },
    permissions: {
      canManageMembers: true, canManageBilling: true, canInviteMembers: true,
      canManageAutoRecharge: true, canShareProjects: true, canWriteSyncedFiles: true,
      canViewWorkspaceSettings: true, canManageSharedResources: true,
    },
    ...overrides,
  });

  it('keeps the enriched directory name over an id placeholder', () => {
    const verified = base({ workspaceName: 'e5lwx06xmcqt8msimaguq11i' });
    const enriched = base({ workspaceName: 'Soluciones SS' });
    expect(enrichVerifiedWorkspaceContext(verified as never, enriched as never)).toMatchObject({
      workspaceName: 'Soluciones SS',
    });
  });

  it('keeps a real verified name over the enriched one', () => {
    const verified = base({ workspaceName: 'Soluciones SS' });
    const enriched = base({ workspaceName: 'Other' });
    expect(enrichVerifiedWorkspaceContext(verified as never, enriched as never)).toMatchObject({
      workspaceName: 'Soluciones SS',
    });
  });
});

// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
  lastKnownWorkspaceName,
  rememberWorkspaceName,
  resetWorkspaceNamesForTests,
} from '../../src/collab/workspace-names';

describe('workspace names', () => {
  afterEach(() => {
    resetWorkspaceNamesForTests();
    window.localStorage.clear();
  });

  it('returns nothing when nothing was stored', () => {
    expect(lastKnownWorkspaceName('ws-1')).toBeNull();
  });

  it('remembers a real name and replays it', () => {
    rememberWorkspaceName('e5lwx06xmcqt8msimaguq11i', 'Soluciones SS');
    expect(lastKnownWorkspaceName('e5lwx06xmcqt8msimaguq11i')).toBe('Soluciones SS');
  });

  it('refuses to remember an id as a name', () => {
    rememberWorkspaceName('e5lwx06xmcqt8msimaguq11i', 'e5lwx06xmcqt8msimaguq11i');
    rememberWorkspaceName('e5lwx06xmcqt8msimaguq11i', '  ');
    expect(lastKnownWorkspaceName('e5lwx06xmcqt8msimaguq11i')).toBeNull();
  });

  it('keeps the newest real name', () => {
    rememberWorkspaceName('ws-1', 'Old');
    rememberWorkspaceName('ws-1', 'New');
    expect(lastKnownWorkspaceName('ws-1')).toBe('New');
  });
});

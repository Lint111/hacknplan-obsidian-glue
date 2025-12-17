/**
 * Jest tests for Conflict Resolver
 */

import { ConflictResolver } from '../conflict-resolver.js';
import type { FileSyncState } from '../../core/types.js';

const resolver = new ConflictResolver();

describe('ConflictResolver.detectConflict', () => {
  test('first sync has no conflict', () => {
    const result = resolver.detectConflict(
      Date.now(),
      new Date().toISOString(),
      undefined // No sync state = first sync
    );

    expect(result.hasConflict).toBe(false);
    expect(result.strategy).toBe('vault-wins');
    expect(result.reason).toContain('First sync');
    expect(result.changedSources?.length).toBe(0);
  });

  test('neither changed since last sync', () => {
    const now = Date.now();
    const isoNow = new Date(now).toISOString();

    const syncState: FileSyncState = {
      lastSynced: isoNow,
      vaultMtime: now,
      hacknplanUpdatedAt: isoNow,
      hacknplanId: 123,
    };

    const result = resolver.detectConflict(now, isoNow, syncState);

    expect(result.hasConflict).toBe(false);
    expect(result.changedSources?.length).toBe(0);
    expect(result.reason).toContain('No changes');
  });

  test('only vault changed since last sync', () => {
    const syncTime = Date.now() - 60000; // 1 minute ago
    const currentTime = Date.now();
    const syncIso = new Date(syncTime).toISOString();

    const syncState: FileSyncState = {
      lastSynced: syncIso,
      vaultMtime: syncTime,
      hacknplanUpdatedAt: syncIso,
      hacknplanId: 123,
    };

    const result = resolver.detectConflict(currentTime, syncIso, syncState);

    expect(result.hasConflict).toBe(false);
    expect(result.strategy).toBe('vault-wins');
    expect(result.changedSources).toEqual(['vault']);
    expect(result.reason).toContain('Only vault changed');
  });

  test('only HacknPlan changed since last sync', () => {
    const syncTime = Date.now() - 60000;
    const currentTime = Date.now();
    const syncIso = new Date(syncTime).toISOString();
    const currentIso = new Date(currentTime).toISOString();

    const syncState: FileSyncState = {
      lastSynced: syncIso,
      vaultMtime: syncTime,
      hacknplanUpdatedAt: syncIso,
      hacknplanId: 123,
    };

    const result = resolver.detectConflict(syncTime, currentIso, syncState);

    expect(result.hasConflict).toBe(false);
    expect(result.strategy).toBe('hacknplan-wins');
    expect(result.changedSources).toEqual(['hacknplan']);
    expect(result.reason).toContain('Only HacknPlan changed');
  });

  test('both changed = conflict', () => {
    const syncTime = Date.now() - 60000;
    const vaultTime = Date.now() - 30000;
    const hacknplanTime = Date.now() - 15000;
    const syncIso = new Date(syncTime).toISOString();
    const hacknplanIso = new Date(hacknplanTime).toISOString();

    const syncState: FileSyncState = {
      lastSynced: syncIso,
      vaultMtime: syncTime,
      hacknplanUpdatedAt: syncIso,
      hacknplanId: 123,
    };

    const result = resolver.detectConflict(vaultTime, hacknplanIso, syncState);

    expect(result.hasConflict).toBe(true);
    expect(result.strategy).toBe('manual-merge');
    expect(result.changedSources).toContain('vault');
    expect(result.changedSources).toContain('hacknplan');
    expect(result.reason).toContain('Both');
  });

  test('timestamp tolerance - small changes ignored', () => {
    const now = Date.now();
    const isoNow = new Date(now).toISOString();

    const syncState: FileSyncState = {
      lastSynced: isoNow,
      vaultMtime: now,
      hacknplanUpdatedAt: isoNow,
      hacknplanId: 123,
    };

    const result = resolver.detectConflict(
      now + 1000,
      new Date(now + 2000).toISOString(),
      syncState
    );

    expect(result.hasConflict).toBe(false);
    expect(result.changedSources?.length).toBe(0);
  });

  test('very old sync state with both changes = conflict', () => {
    const veryOldTime = Date.now() - 365 * 24 * 60 * 60 * 1000; // 1 year ago
    const currentTime = Date.now();
    const oldIso = new Date(veryOldTime).toISOString();
    const currentIso = new Date(currentTime).toISOString();

    const syncState: FileSyncState = {
      lastSynced: oldIso,
      vaultMtime: veryOldTime,
      hacknplanUpdatedAt: oldIso,
      hacknplanId: 123,
    };

    const result = resolver.detectConflict(currentTime, currentIso, syncState);

    expect(result.hasConflict).toBe(true);
  });
});

describe('ConflictResolver.generateContentDiff', () => {
  test('generates diff for different content', () => {
    const vaultContent = `# My Document

This is the vault version.
It has some unique content.`;

    const hacknplanContent = `# My Document

This is the HacknPlan version.
It has different content.`;

    const diff = resolver.generateContentDiff(vaultContent, hacknplanContent);

    expect(diff).toContain('--- HacknPlan');
    expect(diff).toContain('+++ Vault');
    expect(diff).toContain('-This is the HacknPlan version');
    expect(diff).toContain('+This is the vault version');
  });

  test('identical content produces no change markers', () => {
    const content = `# Same Content

Both versions are the same.`;

    const diff = resolver.generateContentDiff(content, content);

    expect(diff).not.toContain('-#');
    expect(diff).not.toContain('+#');
  });

  test('multi-line diff shows all changes', () => {
    const vaultContent = `Line 1
Line 2 modified in vault
Line 3
New line 4`;

    const hacknplanContent = `Line 1
Line 2 modified in hacknplan
Line 3`;

    const diff = resolver.generateContentDiff(vaultContent, hacknplanContent);

    expect(diff).toContain('-Line 2 modified in hacknplan');
    expect(diff).toContain('+Line 2 modified in vault');
    expect(diff).toContain('+New line 4');
  });

  test('handles empty content', () => {
    const diff = resolver.generateContentDiff('', '');
    expect(typeof diff).toBe('string');
  });

  test('handles whitespace-only differences', () => {
    const vaultContent = 'Line 1\nLine 2';
    const hacknplanContent = 'Line 1\nLine 2\n';

    const diff = resolver.generateContentDiff(vaultContent, hacknplanContent);
    expect(typeof diff).toBe('string');
  });
});

describe('ConflictResolver.resolveConflict', () => {
  test('vault-wins strategy', () => {
    const vaultContent = 'Vault content wins';
    const hacknplanContent = 'HacknPlan content loses';

    const result = resolver.resolveConflict('vault-wins', vaultContent, hacknplanContent);

    expect(result.winner).toBe('vault');
    expect(result.content).toBe(vaultContent);
    expect(result.summary).toContain('Vault');
  });

  test('hacknplan-wins strategy', () => {
    const vaultContent = 'Vault content loses';
    const hacknplanContent = 'HacknPlan content wins';

    const result = resolver.resolveConflict('hacknplan-wins', vaultContent, hacknplanContent);

    expect(result.winner).toBe('hacknplan');
    expect(result.content).toBe(hacknplanContent);
    expect(result.summary).toContain('HacknPlan');
  });

  test('manual-merge strategy creates conflict markers', () => {
    const vaultContent = 'Vault version';
    const hacknplanContent = 'HacknPlan version';

    const result = resolver.resolveConflict('manual-merge', vaultContent, hacknplanContent);

    expect(result.winner).toBe('vault');
    expect(result.content).toContain('<<<<<<< VAULT');
    expect(result.content).toContain('=======');
    expect(result.content).toContain('>>>>>>> HACKNPLAN');
    expect(result.content).toContain(vaultContent);
    expect(result.content).toContain(hacknplanContent);
    expect(result.summary).toContain('Manual merge');
  });
});

describe('ConflictResolver.detectConflictWithDiff', () => {
  test('includes diff on conflict', () => {
    const syncTime = Date.now() - 60000;
    const vaultTime = Date.now() - 30000;
    const hacknplanTime = Date.now() - 15000;
    const syncIso = new Date(syncTime).toISOString();
    const hacknplanIso = new Date(hacknplanTime).toISOString();

    const syncState: FileSyncState = {
      lastSynced: syncIso,
      vaultMtime: syncTime,
      hacknplanUpdatedAt: syncIso,
      hacknplanId: 123,
    };

    const vaultContent = 'Vault content';
    const hacknplanContent = 'HacknPlan content';

    const result = resolver.detectConflictWithDiff(
      vaultTime,
      hacknplanIso,
      syncState,
      vaultContent,
      hacknplanContent
    );

    expect(result.hasConflict).toBe(true);
    expect(result.contentDiff).toBeDefined();
    expect(result.contentDiff).toContain('+Vault content');
  });

  test('no diff when no conflict', () => {
    const now = Date.now();
    const isoNow = new Date(now).toISOString();

    const syncState: FileSyncState = {
      lastSynced: isoNow,
      vaultMtime: now,
      hacknplanUpdatedAt: isoNow,
      hacknplanId: 123,
    };

    const result = resolver.detectConflictWithDiff(
      now,
      isoNow,
      syncState,
      'Some content',
      'Other content'
    );

    expect(result.hasConflict).toBe(false);
    expect(result.contentDiff).toBeUndefined();
  });
});

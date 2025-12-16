/**
 * Tests for Conflict Resolver
 *
 * Run with: npx tsx src/lib/__tests__/conflict-resolver.test.ts
 */

import { ConflictResolver } from '../conflict-resolver.js';
import type { FileSyncState } from '../../core/types.js';

// Simple assertion helper
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`PASS: ${message}`);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const resolver = new ConflictResolver();

// ============ Test Cases ============

console.log('\n=== detectConflict Tests ===\n');

// Test 1: First sync - no sync state
{
  const result = resolver.detectConflict(
    Date.now(),
    new Date().toISOString(),
    undefined // No sync state = first sync
  );

  assert(result.hasConflict === false, 'First sync has no conflict');
  assert(result.strategy === 'vault-wins', 'First sync defaults to vault-wins');
  assert(result.reason.includes('First sync'), 'First sync reason is clear');
  assert(result.changedSources?.length === 0, 'First sync has no changed sources');
}

// Test 2: Neither changed since last sync
{
  const now = Date.now();
  const isoNow = new Date(now).toISOString();

  const syncState: FileSyncState = {
    lastSynced: isoNow,
    vaultMtime: now,
    hacknplanUpdatedAt: isoNow,
    hacknplanId: 123,
  };

  const result = resolver.detectConflict(now, isoNow, syncState);

  assert(result.hasConflict === false, 'No changes = no conflict');
  assert(result.changedSources?.length === 0, 'No changed sources when nothing changed');
  assert(result.reason.includes('No changes'), 'No changes reason is clear');
}

// Test 3: Only vault changed since last sync
{
  const syncTime = Date.now() - 60000; // 1 minute ago
  const currentTime = Date.now();
  const syncIso = new Date(syncTime).toISOString();

  const syncState: FileSyncState = {
    lastSynced: syncIso,
    vaultMtime: syncTime,
    hacknplanUpdatedAt: syncIso,
    hacknplanId: 123,
  };

  // Vault changed (current time), HacknPlan unchanged (sync time)
  const result = resolver.detectConflict(currentTime, syncIso, syncState);

  assert(result.hasConflict === false, 'Only vault changed = no conflict');
  assert(result.strategy === 'vault-wins', 'Only vault changed = vault-wins');
  assert(deepEqual(result.changedSources, ['vault']), 'Only vault in changed sources');
  assert(result.reason.includes('Only vault changed'), 'Vault-only change reason is clear');
}

// Test 4: Only HacknPlan changed since last sync
{
  const syncTime = Date.now() - 60000; // 1 minute ago
  const currentTime = Date.now();
  const syncIso = new Date(syncTime).toISOString();
  const currentIso = new Date(currentTime).toISOString();

  const syncState: FileSyncState = {
    lastSynced: syncIso,
    vaultMtime: syncTime,
    hacknplanUpdatedAt: syncIso,
    hacknplanId: 123,
  };

  // Vault unchanged (sync time), HacknPlan changed (current time)
  const result = resolver.detectConflict(syncTime, currentIso, syncState);

  assert(result.hasConflict === false, 'Only HacknPlan changed = no conflict');
  assert(result.strategy === 'hacknplan-wins', 'Only HacknPlan changed = hacknplan-wins');
  assert(deepEqual(result.changedSources, ['hacknplan']), 'Only hacknplan in changed sources');
  assert(result.reason.includes('Only HacknPlan changed'), 'HacknPlan-only change reason is clear');
}

// Test 5: BOTH changed since last sync = CONFLICT
{
  const syncTime = Date.now() - 60000; // 1 minute ago
  const vaultTime = Date.now() - 30000; // 30 seconds ago
  const hacknplanTime = Date.now() - 15000; // 15 seconds ago
  const syncIso = new Date(syncTime).toISOString();
  const hacknplanIso = new Date(hacknplanTime).toISOString();

  const syncState: FileSyncState = {
    lastSynced: syncIso,
    vaultMtime: syncTime,
    hacknplanUpdatedAt: syncIso,
    hacknplanId: 123,
  };

  // Both changed since sync
  const result = resolver.detectConflict(vaultTime, hacknplanIso, syncState);

  assert(result.hasConflict === true, 'Both changed = CONFLICT');
  assert(result.strategy === 'manual-merge', 'Both changed = manual-merge strategy');
  assert(
    Boolean(result.changedSources?.includes('vault') && result.changedSources?.includes('hacknplan')),
    'Both sources in changed sources'
  );
  assert(result.reason.includes('Both'), 'Both changed reason is clear');
}

// Test 6: Timestamp tolerance - small changes within tolerance
{
  const now = Date.now();
  const isoNow = new Date(now).toISOString();

  const syncState: FileSyncState = {
    lastSynced: isoNow,
    vaultMtime: now,
    hacknplanUpdatedAt: isoNow,
    hacknplanId: 123,
  };

  // Small difference within 5 second tolerance
  const result = resolver.detectConflict(now + 1000, new Date(now + 2000).toISOString(), syncState);

  assert(result.hasConflict === false, 'Small timestamp diff within tolerance = no conflict');
  assert(result.changedSources?.length === 0, 'Small diff not counted as change');
}

console.log('\n=== generateContentDiff Tests ===\n');

// Test 7: Generate diff for different content
{
  const vaultContent = `# My Document

This is the vault version.
It has some unique content.`;

  const hacknplanContent = `# My Document

This is the HacknPlan version.
It has different content.`;

  const diff = resolver.generateContentDiff(vaultContent, hacknplanContent);

  assert(diff.includes('--- HacknPlan'), 'Diff has HacknPlan header');
  assert(diff.includes('+++ Vault'), 'Diff has Vault header');
  assert(diff.includes('-This is the HacknPlan version'), 'Diff shows removed HacknPlan line');
  assert(diff.includes('+This is the vault version'), 'Diff shows added Vault line');
}

// Test 8: Identical content produces no change markers
{
  const content = `# Same Content

Both versions are the same.`;

  const diff = resolver.generateContentDiff(content, content);

  assert(!diff.includes('-#'), 'No removed lines for identical content');
  assert(!diff.includes('+#'), 'No added lines for identical content');
}

// Test 9: Multi-line diff
{
  const vaultContent = `Line 1
Line 2 modified in vault
Line 3
New line 4`;

  const hacknplanContent = `Line 1
Line 2 modified in hacknplan
Line 3`;

  const diff = resolver.generateContentDiff(vaultContent, hacknplanContent);

  assert(diff.includes('-Line 2 modified in hacknplan'), 'Shows HacknPlan version');
  assert(diff.includes('+Line 2 modified in vault'), 'Shows Vault version');
  assert(diff.includes('+New line 4'), 'Shows added line in vault');
}

console.log('\n=== resolveConflict Tests ===\n');

// Test 10: vault-wins strategy
{
  const vaultContent = 'Vault content wins';
  const hacknplanContent = 'HacknPlan content loses';

  const result = resolver.resolveConflict('vault-wins', vaultContent, hacknplanContent);

  assert(result.winner === 'vault', 'Winner is vault');
  assert(result.content === vaultContent, 'Content is vault content');
  assert(result.summary.includes('Vault'), 'Summary mentions vault');
}

// Test 11: hacknplan-wins strategy
{
  const vaultContent = 'Vault content loses';
  const hacknplanContent = 'HacknPlan content wins';

  const result = resolver.resolveConflict('hacknplan-wins', vaultContent, hacknplanContent);

  assert(result.winner === 'hacknplan', 'Winner is hacknplan');
  assert(result.content === hacknplanContent, 'Content is HacknPlan content');
  assert(result.summary.includes('HacknPlan'), 'Summary mentions HacknPlan');
}

// Test 12: manual-merge strategy creates conflict markers
{
  const vaultContent = 'Vault version';
  const hacknplanContent = 'HacknPlan version';

  const result = resolver.resolveConflict('manual-merge', vaultContent, hacknplanContent);

  assert(result.winner === 'vault', 'Manual merge returns vault as winner for file');
  assert(result.content.includes('<<<<<<< VAULT'), 'Has vault conflict marker');
  assert(result.content.includes('======='), 'Has separator marker');
  assert(result.content.includes('>>>>>>> HACKNPLAN'), 'Has hacknplan conflict marker');
  assert(result.content.includes(vaultContent), 'Contains vault content');
  assert(result.content.includes(hacknplanContent), 'Contains HacknPlan content');
  assert(result.summary.includes('Manual merge'), 'Summary mentions manual merge');
}

console.log('\n=== detectConflictWithDiff Tests ===\n');

// Test 13: Convenience method includes diff on conflict
{
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

  assert(result.hasConflict === true, 'Conflict detected');
  assert(result.contentDiff !== undefined, 'Diff included in result');
  assert(result.contentDiff!.includes('+Vault content'), 'Diff shows vault content');
}

// Test 14: No diff when no conflict
{
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

  assert(result.hasConflict === false, 'No conflict');
  assert(result.contentDiff === undefined, 'No diff when no conflict');
}

console.log('\n=== Edge Cases ===\n');

// Test 15: Empty content handling
{
  const diff = resolver.generateContentDiff('', '');
  assert(typeof diff === 'string', 'Empty content produces valid diff string');
}

// Test 16: Content with only whitespace differences
{
  const vaultContent = 'Line 1\nLine 2';
  const hacknplanContent = 'Line 1\nLine 2\n';

  const diff = resolver.generateContentDiff(vaultContent, hacknplanContent);
  assert(typeof diff === 'string', 'Whitespace diff produces valid string');
}

// Test 17: Very long ago sync state
{
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

  // Both changed (from very long ago)
  const result = resolver.detectConflict(currentTime, currentIso, syncState);

  assert(result.hasConflict === true, 'Very old sync state with both changes = conflict');
}

console.log('\n=== All Tests Passed! ===\n');

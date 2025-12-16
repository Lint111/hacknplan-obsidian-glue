/**
 * Conflict Resolution for HacknPlan-Obsidian Sync
 *
 * Phase 4 of the sync engine: Detects and resolves conflicts when both
 * vault and HacknPlan have been modified since last sync.
 *
 * Uses 3-way comparison:
 * - Vault file modification time vs last synced vault mtime
 * - HacknPlan updatedAt vs last synced HacknPlan timestamp
 * - Conflict detected when BOTH have changed since last sync
 */

import { diffLines, Change } from 'diff';
import type { FileSyncState } from '../core/types.js';

/**
 * Strategy for resolving conflicts
 */
export type ConflictStrategy = 'vault-wins' | 'hacknplan-wins' | 'manual-merge';

/**
 * Result of conflict detection
 */
export interface ConflictResult {
  /** True if both sources changed since last sync */
  hasConflict: boolean;
  /** Suggested resolution strategy */
  strategy: ConflictStrategy;
  /** Human-readable reason for the conflict state */
  reason: string;
  /** Vault file mtime (ms since epoch) */
  vaultTimestamp?: number;
  /** HacknPlan updatedAt ISO timestamp */
  hacknplanTimestamp?: string;
  /** Last synced timestamp (ISO) */
  lastSyncedTimestamp?: string;
  /** Unified diff if conflict detected and content provided */
  contentDiff?: string;
  /** Which source changed since last sync */
  changedSources?: ('vault' | 'hacknplan')[];
}

/**
 * Resolution result after applying a strategy
 */
export interface ResolutionResult {
  /** Which source won the resolution */
  winner: 'vault' | 'hacknplan';
  /** The content to use */
  content: string;
  /** Summary of what was resolved */
  summary: string;
}

/**
 * Conflict Resolver for bidirectional sync
 *
 * Implements 3-way comparison logic:
 * 1. No sync state = first sync, no conflict possible
 * 2. Only vault changed = safe to push to HacknPlan
 * 3. Only HacknPlan changed = safe to pull to vault
 * 4. Both changed = CONFLICT, needs resolution strategy
 */
export class ConflictResolver {
  /** Tolerance for timestamp comparison in milliseconds (5 seconds) */
  private static readonly TIMESTAMP_TOLERANCE_MS = 5000;

  /**
   * Detect if vault file and HacknPlan design element have conflicting changes
   *
   * @param vaultMtime - Current vault file modification time (ms since epoch)
   * @param hacknplanUpdatedAt - Current HacknPlan updatedAt timestamp (ISO string)
   * @param syncState - Last sync state (undefined = first sync)
   * @returns Conflict detection result
   */
  detectConflict(
    vaultMtime: number,
    hacknplanUpdatedAt: string,
    syncState: FileSyncState | undefined
  ): ConflictResult {
    // Case 1: No sync state = first sync, no conflict possible
    if (!syncState) {
      return {
        hasConflict: false,
        strategy: 'vault-wins',
        reason: 'First sync - no previous state to compare',
        vaultTimestamp: vaultMtime,
        hacknplanTimestamp: hacknplanUpdatedAt,
        changedSources: [],
      };
    }

    // Parse timestamps for comparison
    const lastSyncedVaultMtime = syncState.vaultMtime;
    const lastSyncedHacknplanTime = new Date(syncState.hacknplanUpdatedAt).getTime();
    const currentHacknplanTime = new Date(hacknplanUpdatedAt).getTime();

    // Detect which sources changed (with tolerance for clock drift)
    const vaultChanged = this.timestampChanged(vaultMtime, lastSyncedVaultMtime);
    const hacknplanChanged = this.timestampChanged(currentHacknplanTime, lastSyncedHacknplanTime);

    const changedSources: ('vault' | 'hacknplan')[] = [];
    if (vaultChanged) changedSources.push('vault');
    if (hacknplanChanged) changedSources.push('hacknplan');

    // Case 2: Neither changed = no action needed
    if (!vaultChanged && !hacknplanChanged) {
      return {
        hasConflict: false,
        strategy: 'vault-wins',
        reason: 'No changes since last sync',
        vaultTimestamp: vaultMtime,
        hacknplanTimestamp: hacknplanUpdatedAt,
        lastSyncedTimestamp: syncState.lastSynced,
        changedSources: [],
      };
    }

    // Case 3: Only vault changed = safe to push
    if (vaultChanged && !hacknplanChanged) {
      return {
        hasConflict: false,
        strategy: 'vault-wins',
        reason: 'Only vault changed since last sync - safe to push to HacknPlan',
        vaultTimestamp: vaultMtime,
        hacknplanTimestamp: hacknplanUpdatedAt,
        lastSyncedTimestamp: syncState.lastSynced,
        changedSources: ['vault'],
      };
    }

    // Case 4: Only HacknPlan changed = safe to pull
    if (!vaultChanged && hacknplanChanged) {
      return {
        hasConflict: false,
        strategy: 'hacknplan-wins',
        reason: 'Only HacknPlan changed since last sync - safe to pull to vault',
        vaultTimestamp: vaultMtime,
        hacknplanTimestamp: hacknplanUpdatedAt,
        lastSyncedTimestamp: syncState.lastSynced,
        changedSources: ['hacknplan'],
      };
    }

    // Case 5: BOTH changed = CONFLICT
    return {
      hasConflict: true,
      strategy: 'manual-merge',
      reason: 'Both vault and HacknPlan changed since last sync - manual resolution required',
      vaultTimestamp: vaultMtime,
      hacknplanTimestamp: hacknplanUpdatedAt,
      lastSyncedTimestamp: syncState.lastSynced,
      changedSources: ['vault', 'hacknplan'],
    };
  }

  /**
   * Compare vault and HacknPlan content to generate unified diff
   *
   * @param vaultContent - Current vault file content
   * @param hacknplanContent - Current HacknPlan description content
   * @returns Unified diff string showing changes
   */
  generateContentDiff(vaultContent: string, hacknplanContent: string): string {
    const changes: Change[] = diffLines(hacknplanContent, vaultContent);

    const lines: string[] = ['--- HacknPlan', '+++ Vault', ''];

    for (const change of changes) {
      const prefix = change.added ? '+' : change.removed ? '-' : ' ';
      const changeLines = change.value.split('\n');

      // Handle trailing newline
      for (let i = 0; i < changeLines.length; i++) {
        const line = changeLines[i];
        // Skip empty line at end caused by split
        if (i === changeLines.length - 1 && line === '') continue;
        lines.push(`${prefix}${line}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Resolve conflict based on strategy
   *
   * @param strategy - Resolution strategy to apply
   * @param vaultContent - Current vault file content
   * @param hacknplanContent - Current HacknPlan description content
   * @returns Resolution result with winning content
   */
  resolveConflict(
    strategy: ConflictStrategy,
    vaultContent: string,
    hacknplanContent: string
  ): ResolutionResult {
    switch (strategy) {
      case 'vault-wins':
        return {
          winner: 'vault',
          content: vaultContent,
          summary: 'Vault content selected - HacknPlan will be overwritten',
        };

      case 'hacknplan-wins':
        return {
          winner: 'hacknplan',
          content: hacknplanContent,
          summary: 'HacknPlan content selected - vault file will be overwritten',
        };

      case 'manual-merge':
        // For manual merge, return vault content with conflict markers
        // The caller should present this to the user for resolution
        const markedContent = this.createConflictMarkers(vaultContent, hacknplanContent);
        return {
          winner: 'vault',
          content: markedContent,
          summary: 'Manual merge required - conflict markers added to content',
        };
    }
  }

  /**
   * Create content with git-style conflict markers for manual resolution
   */
  private createConflictMarkers(vaultContent: string, hacknplanContent: string): string {
    return `<<<<<<< VAULT
${vaultContent}
=======
${hacknplanContent}
>>>>>>> HACKNPLAN`;
  }

  /**
   * Check if a timestamp has changed (with tolerance for clock drift)
   */
  private timestampChanged(current: number, lastSynced: number): boolean {
    return Math.abs(current - lastSynced) > ConflictResolver.TIMESTAMP_TOLERANCE_MS;
  }

  /**
   * Detect conflict and include content diff if conflict found
   *
   * Convenience method that combines detectConflict and generateContentDiff
   *
   * @param vaultMtime - Current vault file modification time
   * @param hacknplanUpdatedAt - Current HacknPlan updatedAt timestamp
   * @param syncState - Last sync state
   * @param vaultContent - Optional vault content for diff generation
   * @param hacknplanContent - Optional HacknPlan content for diff generation
   * @returns Conflict result with diff if conflict detected
   */
  detectConflictWithDiff(
    vaultMtime: number,
    hacknplanUpdatedAt: string,
    syncState: FileSyncState | undefined,
    vaultContent?: string,
    hacknplanContent?: string
  ): ConflictResult {
    const result = this.detectConflict(vaultMtime, hacknplanUpdatedAt, syncState);

    // Generate diff if conflict detected and content provided
    if (result.hasConflict && vaultContent !== undefined && hacknplanContent !== undefined) {
      result.contentDiff = this.generateContentDiff(vaultContent, hacknplanContent);
    }

    return result;
  }
}

/**
 * Singleton instance for convenience
 */
export const conflictResolver = new ConflictResolver();

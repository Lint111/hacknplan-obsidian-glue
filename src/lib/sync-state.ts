/**
 * Sync State Manager - Tracks synchronization state for conflict detection
 *
 * Phase 3 of the sync engine: Provides timestamp tracking to enable
 * conflict detection in Phase 4.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { FileSyncState, SyncState } from '../core/types.js';

/**
 * Manages synchronization state for vault files
 *
 * Stores:
 * - Last sync timestamp per file
 * - Vault file modification time at sync
 * - HacknPlan updatedAt timestamp at sync
 * - HacknPlan design element ID (if linked)
 *
 * Enables Phase 4 conflict detection by comparing current timestamps
 * against last-synced values.
 */
export class SyncStateManager {
  private state: SyncState = {};
  private stateFilePath: string;
  private configDir: string;
  private dirty = false;

  constructor(configDir: string) {
    this.configDir = configDir;
    this.stateFilePath = path.join(configDir, '.sync-state.json');
  }

  /**
   * Load state from .sync-state.json
   * Creates empty state if file doesn't exist
   */
  async load(): Promise<void> {
    try {
      // Ensure config directory exists
      await fs.mkdir(this.configDir, { recursive: true });

      const data = await fs.readFile(this.stateFilePath, 'utf-8');
      const parsed = JSON.parse(data) as { version: string; state: SyncState };

      if (parsed.version && parsed.state) {
        this.state = parsed.state;
        console.error(`[glue] Loaded sync state: ${Object.keys(this.state).length} entries`);
      } else {
        // Legacy format or invalid - start fresh
        this.state = {};
        console.error('[glue] Invalid sync state format, starting fresh');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist - start fresh
        this.state = {};
        console.error('[glue] No sync state file, starting fresh');
      } else {
        console.error(`[glue] Failed to load sync state: ${(error as Error).message}`);
        this.state = {};
      }
    }
    this.dirty = false;
  }

  /**
   * Save state to .sync-state.json
   * Uses atomic write (write to temp, rename) to prevent corruption
   */
  async save(): Promise<void> {
    if (!this.dirty && Object.keys(this.state).length === 0) {
      return; // Nothing to save
    }

    try {
      // Ensure config directory exists
      await fs.mkdir(this.configDir, { recursive: true });

      const payload = JSON.stringify(
        {
          version: '1.0.0',
          savedAt: new Date().toISOString(),
          state: this.state,
        },
        null,
        2
      );

      // Atomic write: write to temp file, then rename
      const tempPath = `${this.stateFilePath}.tmp`;
      await fs.writeFile(tempPath, payload, 'utf-8');
      await fs.rename(tempPath, this.stateFilePath);

      this.dirty = false;
      console.error(`[glue] Saved sync state: ${Object.keys(this.state).length} entries`);
    } catch (error) {
      console.error(`[glue] Failed to save sync state: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Get sync state for a specific file
   */
  getSyncState(filePath: string): FileSyncState | undefined {
    return this.state[filePath];
  }

  /**
   * Update sync state for a file
   */
  updateSyncState(filePath: string, state: FileSyncState): void {
    this.state[filePath] = state;
    this.dirty = true;
  }

  /**
   * Clear sync state for a file (e.g., when unlinked)
   */
  clearSyncState(filePath: string): void {
    if (this.state[filePath]) {
      delete this.state[filePath];
      this.dirty = true;
    }
  }

  /**
   * Get all sync states (returns copy to prevent mutation)
   */
  getAllStates(): SyncState {
    return { ...this.state };
  }

  /**
   * Check if state has been modified since last save
   */
  isDirty(): boolean {
    return this.dirty;
  }

  /**
   * Get the path to the state file
   */
  getStateFilePath(): string {
    return this.stateFilePath;
  }

  /**
   * Get entry count for diagnostics
   */
  getEntryCount(): number {
    return Object.keys(this.state).length;
  }

  /**
   * Get entries by HacknPlan ID (for reverse lookup)
   */
  getByHacknPlanId(hacknplanId: number): { filePath: string; state: FileSyncState } | undefined {
    for (const [filePath, state] of Object.entries(this.state)) {
      if (state.hacknplanId === hacknplanId) {
        return { filePath, state };
      }
    }
    return undefined;
  }

  /**
   * Get all entries for a specific project (by HacknPlan ID prefix)
   */
  getEntriesForProject(projectId: number): Array<{ filePath: string; state: FileSyncState }> {
    const results: Array<{ filePath: string; state: FileSyncState }> = [];
    for (const [filePath, state] of Object.entries(this.state)) {
      // Note: We could add projectId to FileSyncState for more efficient filtering
      // For now, return all entries (caller filters by vault path)
      if (state.hacknplanId !== undefined) {
        results.push({ filePath, state });
      }
    }
    return results;
  }
}

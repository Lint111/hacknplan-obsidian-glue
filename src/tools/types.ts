/**
 * Tool handler type definitions
 */

import type { Pairing, FileSyncState } from '../core/types.js';
import type { HacknPlanClient } from '../core/client.js';
import type { FileWatcher } from '../lib/file-watcher.js';
import type { SyncQueue } from '../lib/sync-queue.js';

/**
 * Sync state operations exposed to tools
 */
export interface SyncStateOps {
  getSyncState: (filePath: string) => FileSyncState | undefined;
  updateSyncState: (filePath: string, state: FileSyncState) => void;
  clearSyncState: (filePath: string) => void;
  getByHacknPlanId: (id: number) => { filePath: string; state: FileSyncState } | undefined;
  saveSyncState: () => Promise<void>;
}

/**
 * Pairing store operations exposed to tools
 */
export interface PairingStore {
  get: (projectId: number) => Pairing | undefined;
  getByVault: (vaultPath: string) => Pairing | undefined;
  getAll: () => Pairing[];
  add: (pairing: Pairing) => void;
  remove: (projectId: number) => boolean;
  update: (projectId: number, updates: Partial<Pairing>) => Pairing | null;
  save: () => void;
}

/**
 * Tool handler context - provides access to pairing management, sync state, and file watcher
 */
export interface ToolContext {
  // Pairing operations
  getPairing: (projectId: number) => Pairing | undefined;
  getPairingByVault: (vaultPath: string) => Pairing | undefined;
  getAllPairings: () => Pairing[];
  addPairing: (pairing: Pairing) => void;
  removePairing: (projectId: number) => boolean;
  updatePairing: (projectId: number, updates: Partial<Pairing>) => Pairing | null;
  saveConfig: () => void;
  // Pairing store (Phase 6 - cleaner interface)
  pairingStore: PairingStore;
  // Sync state operations (Phase 3)
  syncState: SyncStateOps;
  // HacknPlan API client (Phase 5)
  hacknplanClient: HacknPlanClient | null;
  // File watcher (Phase 6)
  fileWatcher: FileWatcher;
  // Sync queue (Phase 7)
  syncQueue: SyncQueue | null;
}

/**
 * Tool handler function signature
 */
export type ToolHandler<TArgs = unknown, TResult = unknown> = (
  args: TArgs,
  context: ToolContext
) => Promise<TResult>;

/**
 * Tool definition with handler
 *
 * Uses `any` for TArgs to allow typed tool definitions to be assigned to
 * ToolDefinition[] arrays. The handler will still have proper type inference
 * at the definition site.
 */
export interface ToolDefinition<TArgs = any, TResult = unknown> {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: ToolHandler<TArgs, TResult>;
}

/**
 * Tool registry - maps tool names to handlers
 */
export type ToolRegistry = Map<string, ToolDefinition>;

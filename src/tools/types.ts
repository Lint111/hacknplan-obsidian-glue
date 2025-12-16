/**
 * Tool handler type definitions
 */

import type { Pairing, FileSyncState } from '../core/types.js';
import type { HacknPlanClient } from '../core/client.js';

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
 * Tool handler context - provides access to pairing management and sync state
 */
export interface ToolContext {
  getPairing: (projectId: number) => Pairing | undefined;
  getPairingByVault: (vaultPath: string) => Pairing | undefined;
  getAllPairings: () => Pairing[];
  addPairing: (pairing: Pairing) => void;
  removePairing: (projectId: number) => boolean;
  updatePairing: (projectId: number, updates: Partial<Pairing>) => Pairing | null;
  saveConfig: () => void;
  // Sync state operations (Phase 3)
  syncState: SyncStateOps;
  // HacknPlan API client (Phase 5)
  hacknplanClient: HacknPlanClient | null;
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

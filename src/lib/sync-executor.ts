/**
 * Sync Executor - Atomic execution of sync operations
 *
 * Phase 5 of the sync engine: Executes create/update operations against
 * HacknPlan API with atomic rollback support.
 */

import { promises as fs } from 'fs';
import { stat } from 'fs/promises';
import type {
  CreateOperation,
  UpdateOperation,
  SyncExecutionResult,
  Pairing,
  FileSyncState,
  SyncEventCallback,
  WorkItemCreatedEvent,
  WorkItemUpdatedEvent,
} from '../core/types.js';
import type { HacknPlanClient, HacknPlanDesignElement } from '../core/client.js';
import { updateFrontmatter, stripFrontmatter } from './frontmatter.js';
import { conflictResolver } from './conflict-resolver.js';
import type { SyncStateOps } from '../tools/types.js';

/**
 * Rollback entry for atomic operations
 */
interface RollbackEntry {
  type: 'frontmatter' | 'hacknplan-create' | 'sync-state';
  filePath?: string;
  originalContent?: string;
  hacknplanId?: number;
  projectId?: number;
}

/**
 * Update vault file frontmatter with new values
 *
 * Reads the file, merges updates into frontmatter, writes back atomically.
 * Returns original content for rollback if needed.
 *
 * @param filePath - Absolute path to markdown file
 * @param updates - Frontmatter fields to add/update
 * @returns Original file content for rollback
 */
export async function updateVaultFileFrontmatter(
  filePath: string,
  updates: Record<string, unknown>
): Promise<string> {
  const originalContent = await fs.readFile(filePath, 'utf-8');
  const updatedContent = updateFrontmatter(originalContent, updates);

  // Atomic write: temp file + rename
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, updatedContent, 'utf-8');
  await fs.rename(tempPath, filePath);

  return originalContent;
}

/**
 * Revert vault file to original content
 *
 * @param filePath - Absolute path to markdown file
 * @param originalContent - Original file content to restore
 */
export async function revertVaultFile(filePath: string, originalContent: string): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, originalContent, 'utf-8');
  await fs.rename(tempPath, filePath);
}

/**
 * Execute a single create operation
 *
 * 1. Create design element in HacknPlan
 * 2. Update vault file frontmatter with hacknplan_id
 * 3. Update sync state
 *
 * @param op - Create operation to execute
 * @param projectId - HacknPlan project ID
 * @param client - HacknPlan API client
 * @param syncState - Sync state manager
 * @param rollbackStack - Stack to push rollback entries onto
 * @returns Created element or null on failure
 */
export async function executeCreateOperation(
  op: CreateOperation,
  projectId: number,
  client: HacknPlanClient,
  syncState: SyncStateOps,
  rollbackStack: RollbackEntry[],
  onEvent?: SyncEventCallback
): Promise<{ element: HacknPlanDesignElement; error?: undefined } | { element?: undefined; error: string }> {
  let hacknplanElement: HacknPlanDesignElement | null = null;
  let originalFrontmatter: string | null = null;

  try {
    // Step 1: Create in HacknPlan
    hacknplanElement = await client.createDesignElement(projectId, {
      typeId: op.typeId,
      name: op.name,
      description: stripFrontmatter(op.description),
    });

    rollbackStack.push({
      type: 'hacknplan-create',
      hacknplanId: hacknplanElement.designElementId,
      projectId,
    });

    // Step 2: Update vault frontmatter
    originalFrontmatter = await updateVaultFileFrontmatter(op.sourceFile, {
      hacknplan_id: hacknplanElement.designElementId,
      hacknplan_project: projectId,
      synced_at: new Date().toISOString(),
    });

    rollbackStack.push({
      type: 'frontmatter',
      filePath: op.sourceFile,
      originalContent: originalFrontmatter,
    });

    // Step 3: Update sync state
    const fileStat = await stat(op.sourceFile);
    const syncStateEntry: FileSyncState = {
      lastSynced: new Date().toISOString(),
      vaultMtime: fileStat.mtimeMs,
      hacknplanUpdatedAt: hacknplanElement.updatedAt,
      hacknplanId: hacknplanElement.designElementId,
    };
    syncState.updateSyncState(op.sourceFile, syncStateEntry);

    rollbackStack.push({
      type: 'sync-state',
      filePath: op.sourceFile,
    });

    console.error(`[glue] Created: ${op.name} -> HacknPlan #${hacknplanElement.designElementId}`);

    // Emit work-item-created event
    if (onEvent && hacknplanElement) {
      const event: WorkItemCreatedEvent = {
        workItemId: hacknplanElement.designElementId,
        title: hacknplanElement.name,
        sourceFile: op.sourceFile,
        timestamp: new Date().toISOString(),
      };
      await onEvent(event);
    }

    return { element: hacknplanElement };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[glue] Create failed for ${op.sourceFile}: ${errorMessage}`);
    return { error: errorMessage };
  }
}

/**
 * Execute a single update operation
 *
 * 1. Update design element in HacknPlan
 * 2. Update sync state
 *
 * @param op - Update operation to execute
 * @param projectId - HacknPlan project ID
 * @param client - HacknPlan API client
 * @param syncState - Sync state manager
 * @param rollbackStack - Stack to push rollback entries onto
 * @returns Updated element or error
 */
export async function executeUpdateOperation(
  op: UpdateOperation,
  projectId: number,
  client: HacknPlanClient,
  syncState: SyncStateOps,
  rollbackStack: RollbackEntry[],
  onEvent?: SyncEventCallback
): Promise<{ element: HacknPlanDesignElement; error?: undefined } | { element?: undefined; error: string }> {
  try {
    // Step 1: Update in HacknPlan
    const hacknplanElement = await client.updateDesignElement(projectId, op.designElementId, {
      name: op.name,
      description: stripFrontmatter(op.description),
    });

    // Step 2: Update vault frontmatter with sync timestamp
    await updateVaultFileFrontmatter(op.sourceFile, {
      synced_at: new Date().toISOString(),
    });

    // Step 3: Update sync state
    const fileStat = await stat(op.sourceFile);
    const syncStateEntry: FileSyncState = {
      lastSynced: new Date().toISOString(),
      vaultMtime: fileStat.mtimeMs,
      hacknplanUpdatedAt: hacknplanElement.updatedAt,
      hacknplanId: hacknplanElement.designElementId,
    };
    syncState.updateSyncState(op.sourceFile, syncStateEntry);

    rollbackStack.push({
      type: 'sync-state',
      filePath: op.sourceFile,
    });

    console.error(`[glue] Updated: ${op.name} (HacknPlan #${op.designElementId})`);

    // Emit work-item-updated event
    if (onEvent && hacknplanElement) {
      const event: WorkItemUpdatedEvent = {
        workItemId: hacknplanElement.designElementId,
        title: hacknplanElement.name,
        sourceFile: op.sourceFile,
        changedFields: ['name', 'description'],
        timestamp: new Date().toISOString(),
      };
      await onEvent(event);
    }

    return { element: hacknplanElement };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[glue] Update failed for ${op.sourceFile}: ${errorMessage}`);
    return { error: errorMessage };
  }
}

/**
 * Rollback all operations in the stack
 *
 * @param rollbackStack - Stack of rollback entries to process
 * @param client - HacknPlan API client (for deleting created elements)
 * @param syncState - Sync state manager
 */
export async function rollbackOperations(
  rollbackStack: RollbackEntry[],
  client: HacknPlanClient | null,
  syncState: SyncStateOps
): Promise<void> {
  console.error(`[glue] Rolling back ${rollbackStack.length} operations...`);

  // Process in reverse order (LIFO)
  while (rollbackStack.length > 0) {
    const entry = rollbackStack.pop()!;

    try {
      switch (entry.type) {
        case 'frontmatter':
          if (entry.filePath && entry.originalContent) {
            await revertVaultFile(entry.filePath, entry.originalContent);
            console.error(`[glue] Reverted frontmatter: ${entry.filePath}`);
          }
          break;

        case 'hacknplan-create':
          // Optionally delete created HacknPlan element
          // This is aggressive rollback - may not always be desired
          if (client && entry.projectId && entry.hacknplanId) {
            try {
              await client.deleteDesignElement(entry.projectId, entry.hacknplanId);
              console.error(`[glue] Deleted HacknPlan element: #${entry.hacknplanId}`);
            } catch (deleteError) {
              console.error(`[glue] Failed to delete HacknPlan element #${entry.hacknplanId}: ${deleteError}`);
            }
          }
          break;

        case 'sync-state':
          if (entry.filePath) {
            syncState.clearSyncState(entry.filePath);
            console.error(`[glue] Cleared sync state: ${entry.filePath}`);
          }
          break;
      }
    } catch (rollbackError) {
      console.error(`[glue] Rollback failed for ${entry.type}: ${rollbackError}`);
    }
  }
}

/**
 * Check for conflict before executing operation
 *
 * @param sourceFile - Vault file path
 * @param syncState - Sync state operations
 * @param hacknplanUpdatedAt - Current HacknPlan timestamp (if known)
 * @returns ConflictResult
 */
export async function checkOperationConflict(
  sourceFile: string,
  syncState: SyncStateOps,
  hacknplanUpdatedAt?: string
): Promise<{ hasConflict: boolean; reason: string }> {
  const existingState = syncState.getSyncState(sourceFile);

  // No existing state = first sync, no conflict
  if (!existingState) {
    return { hasConflict: false, reason: 'First sync' };
  }

  // No HacknPlan timestamp = can't detect conflict
  if (!hacknplanUpdatedAt) {
    return { hasConflict: false, reason: 'No HacknPlan timestamp to compare' };
  }

  try {
    const fileStat = await stat(sourceFile);
    const conflictResult = conflictResolver.detectConflict(
      fileStat.mtimeMs,
      hacknplanUpdatedAt,
      existingState
    );

    return {
      hasConflict: conflictResult.hasConflict,
      reason: conflictResult.reason,
    };
  } catch (error) {
    return { hasConflict: false, reason: `Could not check conflict: ${error}` };
  }
}

/**
 * Execute all sync operations with atomic rollback support
 *
 * Processes create operations first, then updates. On any failure,
 * rolls back all completed operations.
 *
 * @param creates - Create operations to execute
 * @param updates - Update operations to execute
 * @param projectId - HacknPlan project ID
 * @param client - HacknPlan API client
 * @param syncState - Sync state manager
 * @param options - Execution options
 * @returns Execution result with counts and errors
 */
export async function executeSyncBatch(
  creates: CreateOperation[],
  updates: UpdateOperation[],
  projectId: number,
  client: HacknPlanClient,
  syncState: SyncStateOps,
  options: { stopOnError?: boolean; rollbackOnError?: boolean; onEvent?: SyncEventCallback } = {}
): Promise<SyncExecutionResult> {
  const { stopOnError = false, rollbackOnError = false, onEvent } = options;
  const rollbackStack: RollbackEntry[] = [];

  const result: SyncExecutionResult = {
    created: 0,
    updated: 0,
    conflicts: 0,
    skipped: 0,
    errors: [],
    createdElements: [],
    updatedElements: [],
  };

  // Execute create operations
  for (const op of creates) {
    // Check for conflicts (for creates, we check if file has sync state with HacknPlan ID)
    const existingState = syncState.getSyncState(op.sourceFile);
    if (existingState?.hacknplanId) {
      result.conflicts++;
      console.error(`[glue] Conflict: ${op.sourceFile} already linked to HacknPlan #${existingState.hacknplanId}`);
      continue;
    }

    const createResult = await executeCreateOperation(op, projectId, client, syncState, rollbackStack, onEvent);

    if (createResult.error) {
      result.errors.push({ file: op.sourceFile, error: createResult.error });

      if (stopOnError) {
        if (rollbackOnError) {
          await rollbackOperations(rollbackStack, client, syncState);
        }
        return result;
      }
    } else if (createResult.element) {
      result.created++;
      result.createdElements!.push({
        file: op.sourceFile,
        hacknplanId: createResult.element.designElementId,
        name: op.name,
      });
    }
  }

  // Execute update operations
  for (const op of updates) {
    const updateResult = await executeUpdateOperation(op, projectId, client, syncState, rollbackStack, onEvent);

    if (updateResult.error) {
      result.errors.push({ file: op.sourceFile, error: updateResult.error });

      if (stopOnError) {
        if (rollbackOnError) {
          await rollbackOperations(rollbackStack, client, syncState);
        }
        return result;
      }
    } else if (updateResult.element) {
      result.updated++;
      result.updatedElements!.push({
        file: op.sourceFile,
        hacknplanId: updateResult.element.designElementId,
        name: op.name,
      });
    }
  }

  return result;
}


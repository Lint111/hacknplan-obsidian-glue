/**
 * Sync operation tools
 *
 * Phase 5: sync_vault_to_hacknplan now EXECUTES operations directly
 * instead of returning TODO lists.
 */

import type { ToolDefinition } from './types.js';
import type {
  DesignElement,
  VaultToHacknPlanOps,
  HacknPlanToVaultOps,
  SyncExecutionResult,
} from '../core/types.js';
import {
  generateVaultToHacknPlanOps,
  generateHacknPlanToVaultOps,
  executeFileOperations,
} from '../lib/sync.js';
import { executeSyncBatch } from '../lib/sync-executor.js';

// ============ ARGUMENT INTERFACES ============

interface SyncVaultToHacknPlanArgs {
  projectId: number;
  dryRun?: boolean;
}

interface SyncHacknPlanToVaultArgs {
  projectId: number;
  elements: DesignElement[];
  dryRun?: boolean;
}

// ============ RESULT INTERFACES ============

interface SyncVaultToHacknPlanDryRunResult {
  dryRun: true;
  projectId: number;
  operations: VaultToHacknPlanOps;
  summary: {
    toCreate: number;
    toUpdate: number;
    skipped: number;
  };
}

interface SyncHacknPlanToVaultResult {
  dryRun: boolean;
  operations: HacknPlanToVaultOps;
  summary: {
    created: number;
    updated: number;
    skipped: number;
  };
}

// ============ TOOL DEFINITIONS ============

/**
 * Sync vault documents to HacknPlan design elements
 *
 * Phase 5: Now EXECUTES operations directly instead of returning TODO lists.
 * - dryRun=true: Returns operations without executing (planning mode)
 * - dryRun=false (default): Executes operations and returns results
 */
export const syncVaultToHacknPlan: ToolDefinition<
  SyncVaultToHacknPlanArgs,
  SyncVaultToHacknPlanDryRunResult | SyncExecutionResult
> = {
  name: 'sync_vault_to_hacknplan',
  description:
    'Sync Obsidian vault documents to HacknPlan design elements. ' +
    'When dryRun=false (default), EXECUTES operations directly: creates/updates design elements, ' +
    'updates vault frontmatter with hacknplan_id, and tracks sync state. ' +
    'When dryRun=true, returns planned operations without executing.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'number', description: 'Project ID' },
      dryRun: {
        type: 'boolean',
        description: 'If true, only report what would be synced without executing',
      },
    },
    required: ['projectId'],
  },
  handler: async (args, ctx) => {
    const pairing = ctx.getPairing(args.projectId);
    if (!pairing) {
      throw new Error(`No pairing for project ${args.projectId}`);
    }

    // Generate operations (scan vault, determine creates/updates)
    const operations = await generateVaultToHacknPlanOps(pairing);

    // Dry run mode: return operations without executing
    if (args.dryRun) {
      return {
        dryRun: true as const,
        projectId: args.projectId,
        operations,
        summary: {
          toCreate: operations.create.length,
          toUpdate: operations.update.length,
          skipped: operations.skip.length,
        },
      };
    }

    // Execution mode: require HacknPlan client
    if (!ctx.hacknplanClient) {
      throw new Error(
        'HacknPlan API client not configured. Set HACKNPLAN_API_KEY environment variable.'
      );
    }

    // Execute all operations
    console.error(`[glue] Executing sync: ${operations.create.length} creates, ${operations.update.length} updates`);

    const result = await executeSyncBatch(
      operations.create,
      operations.update,
      args.projectId,
      ctx.hacknplanClient,
      ctx.syncState,
      { stopOnError: false, rollbackOnError: false }
    );

    // Add skipped count from operations that had no mapping
    result.skipped = operations.skip.length;

    // Save sync state after execution
    try {
      await ctx.syncState.saveSyncState();
      console.error(`[glue] Sync state saved`);
    } catch (saveError) {
      console.error(`[glue] Warning: Failed to save sync state: ${saveError}`);
    }

    console.error(
      `[glue] Sync complete: ${result.created} created, ${result.updated} updated, ` +
      `${result.conflicts} conflicts, ${result.skipped} skipped, ${result.errors.length} errors`
    );

    return result;
  },
};

/**
 * Sync HacknPlan design elements to vault files
 */
export const syncHacknPlanToVault: ToolDefinition<SyncHacknPlanToVaultArgs, SyncHacknPlanToVaultResult> = {
  name: 'sync_hacknplan_to_vault',
  description:
    'Generate vault file content from HacknPlan design elements. Returns file operations to perform.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'number', description: 'Project ID' },
      elements: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            designElementId: { type: 'number' },
            name: { type: 'string' },
            description: { type: 'string' },
            type: { type: 'object' },
          },
        },
        description:
          'Design elements from HacknPlan (pass result from hacknplan MCP list_design_elements)',
      },
      dryRun: { type: 'boolean', description: 'If true, only report what would be created' },
    },
    required: ['projectId', 'elements'],
  },
  handler: async (args, ctx) => {
    const pairing = ctx.getPairing(args.projectId);
    if (!pairing) {
      throw new Error(`No pairing for project ${args.projectId}`);
    }

    const operations = generateHacknPlanToVaultOps(pairing, args.elements || []);

    // Execute file writes if not dry run
    if (!args.dryRun) {
      executeFileOperations(operations);
    }

    return {
      dryRun: args.dryRun || false,
      operations,
      summary: {
        created: operations.create.length,
        updated: operations.update.length,
        skipped: operations.skip.length,
      },
    };
  },
};

/**
 * All sync tool handlers
 */
export const syncTools: ToolDefinition[] = [syncVaultToHacknPlan, syncHacknPlanToVault];

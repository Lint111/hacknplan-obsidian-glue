#!/usr/bin/env node

/**
 * HacknPlan-Obsidian Glue MCP Server
 *
 * This MCP acts as a synchronization layer between:
 * - HacknPlan MCP (project management API)
 * - Obsidian Vault MCP (documentation)
 *
 * Responsibilities:
 * - Project-vault pairing configuration
 * - Bidirectional sync between design elements and vault docs
 * - Cross-reference management
 * - Tag extraction and auto-assignment
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { basename, dirname } from 'path';

import { getConfigPath, createPairingManager } from './core/config.js';
import { SyncStateManager } from './lib/sync-state.js';
import { HacknPlanClient } from './core/client.js';
import { FileWatcher } from './lib/file-watcher.js';
import { SyncQueue } from './lib/sync-queue.js';
import type { ToolContext } from './tools/types.js';
import { createGlobalRegistry, getToolSchemas, executeTool } from './tools/registry.js';
import type { WorkItemCreatedEvent, WorkItemUpdatedEvent } from './core/types.js';
import {
  injectMarkerIntoFile,
  createCompletedMarker,
  createOutOfSyncMarker,
  createNeedsReviewMarker,
} from './lib/marker-injector.js';

// ============ CONFIGURATION ============

const CONFIG_PATH = getConfigPath();
const CONFIG_DIR = dirname(CONFIG_PATH);
const pairingManager = createPairingManager(CONFIG_PATH);

// ============ SYNC STATE ============

const syncStateManager = new SyncStateManager(CONFIG_DIR);

// ============ HACKNPLAN CLIENT ============

// Create HacknPlan client if API key is available
// This enables sync_vault_to_hacknplan to execute operations directly
const hacknplanApiKey = process.env.HACKNPLAN_API_KEY;
const hacknplanClient = hacknplanApiKey ? new HacknPlanClient(hacknplanApiKey) : null;

if (hacknplanClient) {
  console.error('[glue] HacknPlan API client initialized');
} else {
  console.error('[glue] Warning: HACKNPLAN_API_KEY not set - sync execution disabled');
}


// ============ FILE WATCHER (Phase 6) ============

const fileWatcher = new FileWatcher();

// Listen to file watcher events
fileWatcher.on('started', (data) => {
  console.error(`[glue] File watcher started for ${data.vaultPath}`);
});

fileWatcher.on('ready', (data) => {
  console.error(`[glue] File watcher ready - watching ${data.filesWatched} files`);
});

fileWatcher.on('stopped', () => {
  console.error('[glue] File watcher stopped');
});

fileWatcher.on('change-detected', (change) => {
  console.error(`[glue] Change detected: ${change.event} ${change.path}`);
});

fileWatcher.on('changes-ready', (changes) => {
  console.error(`[glue] Processing ${changes.length} debounced change(s)`);
  
  // Find pairing for the changed file's vault
  if (syncQueue && changes.length > 0) {
    // Get vault path from first change (all changes should be from same vault)
    const changedFile = changes[0].path;
    const pairing = pairingManager.getAllPairings().find(p => 
      changedFile.startsWith(p.vaultPath)
    );
    
    if (pairing) {
      syncQueue.addChanges(changes, pairing);
    } else {
      console.error(`[glue] No pairing found for ${changedFile}`);
    }
  }
});

fileWatcher.on('error', (error) => {
  console.error(`[glue] File watcher error: ${error.message}`);
});


// ============ MARKER INJECTION HANDLER (Phase 11) ============

/**
 * Handle sync events and inject markers into vault documents
 */
async function handleSyncEvent(event: WorkItemCreatedEvent | WorkItemUpdatedEvent): Promise<void> {
  try {
    // Find pairing for the source file
    const pairing = pairingManager.getAllPairings().find(p =>
      event.sourceFile.startsWith(p.vaultPath)
    );

    if (!pairing || !pairing.autoInjectMarkers) {
      return; // Auto-injection disabled for this pairing
    }

    // Determine marker type based on event
    const isCreate = 'workItemId' in event && !('changedFields' in event);
    const marker = isCreate
      ? createCompletedMarker(event.workItemId, `Created: ${event.title}`)
      : createOutOfSyncMarker(event.workItemId, `Updated: ${event.title}`);

    // Inject marker into source file
    await injectMarkerIntoFile(
      event.sourceFile,
      marker,
      { position: pairing.markerPosition || 'after-frontmatter' }
    );

    console.error(`[glue] Injected ${marker.type} marker for HP-${event.workItemId} in ${event.sourceFile}`);
  } catch (error) {
    console.error(`[glue] Failed to inject marker: ${(error as Error).message}`);
  }
}

// ============ SYNC QUEUE (Phase 7) ============

// Initialize sync queue (only if HacknPlan client is available)
let syncQueue: SyncQueue | null = null;
if (hacknplanClient) {
  syncQueue = new SyncQueue(hacknplanClient, {
    getSyncState: syncStateManager.getSyncState.bind(syncStateManager),
    updateSyncState: syncStateManager.updateSyncState.bind(syncStateManager),
    clearSyncState: syncStateManager.clearSyncState.bind(syncStateManager),
    getByHacknPlanId: syncStateManager.getByHacknPlanId.bind(syncStateManager),
    saveSyncState: syncStateManager.save.bind(syncStateManager),
  }, {
    concurrency: 3,
    maxRetries: 3,
    retryDelayMs: 1000,
    retryBackoffMultiplier: 2,
    batchDelayMs: 2000,
  }, handleSyncEvent);

  // Listen to queue events
  syncQueue.on('queue-updated', (data) => {
    console.error(`[glue] Queue updated: ${data.pending} pending`);
  });

  syncQueue.on('processing-started', () => {
    console.error('[glue] Queue processing started');
  });

  syncQueue.on('processing-completed', (data) => {
    console.error(`[glue] Queue processing completed: ${data.processed} processed, ${data.failed} failed`);
  });

  syncQueue.on('item-completed', (data) => {
    console.error(`[glue] Synced: ${data.id} (${data.duration}ms)`);
  });

  syncQueue.on('item-failed', (data) => {
    console.error(`[glue] Failed: ${data.id} - ${data.error} (retries: ${data.retries})`);
  });

  syncQueue.on('item-retry', (data) => {
    console.error(`[glue] Retry: ${data.id} (attempt ${data.retries}, delay ${data.delay}ms)`);
  });
}

// ============ TOOL CONTEXT ============

function createToolContext(): ToolContext {
  return {
    // Legacy pairing operations (for backward compatibility)
    getPairing: pairingManager.getPairing.bind(pairingManager),
    getPairingByVault: pairingManager.getPairingByVault.bind(pairingManager),
    getAllPairings: pairingManager.getAllPairings.bind(pairingManager),
    addPairing: pairingManager.addPairing.bind(pairingManager),
    removePairing: pairingManager.removePairing.bind(pairingManager),
    updatePairing: pairingManager.updatePairing.bind(pairingManager),
    saveConfig: pairingManager.saveConfig.bind(pairingManager),
    // Pairing store (Phase 6 - cleaner interface)
    pairingStore: {
      get: pairingManager.getPairing.bind(pairingManager),
      getByVault: pairingManager.getPairingByVault.bind(pairingManager),
      getAll: pairingManager.getAllPairings.bind(pairingManager),
      add: pairingManager.addPairing.bind(pairingManager),
      remove: pairingManager.removePairing.bind(pairingManager),
      update: pairingManager.updatePairing.bind(pairingManager),
      save: pairingManager.saveConfig.bind(pairingManager),
    },
    // Sync state operations (Phase 3)
    syncState: {
      getSyncState: syncStateManager.getSyncState.bind(syncStateManager),
      updateSyncState: syncStateManager.updateSyncState.bind(syncStateManager),
      clearSyncState: syncStateManager.clearSyncState.bind(syncStateManager),
      getByHacknPlanId: syncStateManager.getByHacknPlanId.bind(syncStateManager),
      saveSyncState: syncStateManager.save.bind(syncStateManager),
    },
    // HacknPlan API client (Phase 5)
    hacknplanClient,
    // File watcher (Phase 6)
    fileWatcher,
    // Sync queue (Phase 7)
    syncQueue,
  };
}

// ============ CREATE MCP SERVER ============

const server = new Server(
  {
    name: 'hacknplan-obsidian-glue',
    version: '2.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

const toolRegistry = createGlobalRegistry();

// ============ RESOURCES ============

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const pairings = pairingManager.getAllPairings();
  return {
    resources: pairings.map((p) => ({
      uri: `glue://pairing/${p.projectId}`,
      name: `${p.projectName} <-> ${basename(p.vaultPath)}`,
      description: `HacknPlan project ${p.projectId} synced with ${p.vaultPath}`,
      mimeType: 'application/json',
    })),
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  const match = uri.match(/^glue:\/\/pairing\/(\d+)$/);

  if (match) {
    const projectId = parseInt(match[1], 10);
    const pairing = pairingManager.getPairing(projectId);
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(pairing || { error: 'Pairing not found' }, null, 2),
        },
      ],
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

// ============ TOOLS ============

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: getToolSchemas(toolRegistry),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const context = createToolContext();
    const result = await executeTool(toolRegistry, name, args, context);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${(error as Error).message}` }],
      isError: true,
    };
  }
});

// ============ SHUTDOWN HANDLING ============

let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.error(`[glue] ${signal} received, saving state...`);
  try {
    // Pause sync queue if running
    if (syncQueue) {
      console.error('[glue] Pausing sync queue...');
      syncQueue.pause();
    }
    
    // Stop file watcher if running
    if (fileWatcher.isWatching()) {
      console.error('[glue] Stopping file watcher...');
      await fileWatcher.stop();
    }
    
    // Save sync state if dirty
    if (syncStateManager.isDirty()) {
      await syncStateManager.save();
    }
    console.error('[glue] Shutdown complete');
  } catch (error) {
    console.error(`[glue] Error during shutdown: ${(error as Error).message}`);
  }
  process.exit(0);
}

// Register shutdown handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ============ MAIN ============

async function main(): Promise<void> {
  // Load sync state before starting server
  await syncStateManager.load();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[glue] HacknPlan-Obsidian Glue MCP v2.0.0 running');
  console.error('[glue] TypeScript implementation - Phase 8 (Single-File Sync)');
  console.error(`[glue] Config: ${CONFIG_PATH}`);
  console.error(`[glue] Sync state: ${syncStateManager.getStateFilePath()}`);
  console.error(`[glue] Pairings: ${pairingManager.getAllPairings().length}`);
  console.error(`[glue] Sync entries: ${syncStateManager.getEntryCount()}`);
  console.error(`[glue] Tools: ${toolRegistry.size}`);
  console.error(`[glue] HacknPlan client: ${hacknplanClient ? 'enabled' : 'disabled (no API key)'}`);
  console.error(`[glue] File watcher: ready`);
  console.error(`[glue] Sync queue: ${syncQueue ? 'enabled' : 'disabled (no API key)'}`);
}

main().catch((error) => {
  console.error('[glue] Fatal error:', error);
  process.exit(1);
});

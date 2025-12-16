import { ToolDefinition } from './types.js';
import { ToolContext } from './types.js';

export const startFileWatcherTool: ToolDefinition = {
  name: 'start_file_watcher',
  description: 'Start watching an Obsidian vault for real-time file changes. Changes are debounced and queued for automatic sync.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'number',
        description: 'Project ID to get vault path from pairing configuration',
      },
      debounceMs: {
        type: 'number',
        description: 'Debounce time in milliseconds (default: 5000). Changes within this window are batched together.',
      },
    },
    required: ['projectId'],
  },
  handler: async (args: any, context: ToolContext) => {
    const { projectId, debounceMs } = args;

    // Get pairing to find vault path
    const pairing = context.pairingStore.get(projectId);
    if (!pairing) {
      return {
        error: `No pairing found for project ${projectId}. Use add_pairing first.`,
      };
    }

    // Check if already watching
    if (context.fileWatcher.isWatching()) {
      const status = context.fileWatcher.getStatus();
      if (status.vaultPath === pairing.vaultPath) {
        return {
          message: 'File watcher is already running for this vault.',
          status,
        };
      }
      return {
        error: 'File watcher is already watching a different vault. Call stop_file_watcher first.',
      };
    }

    // Start watching
    try {
      context.fileWatcher.start({
        vaultPath: pairing.vaultPath,
        debounceMs,
      });

      // Wait for 'ready' event
      await new Promise<void>((resolve) => {
        context.fileWatcher.once('ready', () => resolve());
      });

      const status = context.fileWatcher.getStatus();
      return {
        message: `File watcher started for vault at ${pairing.vaultPath}`,
        status,
      };
    } catch (error: any) {
      return {
        error: `Failed to start file watcher: ${error.message}`,
      };
    }
  },
};

export const stopFileWatcherTool: ToolDefinition = {
  name: 'stop_file_watcher',
  description: 'Stop watching the vault for file changes. Any pending changes will be processed before stopping.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (args: any, context: ToolContext) => {
    if (!context.fileWatcher.isWatching()) {
      return {
        message: 'File watcher is not running.',
      };
    }

    try {
      await context.fileWatcher.stop();
      return {
        message: 'File watcher stopped successfully.',
      };
    } catch (error: any) {
      return {
        error: `Failed to stop file watcher: ${error.message}`,
      };
    }
  },
};

export const getSyncStatusTool: ToolDefinition = {
  name: 'get_sync_status',
  description: 'Get current file watcher status including pending changes and watch statistics.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (args: any, context: ToolContext) => {
    const status = context.fileWatcher.getStatus();
    const pendingChanges = context.fileWatcher.getPendingChanges();

    return {
      status,
      pendingChanges: pendingChanges.map((change) => ({
        path: change.path,
        event: change.event,
        timestamp: change.timestamp.toISOString(),
      })),
    };
  },
};

import { ToolDefinition } from './types.js';
import { ToolContext } from './types.js';

export const getQueueStatsTool: ToolDefinition = {
  name: 'get_queue_stats',
  description: 'Get current sync queue statistics including pending, processing, completed, and failed items.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (args: any, context: ToolContext) => {
    if (!context.syncQueue) {
      return {
        error: 'Sync queue is not available (HACKNPLAN_API_KEY not set)',
      };
    }

    const stats = context.syncQueue.getStats();
    return {
      stats,
      isActive: context.syncQueue.isActive(),
    };
  },
};

export const retryFailedTool: ToolDefinition = {
  name: 'retry_failed_sync',
  description: 'Retry all failed sync operations in the queue.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (args: any, context: ToolContext) => {
    if (!context.syncQueue) {
      return {
        error: 'Sync queue is not available (HACKNPLAN_API_KEY not set)',
      };
    }

    const failedItems = context.syncQueue.getFailedItems();
    const count = failedItems.length;

    if (count === 0) {
      return {
        message: 'No failed items to retry.',
      };
    }

    context.syncQueue.retryFailed();

    return {
      message: `Retrying ${count} failed item(s).`,
      retrying: failedItems.map((item) => ({
        path: item.change.path,
        event: item.change.event,
        lastError: item.lastError,
        retriesBefore: item.retries,
      })),
    };
  },
};

export const clearFailedTool: ToolDefinition = {
  name: 'clear_failed_sync',
  description: 'Clear all failed sync operations from the queue without retrying.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (args: any, context: ToolContext) => {
    if (!context.syncQueue) {
      return {
        error: 'Sync queue is not available (HACKNPLAN_API_KEY not set)',
      };
    }

    const count = context.syncQueue.getFailedItems().length;
    context.syncQueue.clearFailed();

    return {
      message: `Cleared ${count} failed item(s).`,
    };
  },
};

export const pauseQueueTool: ToolDefinition = {
  name: 'pause_sync_queue',
  description: 'Pause the sync queue processing. Pending changes will accumulate but not be processed.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (args: any, context: ToolContext) => {
    if (!context.syncQueue) {
      return {
        error: 'Sync queue is not available (HACKNPLAN_API_KEY not set)',
      };
    }

    context.syncQueue.pause();

    return {
      message: 'Sync queue paused.',
    };
  },
};

export const resumeQueueTool: ToolDefinition = {
  name: 'resume_sync_queue',
  description: 'Resume the sync queue processing. Accumulated changes will be processed.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (args: any, context: ToolContext) => {
    if (!context.syncQueue) {
      return {
        error: 'Sync queue is not available (HACKNPLAN_API_KEY not set)',
      };
    }

    context.syncQueue.resume();

    return {
      message: 'Sync queue resumed.',
    };
  },
};

export const queueTools = [
  getQueueStatsTool,
  retryFailedTool,
  clearFailedTool,
  pauseQueueTool,
  resumeQueueTool,
];

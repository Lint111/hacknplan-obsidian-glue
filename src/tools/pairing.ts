/**
 * Pairing management tools
 */

import type { ToolDefinition } from './types.js';
import type { Pairing, FolderMappings, TagMappings } from '../core/types.js';

// ============ ARGUMENT INTERFACES ============

interface AddPairingArgs {
  projectId: number;
  projectName: string;
  vaultPath: string;
  folderMappings?: FolderMappings;
  tagMappings?: TagMappings;
  defaultBoard?: number;
}

interface RemovePairingArgs {
  projectId: number;
}

interface GetPairingArgs {
  projectId: number;
}

interface UpdatePairingArgs {
  projectId: number;
  folderMappings?: FolderMappings;
  tagMappings?: TagMappings;
  defaultBoard?: number;
}

// ============ TOOL DEFINITIONS ============

/**
 * Add a project-vault pairing
 */
export const addPairing: ToolDefinition<AddPairingArgs, { success: boolean; pairing: Pairing }> = {
  name: 'add_pairing',
  description: 'Create a pairing between a HacknPlan project and an Obsidian vault',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'number', description: 'HacknPlan project ID' },
      projectName: { type: 'string', description: 'Human-readable project name' },
      vaultPath: { type: 'string', description: 'Absolute path to Obsidian vault root' },
      folderMappings: {
        type: 'object',
        description:
          "Map vault folders to HacknPlan design element type IDs. E.g., {'01-Architecture': 9, '03-Research': 10}",
        additionalProperties: { type: 'number' },
      },
      tagMappings: {
        type: 'object',
        description:
          "Map vault tags to HacknPlan tag IDs. E.g., {'vulkan': 1, 'render-graph': 2}",
        additionalProperties: { type: 'number' },
      },
      defaultBoard: { type: 'number', description: 'Default board ID for new work items' },
    },
    required: ['projectId', 'projectName', 'vaultPath'],
  },
  handler: async (args, ctx) => {
    const now = new Date().toISOString();
    const pairing: Pairing = {
      projectId: args.projectId,
      projectName: args.projectName,
      vaultPath: args.vaultPath,
      folderMappings: args.folderMappings || {},
      tagMappings: args.tagMappings || {},
      defaultBoard: args.defaultBoard || null,
      createdAt: now,
      updatedAt: now,
    };

    ctx.addPairing(pairing);
    ctx.saveConfig();

    return { success: true, pairing };
  },
};

/**
 * Remove a project-vault pairing
 */
export const removePairing: ToolDefinition<RemovePairingArgs, { success: boolean; removed: boolean }> = {
  name: 'remove_pairing',
  description: 'Remove a project-vault pairing',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'number', description: 'HacknPlan project ID' },
    },
    required: ['projectId'],
  },
  handler: async (args, ctx) => {
    const removed = ctx.removePairing(args.projectId);
    ctx.saveConfig();
    return { success: true, removed };
  },
};

/**
 * List all pairings
 */
export const listPairings: ToolDefinition<Record<string, never>, Pairing[]> = {
  name: 'list_pairings',
  description: 'List all configured project-vault pairings',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (_args, ctx) => {
    return ctx.getAllPairings();
  },
};

/**
 * Get a specific pairing
 */
export const getPairing: ToolDefinition<GetPairingArgs, Pairing | { error: string }> = {
  name: 'get_pairing',
  description: 'Get details of a specific pairing',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'number', description: 'HacknPlan project ID' },
    },
    required: ['projectId'],
  },
  handler: async (args, ctx) => {
    const pairing = ctx.getPairing(args.projectId);
    return pairing || { error: 'No pairing found' };
  },
};

/**
 * Update an existing pairing
 */
export const updatePairing: ToolDefinition<
  UpdatePairingArgs,
  { success: boolean; pairing: Pairing } | { error: string }
> = {
  name: 'update_pairing',
  description: 'Update an existing pairing configuration',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'number', description: 'HacknPlan project ID' },
      folderMappings: { type: 'object', additionalProperties: { type: 'number' } },
      tagMappings: { type: 'object', additionalProperties: { type: 'number' } },
      defaultBoard: { type: 'number' },
    },
    required: ['projectId'],
  },
  handler: async (args, ctx) => {
    const pairing = ctx.updatePairing(args.projectId, {
      folderMappings: args.folderMappings,
      tagMappings: args.tagMappings,
      defaultBoard: args.defaultBoard,
    });

    if (!pairing) {
      return { error: 'Pairing not found' };
    }

    ctx.saveConfig();
    return { success: true, pairing };
  },
};

/**
 * All pairing tool handlers
 */
export const pairingTools: ToolDefinition[] = [
  addPairing,
  removePairing,
  listPairings,
  getPairing,
  updatePairing,
];

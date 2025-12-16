/**
 * Tool handler registry system for MCP tool management
 *
 * Provides centralized registration, lookup, and execution of MCP tools
 * with duplicate name detection and type-safe handlers.
 */

import type { ToolDefinition, ToolRegistry, ToolContext } from './types.js';
import { pairingTools } from './pairing.js';
import { vaultTools } from './vault.js';
import { syncTools } from './sync.js';
import { crossReferenceTools } from './cross-reference.js';
import { startFileWatcherTool, stopFileWatcherTool, getSyncStatusTool } from './file-watcher.js';

/**
 * Create tool registry from tool definitions with duplicate detection.
 *
 * Builds a Map-based registry from an array of tool definitions, enforcing
 * unique tool names. Throws on duplicate names to prevent registration conflicts.
 *
 * @param tools - Array of tool definitions to register
 * @returns Map-based tool registry
 * @throws Error if duplicate tool name detected
 */
export function createToolRegistry(tools: ToolDefinition[]): ToolRegistry {
  const registry: ToolRegistry = new Map();

  for (const tool of tools) {
    if (registry.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    registry.set(tool.name, tool);
  }

  return registry;
}

/**
 * Get all tool schemas for MCP ListTools response.
 *
 * Extracts tool metadata (name, description, inputSchema) from the registry
 * for MCP protocol ListTools handler. Strips handler functions.
 *
 * @param registry - Tool registry
 * @returns Array of tool schemas for MCP ListTools response
 */
export function getToolSchemas(
  registry: ToolRegistry
): Array<{ name: string; description: string; inputSchema: unknown }> {
  return Array.from(registry.values()).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

/**
 * Execute a tool handler by name with type-safe result casting.
 *
 * Looks up tool by name in registry and invokes handler with provided arguments
 * and context. Throws if tool name not found.
 *
 * @param registry - Tool registry
 * @param toolName - Tool name to execute
 * @param args - Tool arguments
 * @param context - Tool execution context
 * @returns Promise resolving to tool result
 * @throws Error if tool name not found
 */
export async function executeTool<TResult = unknown>(
  registry: ToolRegistry,
  toolName: string,
  args: unknown,
  context: ToolContext
): Promise<TResult> {
  const tool = registry.get(toolName);

  if (!tool) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  return (await tool.handler(args, context)) as TResult;
}

/**
 * Create global tool registry by combining all tool modules.
 *
 * Aggregates tools from all domain modules (pairing, vault, sync, cross-reference, file-watcher)
 * into a single unified registry.
 *
 * @returns Complete tool registry with all MCP tools
 */
export function createGlobalRegistry(): ToolRegistry {
  return createToolRegistry([
    ...pairingTools,
    ...vaultTools,
    ...syncTools,
    ...crossReferenceTools,
    startFileWatcherTool,
    stopFileWatcherTool,
    getSyncStatusTool,
  ]);
}

/**
 * Core type definitions for HacknPlan-Obsidian Glue
 */

// ============ PAIRING TYPES ============

/**
 * Mapping of vault folders to HacknPlan design element type IDs
 * E.g., { '01-Architecture': 9, '03-Research': 10 }
 */
export type FolderMappings = Record<string, number>;

/**
 * Mapping of vault tags to HacknPlan tag IDs
 * E.g., { 'vulkan': 1, 'render-graph': 2 }
 */
export type TagMappings = Record<string, number>;

/**
 * Project-vault pairing configuration
 */
export interface Pairing {
  projectId: number;
  projectName: string;
  vaultPath: string;
  folderMappings: FolderMappings;
  tagMappings: TagMappings;
  defaultBoard: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Glue configuration file format
 */
export interface GlueConfig {
  pairings: Pairing[];
  version: string;
}

// ============ VAULT TYPES ============

/**
 * Supported frontmatter value types
 * Supports complex YAML: arrays, nested objects, primitives
 */
export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue };

/**
 * Frontmatter extracted from markdown files
 *
 * Supports complex YAML structures including:
 * - Arrays: tags: [vulkan, svo, mcp]
 * - Nested objects: config: { sync: { enabled: true } }
 * - Multi-line strings
 * - All primitive types (string, number, boolean, null)
 */
export interface Frontmatter {
  hacknplan_id?: string | number;
  hacknplan_type?: string;
  hacknplan_project?: string | number;
  synced_at?: string;
  tags?: string[];
  [key: string]: FrontmatterValue;
}

/**
 * Vault document with metadata
 */
export interface VaultDocument {
  path: string;
  relativePath: string;
  name: string;
  modified: Date;
  content: string;
  frontmatter: Frontmatter;
}

/**
 * Slim document info for scan results
 */
export interface VaultDocumentInfo {
  name: string;
  relativePath: string;
  modified: Date;
  tags: string[];
  hasFrontmatter: boolean;
  hacknplanId: string | null;
}

/**
 * Tag extraction result
 */
export interface TagInfo {
  tag: string;
  count: number;
  mappedTo: number | null;
}

// ============ SYNC STATE TYPES ============

/**
 * Sync state for a single file
 * Tracks timestamps for conflict detection in Phase 4
 */
export interface FileSyncState {
  /** ISO timestamp of last successful sync */
  lastSynced: string;
  /** Vault file mtime in ms since epoch at last sync */
  vaultMtime: number;
  /** HacknPlan updatedAt timestamp at last sync */
  hacknplanUpdatedAt: string;
  /** HacknPlan design element ID (if linked) */
  hacknplanId?: number;
}

/**
 * Full sync state - maps file paths to their sync state
 */
export interface SyncState {
  [filePath: string]: FileSyncState;
}

// ============ SYNC TYPES ============

/**
 * Sync operation types
 */
export type SyncAction = 'create' | 'update' | 'skip';

/**
 * Operation to create a design element from vault
 */
export interface CreateOperation {
  action: 'create';
  typeId: number;
  name: string;
  description: string;
  sourceFile: string;
  extractedTags: string[];
}

/**
 * Operation to update a design element from vault
 */
export interface UpdateOperation {
  action: 'update';
  designElementId: number;
  name: string;
  description: string;
  sourceFile: string;
}

/**
 * Operation to skip (already synced or no mapping)
 */
export interface SkipOperation {
  name: string;
  reason: string;
}

/**
 * Vault to HacknPlan sync operations
 */
export interface VaultToHacknPlanOps {
  create: CreateOperation[];
  update: UpdateOperation[];
  skip: SkipOperation[];
}

/**
 * File operation for HacknPlan to vault sync
 */
export interface FileOperation {
  action: 'create' | 'update';
  filePath: string;
  content: string;
  elementId: number;
}

/**
 * HacknPlan to vault sync operations
 */
export interface HacknPlanToVaultOps {
  create: FileOperation[];
  update: FileOperation[];
  skip: SkipOperation[];
}

// ============ HACKNPLAN TYPES ============

/**
 * Design element from HacknPlan
 */
export interface DesignElement {
  designElementId: number;
  name: string;
  description?: string;
  type?: {
    designElementTypeId: number;
    name: string;
  };
}

/**
 * Design element type
 */
export interface DesignElementType {
  designElementTypeId: number;
  name: string;
  color?: string;
  icon?: string;
}

// ============ CROSS-REFERENCE TYPES ============

/**
 * Cross-reference links between HacknPlan and vault
 */
export interface CrossReference {
  documentName: string;
  hacknplanLink: string;
  hacknplanMarkdown: string;
  vaultLink: string | null;
  vaultPath: string | null;
}

/**
 * Tag mapping result
 */
export interface TagMappingResult {
  mapped: Array<{ vaultTag: string; hacknplanTagId: number }>;
  unmapped: string[];
  hacknplanTagIds: number[];
}

// ============ TOOL TYPES ============

/**
 * Tool handler context - provides access to all services
 */
export interface ToolContext {
  getPairing: (projectId: number) => Pairing | undefined;
  getPairingByVault: (vaultPath: string) => Pairing | undefined;
  getAllPairings: () => Pairing[];
  addPairing: (pairing: Pairing) => void;
  removePairing: (projectId: number) => boolean;
  updatePairing: (projectId: number, updates: Partial<Pairing>) => Pairing | null;
  saveConfig: () => void;
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
 */
export interface ToolDefinition<TArgs = unknown, TResult = unknown> {
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

// ============ CONFLICT TYPES ============

/**
 * Re-export conflict types from conflict-resolver module
 * These are duplicated here for convenience and type stability
 */

/**
 * Strategy for resolving sync conflicts
 */
export type ConflictStrategy = 'vault-wins' | 'hacknplan-wins' | 'manual-merge';

/**
 * Result of conflict detection between vault and HacknPlan
 */
export interface ConflictResult {
  /** True if both sources changed since last sync */
  hasConflict: boolean;
  /** Suggested resolution strategy */
  strategy: ConflictStrategy;
  /** Human-readable reason for the conflict state */
  reason: string;
  /** Vault file mtime (ms since epoch) */
  vaultTimestamp?: number;
  /** HacknPlan updatedAt ISO timestamp */
  hacknplanTimestamp?: string;
  /** Last synced timestamp (ISO) */
  lastSyncedTimestamp?: string;
  /** Unified diff if conflict detected and content provided */
  contentDiff?: string;
  /** Which source changed since last sync */
  changedSources?: ('vault' | 'hacknplan')[];
}

/**
 * Resolution result after applying a conflict strategy
 */
export interface ResolutionResult {
  /** Which source won the resolution */
  winner: 'vault' | 'hacknplan';
  /** The content to use */
  content: string;
  /** Summary of what was resolved */
  summary: string;
}

// ============ SYNC EXECUTION TYPES ============

/**
 * Result of sync execution
 * Returned by sync_vault_to_hacknplan after executing operations
 */
export interface SyncExecutionResult {
  /** Number of design elements created */
  created: number;
  /** Number of design elements updated */
  updated: number;
  /** Number of operations skipped due to conflicts */
  conflicts: number;
  /** Number of operations skipped for other reasons */
  skipped: number;
  /** List of errors encountered during sync */
  errors: Array<{ file: string; error: string }>;
  /** Details of created elements (for logging/debugging) */
  createdElements?: Array<{ file: string; hacknplanId: number; name: string }>;
  /** Details of updated elements (for logging/debugging) */
  updatedElements?: Array<{ file: string; hacknplanId: number; name: string }>;
}

/**
 * Extended create operation with conflict info
 */
export interface CreateOperationWithConflict extends CreateOperation {
  conflict?: ConflictResult;
}

/**
 * Extended update operation with conflict info
 */
export interface UpdateOperationWithConflict extends UpdateOperation {
  conflict?: ConflictResult;
}

/**
 * Vault to HacknPlan sync operations with conflict info
 */
export interface VaultToHacknPlanOpsWithConflict {
  create: CreateOperationWithConflict[];
  update: UpdateOperationWithConflict[];
  skip: SkipOperation[];
  conflicts: Array<{
    sourceFile: string;
    conflict: ConflictResult;
  }>;
}

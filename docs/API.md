# API Reference

Complete TypeScript API reference for the HacknPlan-Obsidian Glue MCP.

## Table of Contents

- [MCP Tools](#mcp-tools)
  - [Pairing Management](#pairing-management)
  - [Vault Operations](#vault-operations)
  - [Sync Operations](#sync-operations)
  - [Cross-Reference](#cross-reference)
- [TypeScript Modules](#typescript-modules)
  - [PairingManager](#pairingmanager)
  - [FileWatcher](#filewatcher)
  - [SyncQueue](#syncqueue)
  - [SingleFileSync](#singlefilesync)
  - [SyncState](#syncstate)
  - [VaultScanner](#vaultscanner)
  - [SyncEngine](#syncengine)
  - [CrossReference](#crossreference)

---

## MCP Tools

### Pairing Management

#### `add_pairing`

Create a new project-vault pairing and start file watching.

**Parameters:**

```typescript
{
  projectId: number;           // Required: HacknPlan project ID
  projectName: string;         // Required: Human-readable project name
  vaultPath: string;           // Required: Absolute path to Obsidian vault root
  folderMappings?: {           // Optional: Map vault folders to design element type IDs
    [folderName: string]: number;
  };
  tagMappings?: {              // Optional: Map vault tag names to HacknPlan tag IDs
    [tagName: string]: number;
  };
  defaultBoard?: number;       // Optional: Default board ID for new work items
}
```

**Returns:**

```typescript
{
  projectId: number;
  projectName: string;
  vaultPath: string;
  folderMappings: { [key: string]: number };
  tagMappings: { [key: string]: number };
  defaultBoard: number | null;
  createdAt: string;           // ISO 8601 timestamp
  updatedAt: string;           // ISO 8601 timestamp
}
```

**Example:**

```typescript
const pairing = await glue.add_pairing({
  projectId: 230809,
  projectName: "Vixen Engine",
  vaultPath: "C:/cpp/VBVS--VIXEN/VIXEN/Vixen-Docs",
  folderMappings: {
    "01-Architecture": 9,
    "03-Research": 10
  },
  tagMappings: {
    "vulkan": 1,
    "svo": 3,
    "performance": 8
  },
  defaultBoard: 649722
});
```

**Side Effects:**
- Creates entry in `glue-config.json`
- Starts Chokidar file watcher for vault path
- Initializes sync state tracking

---

#### `remove_pairing`

Remove project-vault pairing and stop file watching.

**Parameters:**

```typescript
{
  projectId: number;  // Required: Project ID to remove
}
```

**Returns:**

```typescript
{
  success: boolean;
  message: string;
}
```

**Example:**

```typescript
await glue.remove_pairing({ projectId: 230809 });
```

**Side Effects:**
- Removes entry from `glue-config.json`
- Stops file watcher for vault
- Clears sync state for project

---

#### `list_pairings`

List all configured project-vault pairings.

**Parameters:**

```typescript
{}  // No parameters required
```

**Returns:**

```typescript
Array<{
  projectId: number;
  projectName: string;
  vaultPath: string;
  folderMappings: { [key: string]: number };
  tagMappings: { [key: string]: number };
  defaultBoard: number | null;
  createdAt: string;
  updatedAt: string;
}>
```

**Example:**

```typescript
const pairings = await glue.list_pairings({});
console.log(`Found ${pairings.length} pairings`);
```

---

#### `get_pairing`

Get details of a specific pairing.

**Parameters:**

```typescript
{
  projectId: number;  // Required: Project ID
}
```

**Returns:**

```typescript
{
  projectId: number;
  projectName: string;
  vaultPath: string;
  folderMappings: { [key: string]: number };
  tagMappings: { [key: string]: number };
  defaultBoard: number | null;
  createdAt: string;
  updatedAt: string;
} | null  // null if pairing not found
```

**Example:**

```typescript
const pairing = await glue.get_pairing({ projectId: 230809 });
if (pairing) {
  console.log(`Vault path: ${pairing.vaultPath}`);
}
```

---

#### `update_pairing`

Update pairing configuration (preserves file watching).

**Parameters:**

```typescript
{
  projectId: number;           // Required: Project ID to update
  folderMappings?: {           // Optional: New folder mappings
    [folderName: string]: number;
  };
  tagMappings?: {              // Optional: New tag mappings
    [tagName: string]: number;
  };
  defaultBoard?: number;       // Optional: New default board
}
```

**Returns:**

```typescript
{
  projectId: number;
  projectName: string;
  vaultPath: string;
  folderMappings: { [key: string]: number };
  tagMappings: { [key: string]: number };
  defaultBoard: number | null;
  createdAt: string;
  updatedAt: string;  // Updated timestamp
}
```

**Example:**

```typescript
await glue.update_pairing({
  projectId: 230809,
  tagMappings: {
    "vulkan": 1,
    "new-tag": 12
  }
});
```

**Side Effects:**
- Updates `glue-config.json`
- File watcher continues running (no restart)

---

### Vault Operations

#### `scan_vault`

Scan vault folders and extract document metadata.

**Parameters:**

```typescript
{
  projectId: number;    // Required: Project ID
  folder?: string;      // Optional: Specific folder relative to vault root
}
```

**Returns:**

```typescript
{
  documents: Array<{
    filePath: string;           // Absolute path
    relativePath: string;       // Relative to vault root
    folder: string;             // Parent folder name
    frontmatter: {
      title?: string;
      tags?: string[];
      [key: string]: any;       // Other frontmatter fields
    };
    designElementTypeId?: number;  // Resolved from folder mapping
  }>;
  totalDocuments: number;
}
```

**Example:**

```typescript
const scan = await glue.scan_vault({
  projectId: 230809,
  folder: "01-Architecture"  // Scan specific folder
});

console.log(`Found ${scan.totalDocuments} documents`);
scan.documents.forEach(doc => {
  console.log(`- ${doc.relativePath}: ${doc.frontmatter.tags}`);
});
```

---

#### `extract_vault_tags`

Extract all unique tags from vault documents.

**Parameters:**

```typescript
{
  projectId: number;  // Required: Project ID
}
```

**Returns:**

```typescript
{
  tags: string[];           // Array of unique tag names
  tagCounts: {              // Tag usage frequency
    [tagName: string]: number;
  };
}
```

**Example:**

```typescript
const { tags, tagCounts } = await glue.extract_vault_tags({
  projectId: 230809
});

console.log("Most used tags:");
Object.entries(tagCounts)
  .sort(([,a], [,b]) => b - a)
  .slice(0, 5)
  .forEach(([tag, count]) => console.log(`${tag}: ${count}`));
```

---

### Sync Operations

#### `sync_vault_to_hacknplan`

Generate sync operations from vault to HacknPlan.

**Parameters:**

```typescript
{
  projectId: number;    // Required: Project ID
  dryRun?: boolean;     // Optional: If true, don't execute (default: false)
}
```

**Returns:**

```typescript
{
  operations: Array<{
    type: 'create' | 'update' | 'delete';
    documentPath: string;
    data: {
      name: string;
      description: string;
      typeId: number;
      tags?: number[];
    };
    designElementId?: number;  // For update/delete operations
  }>;
  summary: {
    create: number;
    update: number;
    delete: number;
    total: number;
  };
}
```

**Example:**

```typescript
// Dry run to preview changes
const preview = await glue.sync_vault_to_hacknplan({
  projectId: 230809,
  dryRun: true
});

console.log(`Will create ${preview.summary.create} elements`);
console.log(`Will update ${preview.summary.update} elements`);

// Execute if satisfied
if (preview.summary.total > 0) {
  const result = await glue.sync_vault_to_hacknplan({
    projectId: 230809,
    dryRun: false
  });
  console.log("Sync complete!");
}
```

---

#### `sync_hacknplan_to_vault`

Generate file operations to sync HacknPlan elements to vault.

**Parameters:**

```typescript
{
  projectId: number;         // Required: Project ID
  elements: Array<{          // Required: Design elements from HacknPlan
    designElementId: number;
    name: string;
    description: string;
    type: {
      designElementTypeId: number;
      name: string;
    };
  }>;
  dryRun?: boolean;          // Optional: If true, don't write files
}
```

**Returns:**

```typescript
{
  fileOperations: Array<{
    operation: 'create' | 'update';
    filePath: string;
    content: string;          // Markdown content with frontmatter
  }>;
  summary: {
    create: number;
    update: number;
    total: number;
  };
}
```

**Example:**

```typescript
// Get elements from HacknPlan
const { items } = await hacknplan.list_design_elements({
  projectId: 230809
});

// Generate vault files
const result = await glue.sync_hacknplan_to_vault({
  projectId: 230809,
  elements: items,
  dryRun: false
});

console.log(`Created ${result.summary.create} vault documents`);
```

---

### Cross-Reference

#### `generate_cross_references`

Generate bidirectional links between vault and HacknPlan.

**Parameters:**

```typescript
{
  projectId: number;          // Required: Project ID
  documentName: string;       // Required: Document name (without path/extension)
  designElementId?: number;   // Optional: HacknPlan element ID
}
```

**Returns:**

```typescript
{
  vaultLink: string;          // Obsidian wikilink format
  hacknplanLink: string;      // HacknPlan URL
  markdownSnippet: string;    // Formatted markdown for insertion
}
```

**Example:**

```typescript
const refs = await glue.generate_cross_references({
  projectId: 230809,
  documentName: "RenderGraph-System",
  designElementId: 9
});

console.log("Add to HacknPlan description:");
console.log(refs.markdownSnippet);
// Output:
// ## Vault References
// - [[RenderGraph-System]]
//
// [View in Obsidian](obsidian://open?vault=Vixen-Docs&file=01-Architecture/RenderGraph-System.md)
```

---

#### `map_tags_to_hacknplan`

Map vault tag names to HacknPlan tag IDs.

**Parameters:**

```typescript
{
  projectId: number;       // Required: Project ID
  vaultTags: string[];     // Required: Array of tag names from vault
}
```

**Returns:**

```typescript
{
  mappedTags: number[];              // Tag IDs that were mapped
  unmappedTags: string[];            // Tags without mappings
  mappings: {                        // Full mapping details
    [tagName: string]: number | null;
  };
}
```

**Example:**

```typescript
const result = await glue.map_tags_to_hacknplan({
  projectId: 230809,
  vaultTags: ["vulkan", "svo", "unknown-tag"]
});

console.log("Mapped tags:", result.mappedTags);       // [1, 3]
console.log("Unmapped tags:", result.unmappedTags);   // ["unknown-tag"]
```

---

#### `generate_work_item_description`

Format work item description with vault cross-references.

**Parameters:**

```typescript
{
  projectId: number;                // Required: Project ID
  summary: string;                  // Required: Task summary
  requirements?: string[];          // Optional: Requirement list
  acceptanceCriteria?: string[];    // Optional: Acceptance criteria checklist
  relatedFiles?: string[];          // Optional: Code file references with line numbers
  vaultDocs?: string[];             // Optional: Vault document references
}
```

**Returns:**

```typescript
{
  description: string;    // Formatted markdown description
  wordCount: number;
  lineCount: number;
}
```

**Example:**

```typescript
const desc = await glue.generate_work_item_description({
  projectId: 230809,
  summary: "Implement RT-Compute hybrid pipeline",
  requirements: [
    "Hardware RT traversal to depth N",
    "Efficient handoff data structure",
    "Performance benchmarking"
  ],
  relatedFiles: [
    "libraries/RenderGraph/src/Nodes/HybridPipelineNode.cpp:45",
    "shaders/VoxelRayMarch_Hybrid.comp:120"
  ],
  vaultDocs: [
    "01-Architecture/RenderGraph-System.md",
    "03-Research/Hybrid-RTX-SurfaceSkin.md"
  ],
  acceptanceCriteria: [
    "Visual output matches compute reference",
    "Performance within 20% of pure RT"
  ]
});

// Use in work item creation
await hacknplan.create_work_item({
  projectId: 230809,
  title: "[Hybrid Pipeline] RT-Compute handoff",
  description: desc.description,
  categoryId: 1
});
```

**Generated Description Format:**

```markdown
## Summary
Implement RT-Compute hybrid pipeline

## Requirements
- [ ] Hardware RT traversal to depth N
- [ ] Efficient handoff data structure
- [ ] Performance benchmarking

## Related Files
- `libraries/RenderGraph/src/Nodes/HybridPipelineNode.cpp:45`
- `shaders/VoxelRayMarch_Hybrid.comp:120`

## Vault References
- [[RenderGraph-System]]
- [[Hybrid-RTX-SurfaceSkin]]

## Acceptance Criteria
- [ ] Visual output matches compute reference
- [ ] Performance within 20% of pure RT
```

---

## TypeScript Modules

### PairingManager

**File:** `src/lib/pairing-manager.ts`

Manages project-vault pairings with CRUD operations.

#### `class PairingManager`

```typescript
class PairingManager {
  constructor(configPath: string);

  // Create pairing
  addPairing(pairing: Pairing): Promise<Pairing>;

  // Read pairing
  getPairing(projectId: number): Promise<Pairing | null>;
  listPairings(): Promise<Pairing[]>;

  // Update pairing
  updatePairing(projectId: number, updates: Partial<Pairing>): Promise<Pairing>;

  // Delete pairing
  removePairing(projectId: number): Promise<void>;

  // Save to disk
  private save(): Promise<void>;
  private load(): Promise<void>;
}
```

**Example:**

```typescript
import { PairingManager } from './lib/pairing-manager.js';

const manager = new PairingManager('./glue-config.json');

const pairing = await manager.addPairing({
  projectId: 230809,
  projectName: "Vixen",
  vaultPath: "/path/to/vault",
  folderMappings: {},
  tagMappings: {}
});
```

---

### FileWatcher

**File:** `src/lib/file-watcher.ts`

Chokidar-based file system watcher with debouncing.

#### `class FileWatcher`

```typescript
class FileWatcher {
  constructor(vaultPath: string, onFileChange: (filePath: string, event: 'add' | 'change' | 'unlink') => void);

  // Start watching
  start(): void;

  // Stop watching
  stop(): void;

  // Get watcher status
  isWatching(): boolean;
}
```

**Events:**
- `add` - New file created
- `change` - Existing file modified
- `unlink` - File deleted

**Example:**

```typescript
import { FileWatcher } from './lib/file-watcher.js';

const watcher = new FileWatcher('/path/to/vault', (filePath, event) => {
  console.log(`${event}: ${filePath}`);
  // Queue sync operation
});

watcher.start();
```

**Configuration:**
- Ignores: `node_modules`, `.git`, `.obsidian`, `*.tmp`
- Debounce: 1000ms (1 second)
- Persistent: true (keeps process alive)

---

### SyncQueue

**File:** `src/lib/sync-queue.ts`

Automatic queue with retry logic and exponential backoff.

#### `class SyncQueue`

```typescript
interface QueueItem {
  filePath: string;
  operation: 'create' | 'update' | 'delete';
  retryCount: number;
  maxRetries: number;
  lastAttempt?: Date;
}

class SyncQueue {
  constructor(maxConcurrency: number = 5);

  // Add to queue
  enqueue(item: QueueItem): void;

  // Process queue
  process(): Promise<void>;

  // Get queue status
  getStatus(): {
    pending: number;
    processing: number;
    failed: number;
  };

  // Clear queue
  clear(): void;
}
```

**Retry Strategy:**
- Max retries: 3
- Backoff: `1000ms * 2^retryCount`
  - Retry 1: 1s delay
  - Retry 2: 2s delay
  - Retry 3: 4s delay

**Example:**

```typescript
import { SyncQueue } from './lib/sync-queue.js';

const queue = new SyncQueue(5);  // Max 5 concurrent operations

queue.enqueue({
  filePath: '/path/to/file.md',
  operation: 'update',
  retryCount: 0,
  maxRetries: 3
});

await queue.process();
```

---

### SingleFileSync

**File:** `src/lib/single-file-sync.ts`

Optimized single-file sync (10-50x faster than full vault scan).

#### `async function syncSingleFile()`

```typescript
async function syncSingleFile(
  filePath: string,
  projectId: number,
  pairing: Pairing
): Promise<{
  success: boolean;
  operation: 'create' | 'update' | 'delete' | 'skip';
  designElementId?: number;
  error?: string;
}>;
```

**Algorithm:**

1. **Extract Frontmatter** (~1-2ms)
   ```typescript
   const { data: frontmatter, content } = matter(fileContent);
   ```

2. **Lookup Sync State** (~1ms)
   ```typescript
   const syncState = getSyncState(projectId, filePath);
   ```

3. **Detect Operation** (~1ms)
   ```typescript
   if (!syncState.designElementId) {
     operation = 'create';
   } else if (fileExists) {
     operation = 'update';
   } else {
     operation = 'delete';
   }
   ```

4. **Resolve Type ID** (~1ms)
   ```typescript
   const folder = path.dirname(relativePath);
   const typeId = pairing.folderMappings[folder];
   ```

5. **Resolve Tag IDs** (~1-2ms)
   ```typescript
   const tagIds = frontmatter.tags?.map(tag => pairing.tagMappings[tag]).filter(Boolean);
   ```

6. **Execute Operation** (~50-100ms)
   ```typescript
   if (operation === 'create') {
     const element = await hacknplan.create_design_element({...});
     updateSyncState(projectId, filePath, element.designElementId);
   }
   ```

**Example:**

```typescript
import { syncSingleFile } from './lib/single-file-sync.js';

const result = await syncSingleFile(
  '/path/to/vault/Architecture/System.md',
  230809,
  pairing
);

if (result.success) {
  console.log(`${result.operation}: Element #${result.designElementId}`);
}
```

---

### SyncState

**File:** `src/lib/sync-state.ts`

Sync state persistence and tracking.

#### `class SyncState`

```typescript
interface FileState {
  designElementId: number;
  lastSyncedHash: string;
  lastSyncedAt: Date;
}

class SyncState {
  constructor(statePath: string);

  // Get file state
  getFileState(projectId: number, filePath: string): FileState | null;

  // Update file state
  updateFileState(projectId: number, filePath: string, state: FileState): void;

  // Remove file state
  removeFileState(projectId: number, filePath: string): void;

  // Get all states for project
  getProjectStates(projectId: number): Map<string, FileState>;

  // Persist to disk
  save(): Promise<void>;
  load(): Promise<void>;
}
```

**State File Format:**

```json
{
  "230809": {
    "Architecture/System.md": {
      "designElementId": 9,
      "lastSyncedHash": "a1b2c3d4",
      "lastSyncedAt": "2025-12-16T15:30:00Z"
    }
  }
}
```

**Example:**

```typescript
import { SyncState } from './lib/sync-state.js';

const state = new SyncState('./sync-state.json');
await state.load();

const fileState = state.getFileState(230809, 'Architecture/System.md');
if (fileState) {
  console.log(`Last synced: ${fileState.lastSyncedAt}`);
  console.log(`Element ID: ${fileState.designElementId}`);
}
```

---

### VaultScanner

**File:** `src/lib/vault-scanner.ts`

Full vault scanning with frontmatter extraction.

#### `async function scanVault()`

```typescript
async function scanVault(
  vaultPath: string,
  folder?: string
): Promise<{
  documents: VaultDocument[];
  totalDocuments: number;
}>;

interface VaultDocument {
  filePath: string;
  relativePath: string;
  folder: string;
  frontmatter: {
    title?: string;
    tags?: string[];
    [key: string]: any;
  };
  content: string;
  hash: string;
}
```

**Example:**

```typescript
import { scanVault } from './lib/vault-scanner.js';

const scan = await scanVault('/path/to/vault', '01-Architecture');

scan.documents.forEach(doc => {
  console.log(`${doc.relativePath}:`);
  console.log(`  Tags: ${doc.frontmatter.tags?.join(', ')}`);
  console.log(`  Hash: ${doc.hash}`);
});
```

---

### SyncEngine

**File:** `src/lib/sync-engine.ts`

Bidirectional sync operation generator.

#### `class SyncEngine`

```typescript
class SyncEngine {
  // Generate vault → HacknPlan operations
  static generateVaultToHacknPlanOps(
    documents: VaultDocument[],
    pairing: Pairing,
    syncState: SyncState
  ): SyncOperation[];

  // Generate HacknPlan → vault operations
  static generateHacknPlanToVaultOps(
    elements: DesignElement[],
    pairing: Pairing,
    syncState: SyncState
  ): FileOperation[];

  // Detect operation type
  private static detectOperation(
    doc: VaultDocument,
    fileState: FileState | null
  ): 'create' | 'update' | 'skip';
}
```

---

### CrossReference

**File:** `src/lib/cross-reference.ts`

Link generation between systems.

#### `class CrossReference`

```typescript
class CrossReference {
  // Generate Obsidian wikilink
  static generateVaultLink(documentName: string): string;

  // Generate HacknPlan URL
  static generateHacknPlanLink(projectId: number, elementId: number): string;

  // Generate markdown snippet with both links
  static generateMarkdownSnippet(
    documentName: string,
    projectId: number,
    elementId?: number
  ): string;
}
```

**Example:**

```typescript
import { CrossReference } from './lib/cross-reference.js';

const wikilink = CrossReference.generateVaultLink("RenderGraph-System");
// Output: [[RenderGraph-System]]

const url = CrossReference.generateHacknPlanLink(230809, 9);
// Output: https://app.hacknplan.com/p/230809/kanban?designElementId=9

const snippet = CrossReference.generateMarkdownSnippet("System", 230809, 9);
// Output: ## Vault References
//         - [[System]]
//         [View in HacknPlan](https://app.hacknplan.com/p/230809/kanban?designElementId=9)
```

---

## Type Definitions

### Core Types

```typescript
interface Pairing {
  projectId: number;
  projectName: string;
  vaultPath: string;
  folderMappings: { [folderName: string]: number };
  tagMappings: { [tagName: string]: number };
  defaultBoard: number | null;
  createdAt: string;
  updatedAt: string;
}

interface VaultDocument {
  filePath: string;
  relativePath: string;
  folder: string;
  frontmatter: {
    title?: string;
    tags?: string[];
    [key: string]: any;
  };
  content: string;
  hash: string;
}

interface SyncOperation {
  type: 'create' | 'update' | 'delete';
  documentPath: string;
  data: {
    name: string;
    description: string;
    typeId: number;
    tags?: number[];
  };
  designElementId?: number;
}

interface FileOperation {
  operation: 'create' | 'update';
  filePath: string;
  content: string;
}

interface FileState {
  designElementId: number;
  lastSyncedHash: string;
  lastSyncedAt: Date;
}
```

---

## Error Handling

All MCP tools return errors in this format:

```typescript
{
  error: string;      // Error message
  code?: string;      // Error code (e.g., "PAIRING_NOT_FOUND", "VAULT_SCAN_FAILED")
  details?: any;      // Additional error context
}
```

**Common Error Codes:**

- `PAIRING_NOT_FOUND` - Project pairing does not exist
- `VAULT_PATH_INVALID` - Vault path does not exist or is not accessible
- `FOLDER_MAPPING_MISSING` - Document folder not mapped to design element type
- `TAG_MAPPING_MISSING` - Vault tag not mapped to HacknPlan tag
- `SYNC_STATE_CORRUPT` - Sync state file is corrupted
- `FILE_WATCHER_FAILED` - File watcher failed to start
- `SYNC_OPERATION_FAILED` - Sync operation execution failed

**Example Error Handling:**

```typescript
try {
  const pairing = await glue.get_pairing({ projectId: 999 });
} catch (error) {
  if (error.code === 'PAIRING_NOT_FOUND') {
    console.error("Pairing does not exist");
  } else {
    console.error("Unexpected error:", error.message);
  }
}
```

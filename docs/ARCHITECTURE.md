# Architecture

Internal architecture documentation for the HacknPlan-Obsidian Glue MCP.

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         MCP Server                               │
│                       (index.ts)                                 │
└───────────────────┬─────────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
┌───────▼────────┐    ┌────────▼─────────┐
│  MCP Tools     │    │  Core Libraries  │
│  (tools/)      │    │  (lib/)          │
└───────┬────────┘    └────────┬─────────┘
        │                      │
        │     ┌────────────────┼────────────────┐
        │     │                │                │
┌───────▼─────▼──┐  ┌──────────▼─────┐  ┌──────▼────────┐
│ Pairing        │  │ File Watcher   │  │ Sync Engine   │
│ Manager        │  │ (Phase 6)      │  │ (Phase 1-5)   │
└────────────────┘  └────────┬───────┘  └───────────────┘
                             │
                    ┌────────▼─────────┐
                    │ Sync Queue       │
                    │ (Phase 7)        │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ Single-File Sync │
                    │ (Phase 8)        │
                    └──────────────────┘
```

## Core Components

### 1. MCP Server (`src/index.ts`)

Entry point that registers MCP tools and starts the server.

**Responsibilities:**
- Initialize MCP server with SDK
- Register all tools from `tools/` modules
- Load configuration from `glue-config.json`
- Start file watchers for all configured pairings
- Handle graceful shutdown

**Lifecycle:**

```typescript
// 1. Initialization
const server = new Server({
  name: 'hacknplan-obsidian-glue',
  version: '2.0.0'
});

// 2. Load config
const pairingManager = new PairingManager('./glue-config.json');
await pairingManager.load();

// 3. Start file watchers for all pairings
const pairings = await pairingManager.listPairings();
for (const pairing of pairings) {
  startFileWatcher(pairing);
}

// 4. Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...pairingTools, ...vaultTools, ...syncTools, ...crossRefTools]
}));

// 5. Start server
await server.connect(transport);
```

### 2. Pairing Manager (`src/lib/pairing-manager.ts`)

Manages project-vault pairing configuration with CRUD operations.

**Data Structure:**

```typescript
interface Config {
  pairings: Pairing[];
}

interface Pairing {
  projectId: number;
  projectName: string;
  vaultPath: string;
  folderMappings: { [folder: string]: number };  // folder → type ID
  tagMappings: { [tag: string]: number };         // tag → tag ID
  defaultBoard: number | null;
  createdAt: string;
  updatedAt: string;
}
```

**File Format (`glue-config.json`):**

```json
{
  "pairings": [
    {
      "projectId": 230809,
      "projectName": "Vixen",
      "vaultPath": "C:/cpp/VBVS--VIXEN/VIXEN/Vixen-Docs",
      "folderMappings": {
        "01-Architecture": 9,
        "03-Research": 10
      },
      "tagMappings": {
        "vulkan": 1,
        "svo": 3,
        "performance": 8
      },
      "defaultBoard": 649722,
      "createdAt": "2025-12-16T12:00:00Z",
      "updatedAt": "2025-12-16T15:00:00Z"
    }
  ]
}
```

**Operations:**

- `addPairing()` - Create new pairing, persist to disk
- `getPairing()` - Retrieve by project ID
- `listPairings()` - Get all pairings
- `updatePairing()` - Update mappings/board, persist
- `removePairing()` - Delete pairing, persist

### 3. File Watcher (`src/lib/file-watcher.ts`) - Phase 6

Real-time vault monitoring using Chokidar.

**Architecture:**

```typescript
class FileWatcher {
  private watcher: FSWatcher;
  private debouncedHandler: DebouncedFunc<...>;

  constructor(vaultPath: string, onFileChange: FileChangeHandler) {
    this.watcher = chokidar.watch(vaultPath, {
      ignored: /(^|[\/\\])\../, // Ignore dotfiles
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    });

    // Debounce prevents event storms during bulk edits
    this.debouncedHandler = debounce(onFileChange, 1000);

    this.watcher
      .on('add', path => this.debouncedHandler(path, 'add'))
      .on('change', path => this.debouncedHandler(path, 'change'))
      .on('unlink', path => this.debouncedHandler(path, 'unlink'));
  }
}
```

**Events:**

| Event | Trigger | Action |
|-------|---------|--------|
| `add` | New `.md` file created | Queue create operation |
| `change` | Existing `.md` file modified | Queue update operation |
| `unlink` | `.md` file deleted | Queue delete operation |

**Debouncing Strategy:**

- Wait 1000ms after last file change
- Prevents duplicate syncs during rapid edits
- Batches multiple changes into single sync

**Ignored Patterns:**

```typescript
const ignored = [
  '**/.obsidian/**',
  '**/.git/**',
  '**/node_modules/**',
  '**/*.tmp',
  '**/*.swp'
];
```

### 4. Sync Queue (`src/lib/sync-queue.ts`) - Phase 7

Automatic queue with retry logic and exponential backoff.

**Queue Item:**

```typescript
interface QueueItem {
  id: string;                    // Unique ID (hash of file path)
  filePath: string;              // Absolute file path
  projectId: number;             // Target project
  operation: 'create' | 'update' | 'delete';
  retryCount: number;            // Current retry attempt
  maxRetries: number;            // Max retries (default: 3)
  lastAttempt?: Date;            // Last execution timestamp
  error?: string;                // Last error message
}
```

**Processing Flow:**

```typescript
class SyncQueue {
  private queue: Map<string, QueueItem> = new Map();
  private processing: Set<string> = new Set();
  private pLimit = pLimit(5);  // Max 5 concurrent operations

  async process(): Promise<void> {
    const pending = [...this.queue.values()]
      .filter(item => !this.processing.has(item.id));

    const promises = pending.map(item =>
      this.pLimit(() => this.processItem(item))
    );

    await Promise.allSettled(promises);
  }

  private async processItem(item: QueueItem): Promise<void> {
    this.processing.add(item.id);

    try {
      await syncSingleFile(item.filePath, item.projectId);
      this.queue.delete(item.id);  // Success - remove from queue
    } catch (error) {
      item.error = error.message;
      item.lastAttempt = new Date();
      item.retryCount++;

      if (item.retryCount >= item.maxRetries) {
        // Max retries exceeded - move to failed queue
        this.failedQueue.set(item.id, item);
        this.queue.delete(item.id);
      } else {
        // Exponential backoff
        const backoffMs = 1000 * Math.pow(2, item.retryCount);
        setTimeout(() => this.process(), backoffMs);
      }
    } finally {
      this.processing.delete(item.id);
    }
  }
}
```

**Retry Schedule:**

| Attempt | Delay | Total Elapsed |
|---------|-------|---------------|
| 1 | 0ms | 0s |
| 2 | 1000ms | 1s |
| 3 | 2000ms | 3s |
| 4 | 4000ms | 7s |

### 5. Single-File Sync (`src/lib/single-file-sync.ts`) - Phase 8

Optimized sync for individual file changes (10-50x faster).

**Algorithm:**

```typescript
async function syncSingleFile(
  filePath: string,
  projectId: number,
  pairing: Pairing
): Promise<SyncResult> {

  // Step 1: Extract frontmatter (~1-2ms)
  const content = await fs.readFile(filePath, 'utf-8');
  const { data: frontmatter, content: body } = matter(content);

  // Step 2: Lookup sync state (~1ms)
  const syncState = getSyncState(projectId, filePath);

  // Step 3: Detect operation type (~1ms)
  const operation = detectOperation(frontmatter, syncState);

  // Step 4: Resolve type ID from folder mapping (~1ms)
  const relativePath = path.relative(pairing.vaultPath, filePath);
  const folder = path.dirname(relativePath).split(path.sep)[0];
  const typeId = pairing.folderMappings[folder];

  if (!typeId) {
    throw new Error(`Folder "${folder}" not mapped to design element type`);
  }

  // Step 5: Resolve tag IDs from tag mappings (~1-2ms)
  const tagIds = (frontmatter.tags || [])
    .map(tag => pairing.tagMappings[tag])
    .filter(Boolean);

  // Step 6: Execute operation (~50-100ms)
  let designElementId: number;

  switch (operation) {
    case 'create':
      const element = await hacknplan.create_design_element({
        projectId,
        typeId,
        name: frontmatter.title || path.basename(filePath, '.md'),
        description: body,
        tags: tagIds
      });
      designElementId = element.designElementId;
      break;

    case 'update':
      await hacknplan.update_design_element({
        projectId,
        designElementId: syncState.designElementId,
        name: frontmatter.title,
        description: body
      });
      designElementId = syncState.designElementId;
      break;

    case 'delete':
      await hacknplan.delete_design_element({
        projectId,
        designElementId: syncState.designElementId
      });
      removeSyncState(projectId, filePath);
      return { success: true, operation: 'delete' };
  }

  // Step 7: Update sync state
  updateSyncState(projectId, filePath, {
    designElementId,
    lastSyncedHash: hash(content),
    lastSyncedAt: new Date()
  });

  return { success: true, operation, designElementId };
}
```

**Performance Breakdown:**

| Step | Time | Description |
|------|------|-------------|
| Frontmatter extraction | 1-2ms | `gray-matter` parsing |
| Sync state lookup | 1ms | In-memory map lookup |
| Operation detection | 1ms | Conditional logic |
| Type ID resolution | 1ms | Object property access |
| Tag ID resolution | 1-2ms | Array map + filter |
| **Subtotal (local)** | **5-10ms** | **Pre-API work** |
| HacknPlan API call | 50-100ms | Network + server processing |
| Sync state update | 1-2ms | Map update + persist |
| **Total** | **56-112ms** | **Complete operation** |

**Comparison with Full Vault Scan:**

```typescript
// Old approach (Phase 1-5): 1000-3000ms
async function fullVaultSync(projectId: number) {
  const scan = await scanVault(vaultPath);        // 500-1500ms
  const ops = generateOperations(scan, pairing);  // 300-800ms
  await executeOperations(ops);                   // 200-700ms
}

// New approach (Phase 8): 56-112ms
async function singleFileSync(filePath: string) {
  await syncSingleFile(filePath, projectId, pairing);
}

// Speedup: 10-50x
```

### 6. Sync State (`src/lib/sync-state.ts`)

Persistent state tracking for vault-HacknPlan mappings.

**Data Structure:**

```typescript
interface SyncStateStore {
  [projectId: string]: {
    [relativePath: string]: FileState;
  };
}

interface FileState {
  designElementId: number;   // HacknPlan element ID
  lastSyncedHash: string;    // Content hash at last sync
  lastSyncedAt: Date;        // Timestamp of last sync
}
```

**File Format (`sync-state.json`):**

```json
{
  "230809": {
    "01-Architecture/RenderGraph-System.md": {
      "designElementId": 9,
      "lastSyncedHash": "a1b2c3d4e5f6",
      "lastSyncedAt": "2025-12-16T15:30:00Z"
    },
    "03-Research/Hardware-RT.md": {
      "designElementId": 13,
      "lastSyncedHash": "f6e5d4c3b2a1",
      "lastSyncedAt": "2025-12-16T15:31:00Z"
    }
  }
}
```

**Hash Algorithm:**

```typescript
function hashContent(content: string): string {
  return crypto
    .createHash('md5')
    .update(content, 'utf-8')
    .digest('hex')
    .slice(0, 12);  // 12-char prefix for readability
}
```

**Operations:**

- `getFileState()` - Lookup by project + path
- `updateFileState()` - Update after successful sync
- `removeFileState()` - Delete after file removal
- `getProjectStates()` - Get all states for project
- `save()` - Persist to disk (debounced)
- `load()` - Load from disk on startup

### 7. Vault Scanner (`src/lib/vault-scanner.ts`)

Full vault scanning with frontmatter extraction.

**Scanning Strategy:**

```typescript
async function scanVault(
  vaultPath: string,
  folder?: string
): Promise<ScanResult> {

  // 1. Find all .md files
  const searchPath = folder
    ? path.join(vaultPath, folder)
    : vaultPath;

  const files = await glob('**/*.md', {
    cwd: searchPath,
    ignore: ['**/.obsidian/**', '**/node_modules/**'],
    absolute: true
  });

  // 2. Parse all files in parallel (concurrency: 10)
  const limit = pLimit(10);
  const documents = await Promise.all(
    files.map(file => limit(() => parseDocument(file, vaultPath)))
  );

  return {
    documents,
    totalDocuments: documents.length
  };
}

async function parseDocument(
  filePath: string,
  vaultRoot: string
): Promise<VaultDocument> {
  const content = await fs.readFile(filePath, 'utf-8');
  const { data: frontmatter, content: body } = matter(content);

  const relativePath = path.relative(vaultRoot, filePath);
  const folder = path.dirname(relativePath).split(path.sep)[0];

  return {
    filePath,
    relativePath,
    folder,
    frontmatter,
    content: body,
    hash: hashContent(content)
  };
}
```

**Used By:**

- `scan_vault` MCP tool (manual scanning)
- Initial sync when pairing is created
- Fallback when single-file sync fails

### 8. Sync Engine (`src/lib/sync-engine.ts`)

Bidirectional sync operation generator.

**Vault → HacknPlan:**

```typescript
function generateVaultToHacknPlanOps(
  documents: VaultDocument[],
  pairing: Pairing,
  syncState: SyncState
): SyncOperation[] {

  const operations: SyncOperation[] = [];

  for (const doc of documents) {
    const fileState = syncState.getFileState(pairing.projectId, doc.relativePath);
    const currentHash = doc.hash;

    // Detect operation
    if (!fileState) {
      // New document - create
      operations.push({
        type: 'create',
        documentPath: doc.relativePath,
        data: {
          name: doc.frontmatter.title || path.basename(doc.relativePath, '.md'),
          description: doc.content,
          typeId: pairing.folderMappings[doc.folder],
          tags: resolveTags(doc.frontmatter.tags, pairing)
        }
      });
    } else if (fileState.lastSyncedHash !== currentHash) {
      // Modified document - update
      operations.push({
        type: 'update',
        documentPath: doc.relativePath,
        designElementId: fileState.designElementId,
        data: {
          name: doc.frontmatter.title,
          description: doc.content,
          typeId: pairing.folderMappings[doc.folder],
          tags: resolveTags(doc.frontmatter.tags, pairing)
        }
      });
    }
  }

  // Detect deletions (files in sync state but not in documents)
  const documentPaths = new Set(documents.map(d => d.relativePath));
  const statePaths = syncState.getProjectStates(pairing.projectId).keys();

  for (const statePath of statePaths) {
    if (!documentPaths.has(statePath)) {
      const fileState = syncState.getFileState(pairing.projectId, statePath);
      operations.push({
        type: 'delete',
        documentPath: statePath,
        designElementId: fileState.designElementId,
        data: null
      });
    }
  }

  return operations;
}
```

**HacknPlan → Vault:**

```typescript
function generateHacknPlanToVaultOps(
  elements: DesignElement[],
  pairing: Pairing,
  syncState: SyncState
): FileOperation[] {

  const operations: FileOperation[] = [];

  for (const element of elements) {
    // Reverse lookup: type ID → folder name
    const folder = Object.entries(pairing.folderMappings)
      .find(([, typeId]) => typeId === element.type.designElementTypeId)?.[0];

    if (!folder) continue;  // Skip unmapped types

    // Generate file path
    const fileName = `${element.name.replace(/[/\\?%*:|"<>]/g, '-')}.md`;
    const filePath = path.join(pairing.vaultPath, folder, fileName);
    const relativePath = path.join(folder, fileName);

    // Generate frontmatter
    const frontmatter = {
      title: element.name,
      hacknplan_id: element.designElementId,
      tags: reverseMapTags(element.tags, pairing)
    };

    // Generate markdown content
    const content = matter.stringify(element.description, frontmatter);

    // Detect operation
    const fileState = syncState.getFileState(pairing.projectId, relativePath);
    const operation = fileState ? 'update' : 'create';

    operations.push({
      operation,
      filePath,
      content
    });
  }

  return operations;
}
```

### 9. Cross-Reference (`src/lib/cross-reference.ts`)

Link generation for bidirectional references.

**Obsidian Wikilink:**

```typescript
function generateVaultLink(documentName: string): string {
  return `[[${documentName}]]`;
}
```

**HacknPlan URL:**

```typescript
function generateHacknPlanLink(
  projectId: number,
  elementId: number
): string {
  return `https://app.hacknplan.com/p/${projectId}/kanban?designElementId=${elementId}`;
}
```

**Markdown Snippet:**

```typescript
function generateMarkdownSnippet(
  documentName: string,
  projectId: number,
  elementId?: number
): string {
  let snippet = `## Vault References\n- [[${documentName}]]\n\n`;

  if (elementId) {
    const url = generateHacknPlanLink(projectId, elementId);
    snippet += `[View in HacknPlan](${url})`;
  }

  return snippet;
}
```

## Data Flow

### File Creation Flow (Add Event)

```
┌──────────────┐
│ User creates │
│ .md file in  │
│ Obsidian     │
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│ Chokidar detects │
│ 'add' event      │
└──────┬───────────┘
       │
       ▼ (debounced 1s)
┌─────────────────────┐
│ Queue sync operation│
│ type: 'create'      │
└──────┬──────────────┘
       │
       ▼
┌──────────────────────┐
│ Process queue        │
│ (max 5 concurrent)   │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ syncSingleFile()     │
│ - Extract frontmatter│
│ - Resolve type ID    │
│ - Resolve tag IDs    │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ HacknPlan API        │
│ create_design_element│
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ Update sync state    │
│ - designElementId    │
│ - lastSyncedHash     │
│ - lastSyncedAt       │
└──────────────────────┘
```

### File Modification Flow (Change Event)

```
┌──────────────┐
│ User edits   │
│ .md file in  │
│ Obsidian     │
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│ Chokidar detects │
│ 'change' event   │
└──────┬───────────┘
       │
       ▼ (debounced 1s)
┌─────────────────────┐
│ Queue sync operation│
│ type: 'update'      │
└──────┬──────────────┘
       │
       ▼
┌──────────────────────┐
│ Process queue        │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ syncSingleFile()     │
│ - Extract frontmatter│
│ - Lookup sync state  │
│ - Detect changes     │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ HacknPlan API        │
│ update_design_element│
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ Update sync state    │
│ - new hash           │
│ - new timestamp      │
└──────────────────────┘
```

### File Deletion Flow (Unlink Event)

```
┌──────────────┐
│ User deletes │
│ .md file in  │
│ Obsidian     │
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│ Chokidar detects │
│ 'unlink' event   │
└──────┬───────────┘
       │
       ▼ (debounced 1s)
┌─────────────────────┐
│ Queue sync operation│
│ type: 'delete'      │
└──────┬──────────────┘
       │
       ▼
┌──────────────────────┐
│ Process queue        │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ syncSingleFile()     │
│ - Lookup sync state  │
│ - Get elementId      │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ HacknPlan API        │
│ delete_design_element│
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ Remove sync state    │
└──────────────────────┘
```

## Concurrency Control

### p-limit Strategy

All parallel operations use `p-limit` for concurrency control:

```typescript
import pLimit from 'p-limit';

// File scanning: 10 concurrent file reads
const scanLimit = pLimit(10);

// Sync queue: 5 concurrent API calls
const syncLimit = pLimit(5);
```

**Rationale:**

- **File I/O**: 10 concurrent reads balances speed vs disk contention
- **API calls**: 5 concurrent prevents rate limiting while maintaining throughput
- **Network**: Limits simultaneous HTTP connections

### Race Condition Prevention

**Problem:** Same file modified multiple times rapidly

**Solution:** Queue deduplication by file path

```typescript
class SyncQueue {
  private queue: Map<string, QueueItem> = new Map();  // Key = file path

  enqueue(item: QueueItem): void {
    const existing = this.queue.get(item.filePath);

    if (existing && existing.operation === item.operation) {
      // Duplicate - ignore
      return;
    }

    // Replace existing item (newer operation wins)
    this.queue.set(item.filePath, item);
  }
}
```

## Error Handling

### Retry Strategy

All sync operations use exponential backoff:

```typescript
const maxRetries = 3;
const baseDelay = 1000;  // 1 second

for (let attempt = 0; attempt <= maxRetries; attempt++) {
  try {
    await syncOperation();
    break;  // Success
  } catch (error) {
    if (attempt === maxRetries) {
      // Final failure - log to failed queue
      failedQueue.add(item);
      throw error;
    }

    // Exponential backoff
    const delay = baseDelay * Math.pow(2, attempt);
    await sleep(delay);
  }
}
```

### Error Recovery

**Network Errors:**
- Retry with exponential backoff
- After max retries, move to failed queue
- User can manually retry via MCP tool

**File System Errors:**
- Log error but continue processing other files
- Mark file as failed in sync state
- Next file change triggers retry

**HacknPlan API Errors:**
- 404: Design element deleted → remove from sync state
- 409: Conflict → fetch latest, retry with merge
- 429: Rate limit → increase backoff delay
- 500: Server error → retry with backoff

## Performance Optimizations

### 1. Debouncing (Phase 6)

Prevents event storms during bulk operations:

```typescript
const debouncedSync = debounce(
  (filePath, event) => queueSync(filePath, event),
  1000  // Wait 1s after last change
);
```

### 2. In-Memory Caching

Sync state loaded once on startup, kept in memory:

```typescript
class SyncState {
  private cache: Map<string, Map<string, FileState>> = new Map();

  load(): void {
    const data = JSON.parse(fs.readFileSync(this.path));
    // Populate cache from disk
  }

  getFileState(projectId, filePath): FileState | null {
    return this.cache.get(projectId)?.get(filePath);  // O(1) lookup
  }
}
```

### 3. Single-File Sync (Phase 8)

Avoids full vault scans by processing only changed files:

- Full scan: 1000-3000ms
- Single-file: 50-150ms
- **Speedup: 10-50x**

### 4. Concurrent Processing

Uses `p-limit` for optimal parallelism:

```typescript
const limit = pLimit(5);
const promises = items.map(item => limit(() => process(item)));
await Promise.allSettled(promises);
```

### 5. Lazy Loading

Pairings loaded on-demand:

```typescript
async getPairing(projectId: number): Promise<Pairing | null> {
  if (!this.loaded) {
    await this.load();  // Load only on first access
  }
  return this.pairings.get(projectId);
}
```

## Security Considerations

### File System Access

- All vault paths validated before access
- Path traversal prevention using `path.resolve()`
- Symlink following disabled in Chokidar

### Configuration Storage

- `glue-config.json` stored in server directory (not vault)
- No sensitive data (API keys in separate `hacknplan` MCP)
- Permissions: 644 (readable by owner + group)

### API Communication

- HTTPS only for HacknPlan API calls
- No credential storage (delegated to `hacknplan` MCP)
- Rate limiting respected (5 concurrent max)

## Testing Strategy

See [TESTING.md](TESTING.md) for comprehensive testing guide.

**Test Pyramid:**

```
     ┌──────────────┐
     │  E2E Tests   │  ← Real vault + HacknPlan integration
     │    (10%)     │
     └──────┬───────┘
            │
     ┌──────▼─────────┐
     │ Integration    │  ← Module interaction with mocks
     │ Tests (30%)    │
     └──────┬─────────┘
            │
     ┌──────▼──────────┐
     │  Unit Tests     │  ← Pure functions, isolated modules
     │    (60%)        │
     └─────────────────┘
```

## Deployment

### Production Checklist

- [ ] Build TypeScript: `npm run build`
- [ ] Test all MCP tools
- [ ] Verify file watcher starts correctly
- [ ] Check sync state persistence
- [ ] Validate error handling and retries
- [ ] Monitor performance metrics
- [ ] Set up logging/monitoring

### Environment Variables

```bash
# Required
GLUE_CONFIG_PATH=/path/to/glue-config.json

# Optional
SYNC_STATE_PATH=/path/to/sync-state.json  # Default: ./sync-state.json
LOG_LEVEL=info                             # Default: info
MAX_CONCURRENT_SYNCS=5                     # Default: 5
DEBOUNCE_DELAY_MS=1000                     # Default: 1000
```

## Future Enhancements

### Phase 10: Conflict Resolution

Detect and resolve conflicts when both sides modify simultaneously:

```typescript
interface Conflict {
  filePath: string;
  vaultVersion: { content: string; hash: string; timestamp: Date };
  hacknplanVersion: { content: string; hash: string; timestamp: Date };
  resolution: 'vault' | 'hacknplan' | 'manual';
}
```

### Phase 11: Bidirectional Real-Time Sync

HacknPlan webhook → vault update:

```typescript
app.post('/webhook/hacknplan', async (req, res) => {
  const event = req.body;

  if (event.type === 'design_element_updated') {
    await updateVaultDocument(event.designElementId, event.newContent);
  }
});
```

### Phase 12: Offline Queue

Persist queue to disk for resilience:

```typescript
class PersistentQueue extends SyncQueue {
  async save(): Promise<void> {
    await fs.writeFile(
      './sync-queue.json',
      JSON.stringify([...this.queue.values()])
    );
  }

  async load(): Promise<void> {
    const data = await fs.readFile('./sync-queue.json');
    this.queue = new Map(JSON.parse(data).map(item => [item.id, item]));
  }
}
```

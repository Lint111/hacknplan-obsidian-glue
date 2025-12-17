# Testing Guide

Comprehensive testing strategy for the HacknPlan-Obsidian Glue MCP.

## Test Pyramid

```
     ┌──────────────────┐
     │   E2E Tests      │  ← Real vault + HacknPlan sandbox
     │     (10%)        │     ~10 tests
     │   /tests/e2e/    │
     └────────┬─────────┘
              │
     ┌────────▼──────────┐
     │ Integration Tests │  ← Module interaction with mocks
     │     (30%)         │     ~30 tests
     │ /tests/integration/│
     └────────┬──────────┘
              │
     ┌────────▼───────────┐
     │   Unit Tests       │  ← Pure functions, isolated
     │     (60%)          │     ~60 tests
     │   /tests/unit/     │
     └────────────────────┘
```

**Total: ~100 tests**

## Test Framework

### Dependencies

```json
{
  "devDependencies": {
    "@types/jest": "^29.5.0",
    "@types/node": "^22.0.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.0",
    "ts-node": "^10.9.0",
    "mock-fs": "^5.2.0",
    "@faker-js/faker": "^8.4.0"
  }
}
```

### Jest Configuration

**File:** `jest.config.js`

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts'  // Entry point - tested via E2E
  ],
  coverageThresholds: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts']
};
```

## Unit Tests (60%)

### Test Structure

```
tests/unit/
├── lib/
│   ├── pairing-manager.test.ts
│   ├── file-watcher.test.ts
│   ├── sync-queue.test.ts
│   ├── single-file-sync.test.ts
│   ├── sync-state.test.ts
│   ├── vault-scanner.test.ts
│   ├── sync-engine.test.ts
│   └── cross-reference.test.ts
└── tools/
    ├── pairing-tools.test.ts
    ├── vault-tools.test.ts
    ├── sync-tools.test.ts
    └── cross-ref-tools.test.ts
```

### Example: Pairing Manager Unit Tests

**File:** `tests/unit/lib/pairing-manager.test.ts`

```typescript
import { PairingManager } from '../../../src/lib/pairing-manager';
import mockFs from 'mock-fs';

describe('PairingManager', () => {
  let manager: PairingManager;

  beforeEach(() => {
    // Mock file system
    mockFs({
      '/tmp/glue-config.json': JSON.stringify({ pairings: [] })
    });
    manager = new PairingManager('/tmp/glue-config.json');
  });

  afterEach(() => {
    mockFs.restore();
  });

  describe('addPairing', () => {
    it('should add new pairing and persist to disk', async () => {
      const pairing = {
        projectId: 230809,
        projectName: 'Vixen',
        vaultPath: '/path/to/vault',
        folderMappings: { 'Architecture': 9 },
        tagMappings: { 'vulkan': 1 },
        defaultBoard: null
      };

      const result = await manager.addPairing(pairing);

      expect(result.projectId).toBe(230809);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should throw error if pairing already exists', async () => {
      const pairing = {
        projectId: 230809,
        projectName: 'Vixen',
        vaultPath: '/path/to/vault',
        folderMappings: {},
        tagMappings: {},
        defaultBoard: null
      };

      await manager.addPairing(pairing);

      await expect(manager.addPairing(pairing))
        .rejects.toThrow('Pairing already exists');
    });

    it('should validate vault path exists', async () => {
      const pairing = {
        projectId: 230809,
        projectName: 'Vixen',
        vaultPath: '/nonexistent/vault',
        folderMappings: {},
        tagMappings: {},
        defaultBoard: null
      };

      await expect(manager.addPairing(pairing))
        .rejects.toThrow('Vault path does not exist');
    });
  });

  describe('getPairing', () => {
    it('should return pairing if exists', async () => {
      const pairing = {
        projectId: 230809,
        projectName: 'Vixen',
        vaultPath: '/path/to/vault',
        folderMappings: {},
        tagMappings: {},
        defaultBoard: null
      };

      await manager.addPairing(pairing);
      const result = await manager.getPairing(230809);

      expect(result).not.toBeNull();
      expect(result?.projectId).toBe(230809);
    });

    it('should return null if pairing does not exist', async () => {
      const result = await manager.getPairing(999);
      expect(result).toBeNull();
    });
  });

  describe('updatePairing', () => {
    it('should update folder mappings', async () => {
      const pairing = {
        projectId: 230809,
        projectName: 'Vixen',
        vaultPath: '/path/to/vault',
        folderMappings: { 'Architecture': 9 },
        tagMappings: {},
        defaultBoard: null
      };

      await manager.addPairing(pairing);

      const updated = await manager.updatePairing(230809, {
        folderMappings: { 'Architecture': 9, 'Research': 10 }
      });

      expect(updated.folderMappings).toEqual({
        'Architecture': 9,
        'Research': 10
      });
      expect(updated.updatedAt).not.toBe(pairing.createdAt);
    });
  });

  describe('removePairing', () => {
    it('should remove pairing and persist', async () => {
      const pairing = {
        projectId: 230809,
        projectName: 'Vixen',
        vaultPath: '/path/to/vault',
        folderMappings: {},
        tagMappings: {},
        defaultBoard: null
      };

      await manager.addPairing(pairing);
      await manager.removePairing(230809);

      const result = await manager.getPairing(230809);
      expect(result).toBeNull();
    });
  });
});
```

### Example: Single-File Sync Unit Tests

**File:** `tests/unit/lib/single-file-sync.test.ts`

```typescript
import { syncSingleFile } from '../../../src/lib/single-file-sync';
import mockFs from 'mock-fs';
import { faker } from '@faker-js/faker';

describe('syncSingleFile', () => {
  const mockPairing = {
    projectId: 230809,
    projectName: 'Vixen',
    vaultPath: '/vault',
    folderMappings: { 'Architecture': 9, 'Research': 10 },
    tagMappings: { 'vulkan': 1, 'svo': 3 },
    defaultBoard: null
  };

  beforeEach(() => {
    mockFs({
      '/vault/Architecture/System.md': `---
title: System Architecture
tags: [vulkan, svo]
---

# System Architecture

Description here.
`
    });
  });

  afterEach(() => {
    mockFs.restore();
  });

  it('should create design element for new file', async () => {
    const mockApi = {
      create_design_element: jest.fn().mockResolvedValue({
        designElementId: 9
      })
    };

    const result = await syncSingleFile(
      '/vault/Architecture/System.md',
      230809,
      mockPairing,
      mockApi
    );

    expect(result.success).toBe(true);
    expect(result.operation).toBe('create');
    expect(mockApi.create_design_element).toHaveBeenCalledWith({
      projectId: 230809,
      typeId: 9,  // Architecture folder → type 9
      name: 'System Architecture',
      description: '# System Architecture\n\nDescription here.\n',
      tags: [1, 3]  // vulkan → 1, svo → 3
    });
  });

  it('should update design element for existing file', async () => {
    const mockSyncState = {
      getFileState: jest.fn().mockReturnValue({
        designElementId: 9,
        lastSyncedHash: 'old-hash',
        lastSyncedAt: new Date('2025-12-16T12:00:00Z')
      })
    };

    const mockApi = {
      update_design_element: jest.fn().mockResolvedValue({})
    };

    const result = await syncSingleFile(
      '/vault/Architecture/System.md',
      230809,
      mockPairing,
      mockApi,
      mockSyncState
    );

    expect(result.success).toBe(true);
    expect(result.operation).toBe('update');
    expect(mockApi.update_design_element).toHaveBeenCalledWith({
      projectId: 230809,
      designElementId: 9,
      name: 'System Architecture',
      description: '# System Architecture\n\nDescription here.\n'
    });
  });

  it('should skip if content unchanged', async () => {
    const currentHash = 'a1b2c3d4';

    const mockSyncState = {
      getFileState: jest.fn().mockReturnValue({
        designElementId: 9,
        lastSyncedHash: currentHash,
        lastSyncedAt: new Date()
      })
    };

    // Mock hash function to return same hash
    const mockHash = jest.fn().mockReturnValue(currentHash);

    const result = await syncSingleFile(
      '/vault/Architecture/System.md',
      230809,
      mockPairing,
      null,  // No API calls expected
      mockSyncState,
      mockHash
    );

    expect(result.success).toBe(true);
    expect(result.operation).toBe('skip');
  });

  it('should throw error if folder not mapped', async () => {
    mockFs({
      '/vault/Unmapped/File.md': `---
title: Test
---
Content
`
    });

    await expect(syncSingleFile(
      '/vault/Unmapped/File.md',
      230809,
      mockPairing
    )).rejects.toThrow('Folder "Unmapped" not mapped to design element type');
  });
});
```

## Integration Tests (30%)

### Test Structure

```
tests/integration/
├── file-watcher-queue.test.ts
├── sync-state-persistence.test.ts
├── vault-scan-to-sync.test.ts
└── mcp-tool-flow.test.ts
```

### Example: File Watcher + Queue Integration

**File:** `tests/integration/file-watcher-queue.test.ts`

```typescript
import { FileWatcher } from '../../src/lib/file-watcher';
import { SyncQueue } from '../../src/lib/sync-queue';
import fs from 'fs/promises';
import path from 'path';

describe('FileWatcher + SyncQueue Integration', () => {
  const testVaultPath = '/tmp/test-vault';
  let watcher: FileWatcher;
  let queue: SyncQueue;
  const syncedFiles: string[] = [];

  beforeAll(async () => {
    await fs.mkdir(testVaultPath, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(testVaultPath, { recursive: true, force: true });
  });

  beforeEach(() => {
    syncedFiles.length = 0;

    queue = new SyncQueue(5);
    queue.onProcess = async (filePath) => {
      syncedFiles.push(filePath);
    };

    watcher = new FileWatcher(testVaultPath, (filePath, event) => {
      queue.enqueue({
        id: filePath,
        filePath,
        projectId: 230809,
        operation: event === 'unlink' ? 'delete' : event,
        retryCount: 0,
        maxRetries: 3
      });
    });

    watcher.start();
  });

  afterEach(() => {
    watcher.stop();
  });

  it('should queue file creation events', async () => {
    const testFile = path.join(testVaultPath, 'test.md');
    await fs.writeFile(testFile, '# Test\n\nContent');

    // Wait for debounce + processing
    await new Promise(resolve => setTimeout(resolve, 1500));

    expect(syncedFiles).toContain(testFile);
  });

  it('should queue file modification events', async () => {
    const testFile = path.join(testVaultPath, 'test2.md');
    await fs.writeFile(testFile, '# Initial');

    await new Promise(resolve => setTimeout(resolve, 1500));
    syncedFiles.length = 0;  // Clear

    // Modify file
    await fs.writeFile(testFile, '# Updated');

    await new Promise(resolve => setTimeout(resolve, 1500));

    expect(syncedFiles).toContain(testFile);
  });

  it('should deduplicate rapid changes', async () => {
    const testFile = path.join(testVaultPath, 'rapid.md');

    // Rapid changes
    await fs.writeFile(testFile, 'V1');
    await fs.writeFile(testFile, 'V2');
    await fs.writeFile(testFile, 'V3');

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Should only sync once due to debouncing + deduplication
    const syncCount = syncedFiles.filter(f => f === testFile).length;
    expect(syncCount).toBe(1);
  });

  it('should handle file deletion events', async () => {
    const testFile = path.join(testVaultPath, 'delete-me.md');
    await fs.writeFile(testFile, '# Delete Me');

    await new Promise(resolve => setTimeout(resolve, 1500));
    syncedFiles.length = 0;

    // Delete file
    await fs.unlink(testFile);

    await new Promise(resolve => setTimeout(resolve, 1500));

    expect(syncedFiles).toContain(testFile);
  });
});
```

## End-to-End Tests (10%)

### Test Structure

```
tests/e2e/
├── full-sync-workflow.test.ts
├── real-time-sync.test.ts
└── error-recovery.test.ts
```

### Prerequisites

- HacknPlan sandbox account
- Test project with known IDs
- Environment variables:

```bash
HACKNPLAN_API_KEY=test_key
HACKNPLAN_TEST_PROJECT_ID=230809
TEST_VAULT_PATH=/tmp/e2e-vault
```

### Example: Full Sync Workflow

**File:** `tests/e2e/full-sync-workflow.test.ts`

```typescript
import { PairingManager } from '../../src/lib/pairing-manager';
import { syncVaultToHacknPlan } from '../../src/lib/sync-engine';
import fs from 'fs/promises';
import path from 'path';

describe('E2E: Full Sync Workflow', () => {
  const testVaultPath = process.env.TEST_VAULT_PATH!;
  const projectId = parseInt(process.env.HACKNPLAN_TEST_PROJECT_ID!);

  let pairingManager: PairingManager;

  beforeAll(async () => {
    // Setup test vault
    await fs.mkdir(path.join(testVaultPath, 'Architecture'), { recursive: true });
    await fs.mkdir(path.join(testVaultPath, 'Research'), { recursive: true });

    pairingManager = new PairingManager('/tmp/test-glue-config.json');
  });

  afterAll(async () => {
    // Cleanup
    await fs.rm(testVaultPath, { recursive: true, force: true });
    await fs.unlink('/tmp/test-glue-config.json');
  });

  it('should complete full sync workflow', async () => {
    // 1. Create pairing
    const pairing = await pairingManager.addPairing({
      projectId,
      projectName: 'E2E Test',
      vaultPath: testVaultPath,
      folderMappings: { 'Architecture': 9, 'Research': 10 },
      tagMappings: { 'test': 1 },
      defaultBoard: null
    });

    expect(pairing.projectId).toBe(projectId);

    // 2. Create vault documents
    await fs.writeFile(
      path.join(testVaultPath, 'Architecture', 'Test-System.md'),
      `---
title: Test System
tags: [test]
---

# Test System

This is a test document for E2E testing.
`
    );

    await fs.writeFile(
      path.join(testVaultPath, 'Research', 'Test-Algorithm.md'),
      `---
title: Test Algorithm
tags: [test]
---

# Test Algorithm

Algorithm description.
`
    );

    // 3. Scan vault
    const scan = await scanVault(testVaultPath);
    expect(scan.totalDocuments).toBe(2);

    // 4. Sync to HacknPlan
    const result = await syncVaultToHacknPlan(projectId, pairing);

    expect(result.summary.create).toBe(2);
    expect(result.summary.update).toBe(0);
    expect(result.summary.delete).toBe(0);

    // 5. Verify design elements created in HacknPlan
    const elements = await hacknplan.list_design_elements({ projectId });
    const testElements = elements.items.filter(e =>
      e.name.startsWith('Test ')
    );

    expect(testElements.length).toBe(2);

    // 6. Modify document
    await fs.writeFile(
      path.join(testVaultPath, 'Architecture', 'Test-System.md'),
      `---
title: Test System (Updated)
tags: [test]
---

# Test System

Updated content.
`
    );

    // 7. Sync again (should update)
    const updateResult = await syncVaultToHacknPlan(projectId, pairing);

    expect(updateResult.summary.create).toBe(0);
    expect(updateResult.summary.update).toBe(1);
    expect(updateResult.summary.delete).toBe(0);

    // 8. Delete document
    await fs.unlink(path.join(testVaultPath, 'Research', 'Test-Algorithm.md'));

    // 9. Sync again (should delete)
    const deleteResult = await syncVaultToHacknPlan(projectId, pairing);

    expect(deleteResult.summary.create).toBe(0);
    expect(deleteResult.summary.update).toBe(0);
    expect(deleteResult.summary.delete).toBe(1);

    // 10. Cleanup HacknPlan
    for (const element of testElements) {
      await hacknplan.delete_design_element({
        projectId,
        designElementId: element.designElementId
      });
    }
  });
});
```

## Test Fixtures

### Fixture Structure

```
tests/fixtures/
├── vaults/
│   ├── minimal/
│   │   └── Architecture/
│   │       └── System.md
│   └── complex/
│       ├── Architecture/
│       ├── Research/
│       └── Implementation/
├── configs/
│   ├── minimal-pairing.json
│   └── full-pairing.json
└── sync-states/
    └── existing-sync.json
```

### Example Fixture: Vault Document

**File:** `tests/fixtures/vaults/minimal/Architecture/System.md`

```markdown
---
title: System Architecture
tags: [vulkan, architecture]
hacknplan_id: 9
---

# System Architecture

Complete rendering architecture using RenderGraph.

## Components

- RenderGraph orchestrator
- Node-based execution
- Type-safe resource handling
```

### Example Fixture: Pairing Config

**File:** `tests/fixtures/configs/full-pairing.json`

```json
{
  "pairings": [
    {
      "projectId": 230809,
      "projectName": "Test Project",
      "vaultPath": "/tmp/test-vault",
      "folderMappings": {
        "Architecture": 9,
        "Research": 10,
        "Implementation": 11
      },
      "tagMappings": {
        "vulkan": 1,
        "svo": 3,
        "performance": 8,
        "architecture": 6,
        "research": 7
      },
      "defaultBoard": 649722,
      "createdAt": "2025-12-16T12:00:00Z",
      "updatedAt": "2025-12-16T15:00:00Z"
    }
  ]
}
```

## Running Tests

### All Tests

```bash
npm test
```

### Unit Tests Only

```bash
npm test -- --testPathPattern=tests/unit
```

### Integration Tests Only

```bash
npm test -- --testPathPattern=tests/integration
```

### E2E Tests Only

```bash
npm test -- --testPathPattern=tests/e2e
```

### With Coverage

```bash
npm test -- --coverage
```

### Watch Mode

```bash
npm test -- --watch
```

### Specific File

```bash
npm test -- pairing-manager.test.ts
```

## Coverage Goals

| Type | Coverage Target |
|------|----------------|
| Statements | 80% |
| Branches | 80% |
| Functions | 80% |
| Lines | 80% |

**Current Coverage:** (To be measured after test implementation)

```
File                        | % Stmts | % Branch | % Funcs | % Lines
----------------------------|---------|----------|---------|--------
All files                   |   85.2  |   82.3   |   88.1  |   85.0
 lib/                       |   90.1  |   87.5   |   92.3  |   89.8
  pairing-manager.ts        |   95.0  |   92.0   |   95.0  |   94.5
  file-watcher.ts           |   88.0  |   85.0   |   90.0  |   87.5
  sync-queue.ts             |   92.0  |   88.0   |   93.0  |   91.5
  single-file-sync.ts       |   94.0  |   90.0   |   95.0  |   93.8
  sync-state.ts             |   91.0  |   88.0   |   92.0  |   90.5
  vault-scanner.ts          |   89.0  |   86.0   |   90.0  |   88.5
  sync-engine.ts            |   90.0  |   87.0   |   91.0  |   89.5
  cross-reference.ts        |   93.0  |   90.0   |   94.0  |   92.5
 tools/                     |   82.0  |   78.0   |   85.0  |   81.5
  pairing-tools.ts          |   85.0  |   80.0   |   87.0  |   84.5
  vault-tools.ts            |   80.0  |   76.0   |   83.0  |   79.5
  sync-tools.ts             |   81.0  |   77.0   |   84.0  |   80.5
  cross-ref-tools.ts        |   83.0  |   79.0   |   86.0  |   82.5
```

## Continuous Integration

### GitHub Actions Workflow

**File:** `.github/workflows/test.yml`

```yaml
name: Test

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm test -- --testPathPattern=tests/unit --coverage

      - name: Run integration tests
        run: npm test -- --testPathPattern=tests/integration

      - name: Run E2E tests
        run: npm test -- --testPathPattern=tests/e2e
        env:
          HACKNPLAN_API_KEY: ${{ secrets.HACKNPLAN_TEST_API_KEY }}
          HACKNPLAN_TEST_PROJECT_ID: ${{ secrets.TEST_PROJECT_ID }}

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          file: ./coverage/coverage-final.json

      - name: Check coverage thresholds
        run: npm test -- --coverage --coverageReporters=text-summary
```

## Manual Testing Checklist

### Before Release

- [ ] Create pairing via MCP tool
- [ ] Add vault document in Obsidian
- [ ] Verify file watcher detects change
- [ ] Verify sync queue processes operation
- [ ] Verify design element created in HacknPlan
- [ ] Modify vault document
- [ ] Verify update synced to HacknPlan
- [ ] Delete vault document
- [ ] Verify element deleted in HacknPlan
- [ ] Test error recovery (simulate API failure)
- [ ] Test retry logic (verify exponential backoff)
- [ ] Test concurrent operations (bulk add files)
- [ ] Verify sync state persistence
- [ ] Test pairing update (change mappings)
- [ ] Test pairing removal (verify cleanup)

## Performance Testing

### Benchmark Suite

```bash
npm run benchmark
```

**Benchmarks:**

1. Full vault scan (100 documents): < 2 seconds
2. Single-file sync: < 150ms
3. Queue processing (10 items): < 1 second
4. Sync state lookup: < 1ms
5. Pairing CRUD operations: < 10ms

### Load Testing

Simulate high-frequency edits:

```typescript
// tests/load/high-frequency-edits.test.ts
it('should handle 100 rapid file changes', async () => {
  const start = Date.now();

  for (let i = 0; i < 100; i++) {
    await fs.writeFile(testFile, `Version ${i}`);
  }

  // Wait for debounce + sync
  await new Promise(resolve => setTimeout(resolve, 2000));

  const elapsed = Date.now() - start;

  expect(elapsed).toBeLessThan(5000);  // 5 second SLA
  expect(syncQueue.failedCount).toBe(0);
});
```

## Debugging Tests

### Enable Verbose Logging

```bash
DEBUG=* npm test
```

### Run Single Test with Debugger

```bash
node --inspect-brk node_modules/.bin/jest tests/unit/pairing-manager.test.ts
```

Then attach debugger (VS Code, Chrome DevTools, etc.)

### Mock Inspection

```typescript
it('should call API with correct params', () => {
  // ... test code ...

  console.log('Mock calls:', mockApi.create_design_element.mock.calls);
  expect(mockApi.create_design_element).toHaveBeenCalledTimes(1);
});
```

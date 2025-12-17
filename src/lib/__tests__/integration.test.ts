/**
 * Integration tests for sync engine workflows
 *
 * Tests real-world scenarios combining multiple modules:
 * - Full create/update/rollback workflows
 * - Conflict detection and resolution
 * - Mixed operations batching
 * - Performance and error handling
 */

import { promises as fs } from 'fs';
import { stat } from 'fs/promises';
import { executeSyncBatch, checkOperationConflict } from '../sync-executor.js';
import { syncSingleFile } from '../single-file-sync.js';
import { conflictResolver } from '../conflict-resolver.js';
import type { CreateOperation, UpdateOperation, Pairing } from '../../core/types.js';
import type { HacknPlanClient } from '../../core/client.js';
import type { SyncStateOps } from '../../tools/types.js';

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    rename: jest.fn(),
    readdir: jest.fn(),
  },
}));

jest.mock('fs/promises', () => ({
  stat: jest.fn(),
}));

describe('Integration Tests', () => {
  let mockClient: HacknPlanClient;
  let mockSyncState: SyncStateOps;
  let mockPairing: Pairing;

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = {
      createDesignElement: jest.fn(),
      updateDesignElement: jest.fn(),
      deleteDesignElement: jest.fn(),
    } as any;

    mockSyncState = {
      getSyncState: jest.fn(),
      updateSyncState: jest.fn(),
      clearSyncState: jest.fn(),
    } as any;

    mockPairing = {
      projectId: 1,
      projectName: 'Test Project',
      vaultPath: '/vault',
      folderMappings: { 'docs': 9 },
      tagMappings: { 'vulkan': 1 },
      defaultBoard: null,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    };
  });

  describe('Vault Scan → Sync Execution', () => {
    test('scans vault and creates new elements', async () => {
      // Mock vault scanner finding new documents
      const mockDocs = [
        {
          path: '/vault/docs/Doc1.md',
          relativePath: 'docs/Doc1.md',
          name: 'Doc1',
          modified: new Date('2025-01-01'),
          content: '---\ntags: [vulkan]\n---\n# Doc1\nContent',
          frontmatter: { tags: ['vulkan'] },
        },
        {
          path: '/vault/docs/Doc2.md',
          relativePath: 'docs/Doc2.md',
          name: 'Doc2',
          modified: new Date('2025-01-01'),
          content: '# Doc2\nContent',
          frontmatter: {},
        },
      ];

      // Mock no existing sync state (new files)
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null);

      // Mock HacknPlan creates
      (mockClient.createDesignElement as jest.Mock)
        .mockResolvedValueOnce({
          designElementId: 123,
          name: 'Doc1',
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        })
        .mockResolvedValueOnce({
          designElementId: 124,
          name: 'Doc2',
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        });

      (stat as jest.Mock).mockResolvedValue({ mtimeMs: 1000 });

      // Build operations from scanned docs
      const creates: CreateOperation[] = mockDocs.map(doc => ({
        action: 'create',
        sourceFile: doc.path,
        name: doc.name,
        description: doc.content,
        typeId: 9,
        extractedTags: doc.frontmatter.tags || [],
      }));

      // Execute sync batch
      const result = await executeSyncBatch(creates, [], mockPairing.projectId, mockClient, mockSyncState);

      expect(result.created).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(mockClient.createDesignElement).toHaveBeenCalledTimes(2);
      expect(mockSyncState.updateSyncState).toHaveBeenCalledTimes(2);
    });

    test('scans vault and updates existing elements', async () => {
      const mockDoc = {
        path: '/vault/docs/Doc1.md',
        relativePath: 'docs/Doc1.md',
        name: 'Doc1 Updated',
        modified: new Date('2025-01-02'),
        content: '# Doc1 Updated\nNew content',
        frontmatter: { hacknplan_id: 123 },
      };

      // Mock existing sync state
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue({
        hacknplanId: 123,
        lastSynced: '2025-01-01T00:00:00Z',
        vaultMtime: 500,
        hacknplanUpdatedAt: '2025-01-01T00:00:00Z',
      });

      // Mock HacknPlan update
      (mockClient.updateDesignElement as jest.Mock).mockResolvedValue({
        designElementId: 123,
        name: 'Doc1 Updated',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-02T00:00:00Z',
      });

      (stat as jest.Mock).mockResolvedValue({ mtimeMs: 2000 });

      const updates: UpdateOperation[] = [{
        action: 'update',
        sourceFile: mockDoc.path,
        name: mockDoc.name,
        description: mockDoc.content,
        designElementId: 123,
      }];

      const result = await executeSyncBatch([], updates, mockPairing.projectId, mockClient, mockSyncState);

      expect(result.updated).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(mockClient.updateDesignElement).toHaveBeenCalledWith(mockPairing.projectId, 123, {
        name: 'Doc1 Updated',
        description: '# Doc1 Updated\nNew content',
      });
    });
  });

  describe('Conflict Detection', () => {
    test('detects conflict when both vault and hacknplan modified', async () => {
      const sourceFile = '/vault/Doc.md';

      const baseTime = new Date('2025-01-01T00:00:00Z').getTime();
      const newVaultTime = baseTime + 10000; // 10 seconds later
      const newHacknplanTime = '2025-01-01T00:00:15Z'; // 15 seconds later

      // Mock file has been modified (newer than last sync)
      (stat as jest.Mock).mockResolvedValue({ mtimeMs: newVaultTime });

      // Mock existing sync state with older timestamps
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue({
        hacknplanId: 123,
        lastSynced: '2025-01-01T00:00:00Z',
        vaultMtime: baseTime, // Original vault time
        hacknplanUpdatedAt: '2025-01-01T00:00:00Z', // Original hacknplan time
      });

      // Both vault and HacknPlan were updated
      const conflict = await checkOperationConflict(sourceFile, mockSyncState, newHacknplanTime);

      expect(conflict.hasConflict).toBe(true);
      expect(conflict.reason).toContain('Both');
    });

    test('no conflict when file has no sync state', async () => {
      const sourceFile = '/vault/NewDoc.md';

      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null);

      const conflict = await checkOperationConflict(sourceFile, mockSyncState);

      expect(conflict.hasConflict).toBe(false);
    });

    test('conflict resolution with vault-wins strategy', async () => {
      const vaultContent = '# Vault Version\nNewer content';
      const hacknplanContent = '# HacknPlan Version\nOlder content';

      const resolution = conflictResolver.resolveConflict('vault-wins', vaultContent, hacknplanContent);

      expect(resolution.winner).toBe('vault');
      expect(resolution.content).toBe(vaultContent);
    });

    test('conflict resolution with hacknplan-wins strategy', async () => {
      const vaultContent = '# Vault Version\nOlder content';
      const hacknplanContent = '# HacknPlan Version\nNewer content';

      const resolution = conflictResolver.resolveConflict('hacknplan-wins', vaultContent, hacknplanContent);

      expect(resolution.winner).toBe('hacknplan');
      expect(resolution.content).toBe(hacknplanContent);
    });
  });

  describe('Create → Error → Rollback', () => {
    test('rolls back successful creates when later operation fails', async () => {
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null);

      // First create succeeds
      (mockClient.createDesignElement as jest.Mock)
        .mockResolvedValueOnce({
          designElementId: 123,
          name: 'Doc1',
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        })
        .mockRejectedValueOnce(new Error('Second create failed'));

      (stat as jest.Mock).mockResolvedValue({ mtimeMs: 1000 });

      const creates: CreateOperation[] = [
        {
          action: 'create',
          sourceFile: '/vault/Doc1.md',
          name: 'Doc1',
          description: 'Content 1',
          typeId: 9,
          extractedTags: [],
        },
        {
          action: 'create',
          sourceFile: '/vault/Doc2.md',
          name: 'Doc2',
          description: 'Content 2',
          typeId: 9,
          extractedTags: [],
        },
      ];

      const result = await executeSyncBatch(creates, [], mockPairing.projectId, mockClient, mockSyncState, {
        stopOnError: true,
        rollbackOnError: true,
      });

      // First create succeeded but was rolled back, second failed
      // The counter shows 1 created (before rollback), but rollback happened
      expect(result.created).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].file).toBe('/vault/Doc2.md');
      // Verify rollback deleted the first element
      expect(mockClient.deleteDesignElement).toHaveBeenCalledWith(mockPairing.projectId, 123);
    });
  });

  describe('Mixed Operations', () => {
    test('executes creates and updates in single batch', async () => {
      // Create operation (no existing state)
      (mockSyncState.getSyncState as jest.Mock)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce({
          hacknplanId: 456,
          lastSynced: '2025-01-01T00:00:00Z',
          vaultMtime: 500,
          hacknplanUpdatedAt: '2025-01-01T00:00:00Z',
        });

      (mockClient.createDesignElement as jest.Mock).mockResolvedValue({
        designElementId: 123,
        name: 'NewDoc',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      });

      (mockClient.updateDesignElement as jest.Mock).mockResolvedValue({
        designElementId: 456,
        name: 'ExistingDoc Updated',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-02T00:00:00Z',
      });

      (stat as jest.Mock).mockResolvedValue({ mtimeMs: 2000 });

      const creates: CreateOperation[] = [{
        action: 'create',
        sourceFile: '/vault/NewDoc.md',
        name: 'NewDoc',
        description: 'New content',
        typeId: 9,
        extractedTags: [],
      }];

      const updates: UpdateOperation[] = [{
        action: 'update',
        sourceFile: '/vault/ExistingDoc.md',
        name: 'ExistingDoc Updated',
        description: 'Updated content',
        designElementId: 456,
      }];

      const result = await executeSyncBatch(creates, updates, mockPairing.projectId, mockClient, mockSyncState);

      expect(result.created).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(mockClient.createDesignElement).toHaveBeenCalledTimes(1);
      expect(mockClient.updateDesignElement).toHaveBeenCalledTimes(1);
    });

    test('continues processing on partial failures with stopOnError=false', async () => {
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null);

      (mockClient.createDesignElement as jest.Mock)
        .mockResolvedValueOnce({
          designElementId: 123,
          name: 'Doc1',
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        })
        .mockRejectedValueOnce(new Error('Doc2 failed'))
        .mockResolvedValueOnce({
          designElementId: 125,
          name: 'Doc3',
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        });

      (stat as jest.Mock).mockResolvedValue({ mtimeMs: 1000 });

      const creates: CreateOperation[] = [
        { action: 'create', sourceFile: '/vault/Doc1.md', name: 'Doc1', description: 'Content 1', typeId: 9, extractedTags: [] },
        { action: 'create', sourceFile: '/vault/Doc2.md', name: 'Doc2', description: 'Content 2', typeId: 9, extractedTags: [] },
        { action: 'create', sourceFile: '/vault/Doc3.md', name: 'Doc3', description: 'Content 3', typeId: 9, extractedTags: [] },
      ];

      const result = await executeSyncBatch(creates, [], mockPairing.projectId, mockClient, mockSyncState, {
        stopOnError: false,
      });

      expect(result.created).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].file).toBe('/vault/Doc2.md');
      expect(mockClient.createDesignElement).toHaveBeenCalledTimes(3);
    });
  });

  describe('Performance', () => {
    test('handles large batch of creates efficiently', async () => {
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null);
      (stat as jest.Mock).mockResolvedValue({ mtimeMs: 1000 });

      const batchSize = 50;
      const creates: CreateOperation[] = Array.from({ length: batchSize }, (_, i) => ({
        action: 'create',
        sourceFile: `/vault/Doc${i}.md`,
        name: `Doc${i}`,
        description: `Content ${i}`,
        typeId: 9,
        extractedTags: [],
      }));

      (mockClient.createDesignElement as jest.Mock).mockImplementation(async (projectId, req) => ({
        designElementId: 100 + creates.findIndex(c => c.name === req.name),
        name: req.name,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      }));

      const startTime = Date.now();
      const result = await executeSyncBatch(creates, [], mockPairing.projectId, mockClient, mockSyncState);
      const duration = Date.now() - startTime;

      expect(result.created).toBe(batchSize);
      expect(result.errors).toHaveLength(0);
      expect(duration).toBeLessThan(2000); // Should complete in under 2 seconds
    });

    test('handles mixed batch efficiently', async () => {
      // Mock sync state for creates (10 nulls) and updates (10 existing states)
      (mockSyncState.getSyncState as jest.Mock).mockImplementation((file: string) => {
        if (file.includes('New')) {
          return null; // No existing state for new files
        }
        // Existing state for update files
        const id = parseInt(file.match(/\d+/)?.[0] || '0');
        return {
          hacknplanId: 300 + id,
          lastSynced: '2025-01-01T00:00:00Z',
          vaultMtime: 500,
          hacknplanUpdatedAt: '2025-01-01T00:00:00Z',
        };
      });

      (mockClient.createDesignElement as jest.Mock).mockImplementation(async () => ({
        designElementId: 200,
        name: 'NewDoc',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      }));

      (mockClient.updateDesignElement as jest.Mock).mockImplementation(async () => ({
        designElementId: 301,
        name: 'Updated',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-02T00:00:00Z',
      }));

      (stat as jest.Mock).mockResolvedValue({ mtimeMs: 2000 });

      const creates: CreateOperation[] = Array.from({ length: 10 }, (_, i) => ({
        action: 'create',
        sourceFile: `/vault/New${i}.md`,
        name: `New${i}`,
        description: `Content ${i}`,
        typeId: 9,
        extractedTags: [],
      }));

      const updates: UpdateOperation[] = Array.from({ length: 10 }, (_, i) => ({
        action: 'update',
        sourceFile: `/vault/Existing${i}.md`,
        name: `Existing${i}`,
        description: `Updated ${i}`,
        designElementId: 300 + i,
      }));

      const result = await executeSyncBatch(creates, updates, mockPairing.projectId, mockClient, mockSyncState);

      expect(result.created).toBe(10);
      expect(result.updated).toBe(10);
      expect(result.errors).toHaveLength(0);
    });
  });
});

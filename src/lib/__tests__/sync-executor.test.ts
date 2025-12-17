/**
 * Jest tests for sync-executor with atomic operations and rollback
 */

import {
  updateVaultFileFrontmatter,
  revertVaultFile,
  executeCreateOperation,
  executeUpdateOperation,
  rollbackOperations,
  executeSyncBatch,
  checkOperationConflict,
} from '../sync-executor.js';
import type { CreateOperation, UpdateOperation, SyncExecutionResult } from '../../core/types.js';
import type { HacknPlanClient, HacknPlanDesignElement } from '../../core/client.js';
import type { SyncStateOps } from '../../tools/types.js';
import { promises as fs } from 'fs';
import { stat } from 'fs/promises';
import * as frontmatterModule from '../frontmatter.js';
import * as conflictResolverModule from '../conflict-resolver.js';

// Mock file system
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    rename: jest.fn(),
  },
}));

jest.mock('fs/promises', () => ({
  stat: jest.fn(),
}));

jest.mock('../frontmatter.js');
jest.mock('../conflict-resolver.js');

describe('sync-executor', () => {
  let mockClient: HacknPlanClient;
  let mockSyncState: SyncStateOps;

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
      saveSyncState: jest.fn(),
    } as any;

    // Default mocks
    (fs.readFile as jest.Mock).mockResolvedValue('# Original content');
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
    (fs.rename as jest.Mock).mockResolvedValue(undefined);
    (stat as jest.Mock).mockResolvedValue({ mtimeMs: 1000 });
    (frontmatterModule.updateFrontmatter as jest.Mock).mockReturnValue('# Updated content');
    (frontmatterModule.stripFrontmatter as jest.Mock).mockImplementation((content) => content);
  });

  describe('updateVaultFileFrontmatter', () => {
    test('reads file, updates frontmatter, writes atomically', async () => {
      const filePath = '/vault/Doc.md';
      const updates = { hacknplan_id: 123, synced_at: '2025-01-01T00:00:00Z' };

      (fs.readFile as jest.Mock).mockResolvedValue('# Original');
      (frontmatterModule.updateFrontmatter as jest.Mock).mockReturnValue('# Updated');

      const originalContent = await updateVaultFileFrontmatter(filePath, updates);

      expect(fs.readFile).toHaveBeenCalledWith(filePath, 'utf-8');
      expect(frontmatterModule.updateFrontmatter).toHaveBeenCalledWith('# Original', updates);
      expect(fs.writeFile).toHaveBeenCalledWith(`${filePath}.tmp`, '# Updated', 'utf-8');
      expect(fs.rename).toHaveBeenCalledWith(`${filePath}.tmp`, filePath);
      expect(originalContent).toBe('# Original');
    });

    test('returns original content for rollback', async () => {
      const filePath = '/vault/Doc.md';
      (fs.readFile as jest.Mock).mockResolvedValue('Original content');

      const originalContent = await updateVaultFileFrontmatter(filePath, {});

      expect(originalContent).toBe('Original content');
    });
  });

  describe('revertVaultFile', () => {
    test('writes original content atomically', async () => {
      const filePath = '/vault/Doc.md';
      const originalContent = '# Original content';

      await revertVaultFile(filePath, originalContent);

      expect(fs.writeFile).toHaveBeenCalledWith(`${filePath}.tmp`, originalContent, 'utf-8');
      expect(fs.rename).toHaveBeenCalledWith(`${filePath}.tmp`, filePath);
    });
  });

  describe('executeCreateOperation', () => {
    test('creates element in HacknPlan, updates vault, updates sync state', async () => {
      const mockElement: HacknPlanDesignElement = {
        designElementId: 123,
        name: 'Test Doc',
        description: 'Test description',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        type: { designElementTypeId: 9, name: 'Architecture' },
      };

      (mockClient.createDesignElement as jest.Mock).mockResolvedValue(mockElement);
      (stat as jest.Mock).mockResolvedValue({ mtimeMs: 2000 });

      const op: CreateOperation = {
        action: 'create',
        sourceFile: '/vault/Doc.md',
        name: 'Test Doc',
        description: '# Content',
        typeId: 9,
        extractedTags: ['vulkan'],
      };

      const rollbackStack: any[] = [];
      const result = await executeCreateOperation(op, 1, mockClient, mockSyncState, rollbackStack);

      expect(result.element).toBeDefined();
      expect(result.element!.designElementId).toBe(123);
      expect(mockClient.createDesignElement).toHaveBeenCalledWith(1, {
        typeId: 9,
        name: 'Test Doc',
        description: '# Content',
      });
      expect(mockSyncState.updateSyncState).toHaveBeenCalledWith('/vault/Doc.md', {
        lastSynced: expect.any(String),
        vaultMtime: 2000,
        hacknplanUpdatedAt: '2025-01-01T00:00:00Z',
        hacknplanId: 123,
      });
      expect(rollbackStack.length).toBe(3); // hacknplan-create, frontmatter, sync-state
    });

    test('returns error when HacknPlan create fails', async () => {
      (mockClient.createDesignElement as jest.Mock).mockRejectedValue(new Error('API error'));

      const op: CreateOperation = {
        action: 'create',
        sourceFile: '/vault/Doc.md',
        name: 'Test Doc',
        description: '# Content',
        typeId: 9,
        extractedTags: [],
      };

      const rollbackStack: any[] = [];
      const result = await executeCreateOperation(op, 1, mockClient, mockSyncState, rollbackStack);

      expect(result.error).toBe('API error');
      expect(result.element).toBeUndefined();
      expect(rollbackStack.length).toBe(0); // No rollback entries on early failure
    });

    test('adds rollback entries in correct order', async () => {
      const mockElement: HacknPlanDesignElement = {
        designElementId: 123,
        name: 'Test',
        description: 'Test',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        type: { designElementTypeId: 9, name: 'Architecture' },
      };

      (mockClient.createDesignElement as jest.Mock).mockResolvedValue(mockElement);

      const op: CreateOperation = {
        action: 'create',
        sourceFile: '/vault/Doc.md',
        name: 'Test',
        description: 'Test',
        typeId: 9,
        extractedTags: [],
      };

      const rollbackStack: any[] = [];
      await executeCreateOperation(op, 1, mockClient, mockSyncState, rollbackStack);

      expect(rollbackStack).toHaveLength(3);
      expect(rollbackStack[0].type).toBe('hacknplan-create');
      expect(rollbackStack[1].type).toBe('frontmatter');
      expect(rollbackStack[2].type).toBe('sync-state');
    });
  });

  describe('executeUpdateOperation', () => {
    test('updates element in HacknPlan and sync state', async () => {
      const mockElement: HacknPlanDesignElement = {
        designElementId: 123,
        name: 'Updated Doc',
        description: 'Updated description',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-02T00:00:00Z',
        type: { designElementTypeId: 9, name: 'Architecture' },
      };

      (mockClient.updateDesignElement as jest.Mock).mockResolvedValue(mockElement);
      (stat as jest.Mock).mockResolvedValue({ mtimeMs: 3000 });

      const op: UpdateOperation = {
        action: 'update',
        sourceFile: '/vault/Doc.md',
        designElementId: 123,
        name: 'Updated Doc',
        description: '# Updated content',
      };

      const rollbackStack: any[] = [];
      const result = await executeUpdateOperation(op, 1, mockClient, mockSyncState, rollbackStack);

      expect(result.element).toBeDefined();
      expect(result.element!.designElementId).toBe(123);
      expect(mockClient.updateDesignElement).toHaveBeenCalledWith(1, 123, {
        name: 'Updated Doc',
        description: '# Updated content',
      });
      expect(mockSyncState.updateSyncState).toHaveBeenCalledWith('/vault/Doc.md', {
        lastSynced: expect.any(String),
        vaultMtime: 3000,
        hacknplanUpdatedAt: '2025-01-02T00:00:00Z',
        hacknplanId: 123,
      });
      expect(rollbackStack.length).toBe(1); // sync-state only
    });

    test('returns error when HacknPlan update fails', async () => {
      (mockClient.updateDesignElement as jest.Mock).mockRejectedValue(new Error('Not found'));

      const op: UpdateOperation = {
        action: 'update',
        sourceFile: '/vault/Doc.md',
        designElementId: 123,
        name: 'Test',
        description: 'Test',
      };

      const rollbackStack: any[] = [];
      const result = await executeUpdateOperation(op, 1, mockClient, mockSyncState, rollbackStack);

      expect(result.error).toBe('Not found');
      expect(result.element).toBeUndefined();
    });
  });

  describe('rollbackOperations', () => {
    test('rolls back frontmatter changes', async () => {
      const rollbackStack = [
        {
          type: 'frontmatter' as const,
          filePath: '/vault/Doc.md',
          originalContent: '# Original',
        },
      ];

      await rollbackOperations(rollbackStack, mockClient, mockSyncState);

      expect(fs.writeFile).toHaveBeenCalledWith('/vault/Doc.md.tmp', '# Original', 'utf-8');
      expect(fs.rename).toHaveBeenCalledWith('/vault/Doc.md.tmp', '/vault/Doc.md');
      expect(rollbackStack.length).toBe(0); // Stack emptied
    });

    test('rolls back HacknPlan creates by deleting', async () => {
      const rollbackStack = [
        {
          type: 'hacknplan-create' as const,
          hacknplanId: 123,
          projectId: 1,
        },
      ];

      await rollbackOperations(rollbackStack, mockClient, mockSyncState);

      expect(mockClient.deleteDesignElement).toHaveBeenCalledWith(1, 123);
    });

    test('rolls back sync state changes', async () => {
      const rollbackStack = [
        {
          type: 'sync-state' as const,
          filePath: '/vault/Doc.md',
        },
      ];

      await rollbackOperations(rollbackStack, mockClient, mockSyncState);

      expect(mockSyncState.clearSyncState).toHaveBeenCalledWith('/vault/Doc.md');
    });

    test('processes rollback stack in LIFO order', async () => {
      const rollbackStack = [
        { type: 'hacknplan-create' as const, hacknplanId: 123, projectId: 1 },
        { type: 'frontmatter' as const, filePath: '/vault/Doc.md', originalContent: '# Original' },
        { type: 'sync-state' as const, filePath: '/vault/Doc.md' },
      ];

      const operations: string[] = [];
      (mockClient.deleteDesignElement as jest.Mock).mockImplementation(() => {
        operations.push('delete');
        return Promise.resolve();
      });
      (fs.rename as jest.Mock).mockImplementation(() => {
        operations.push('frontmatter');
        return Promise.resolve();
      });
      (mockSyncState.clearSyncState as jest.Mock).mockImplementation(() => {
        operations.push('sync-state');
      });

      await rollbackOperations(rollbackStack, mockClient, mockSyncState);

      // Should process in reverse order (LIFO)
      expect(operations).toEqual(['sync-state', 'frontmatter', 'delete']);
    });

    test('continues rollback even if individual operations fail', async () => {
      const rollbackStack = [
        { type: 'sync-state' as const, filePath: '/vault/Doc1.md' },
        { type: 'sync-state' as const, filePath: '/vault/Doc2.md' },
      ];

      (mockSyncState.clearSyncState as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Clear failed');
      });

      await rollbackOperations(rollbackStack, null, mockSyncState);

      // Should have called clearSyncState twice despite first failure
      expect(mockSyncState.clearSyncState).toHaveBeenCalledTimes(2);
    });

    test('handles null client gracefully', async () => {
      const rollbackStack = [
        {
          type: 'hacknplan-create' as const,
          hacknplanId: 123,
          projectId: 1,
        },
      ];

      await rollbackOperations(rollbackStack, null, mockSyncState);

      // Should not throw, should just skip delete
      expect(rollbackStack.length).toBe(0);
    });

    test('rolls back multiple operations', async () => {
      const rollbackStack = [
        {
          type: 'hacknplan-create' as const,
          hacknplanId: 123,
          projectId: 1,
        },
        {
          type: 'frontmatter' as const,
          filePath: '/vault/Doc.md',
          originalContent: '# Original',
        },
      ];

      await rollbackOperations(rollbackStack, mockClient, mockSyncState);

      expect(mockClient.deleteDesignElement).toHaveBeenCalledWith(1, 123);
      expect(fs.rename).toHaveBeenCalledWith('/vault/Doc.md.tmp', '/vault/Doc.md');
    });
  });

  describe('checkOperationConflict', () => {
    test('returns no conflict for first sync', async () => {
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null);

      const result = await checkOperationConflict('/vault/Doc.md', mockSyncState, '2025-01-01T00:00:00Z');

      expect(result.hasConflict).toBe(false);
      expect(result.reason).toBe('First sync');
    });

    test('returns no conflict when no HacknPlan timestamp', async () => {
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue({
        hacknplanId: 123,
        lastSynced: '2025-01-01T00:00:00Z',
      });

      const result = await checkOperationConflict('/vault/Doc.md', mockSyncState);

      expect(result.hasConflict).toBe(false);
      expect(result.reason).toBe('No HacknPlan timestamp to compare');
    });

    test('detects conflict when present', async () => {
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue({
        hacknplanId: 123,
        vaultMtime: 1000,
        hacknplanUpdatedAt: '2025-01-01T00:00:00Z',
        lastSynced: '2025-01-01T00:00:00Z',
      });
      (stat as jest.Mock).mockResolvedValue({ mtimeMs: 2000 });
      (conflictResolverModule.conflictResolver.detectConflict as jest.Mock).mockReturnValue({
        hasConflict: true,
        reason: 'Both modified',
        vaultNewer: false,
        hacknplanNewer: false,
      });

      const result = await checkOperationConflict('/vault/Doc.md', mockSyncState, '2025-01-02T00:00:00Z');

      expect(result.hasConflict).toBe(true);
      expect(result.reason).toBe('Both modified');
    });
  });

  describe('executeSyncBatch', () => {
    test('executes create operations successfully', async () => {
      const mockElement: HacknPlanDesignElement = {
        designElementId: 123,
        name: 'Test',
        description: 'Test',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        type: { designElementTypeId: 9, name: 'Architecture' },
      };

      (mockClient.createDesignElement as jest.Mock).mockResolvedValue(mockElement);
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null);

      const creates: CreateOperation[] = [
        {
          action: 'create',
          sourceFile: '/vault/Doc.md',
          name: 'Test',
          description: 'Test',
          typeId: 9,
          extractedTags: [],
        },
      ];

      const result = await executeSyncBatch(creates, [], 1, mockClient, mockSyncState);

      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.createdElements).toHaveLength(1);
      expect(result.createdElements![0].hacknplanId).toBe(123);
    });

    test('executes update operations successfully', async () => {
      const mockElement: HacknPlanDesignElement = {
        designElementId: 123,
        name: 'Updated',
        description: 'Updated',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-02T00:00:00Z',
        type: { designElementTypeId: 9, name: 'Architecture' },
      };

      (mockClient.updateDesignElement as jest.Mock).mockResolvedValue(mockElement);

      const updates: UpdateOperation[] = [
        {
          action: 'update',
          sourceFile: '/vault/Doc.md',
          designElementId: 123,
          name: 'Updated',
          description: 'Updated',
        },
      ];

      const result = await executeSyncBatch([], updates, 1, mockClient, mockSyncState);

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    test('detects conflicts for creates with existing sync state', async () => {
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue({
        hacknplanId: 999,
      });

      const creates: CreateOperation[] = [
        {
          action: 'create',
          sourceFile: '/vault/Doc.md',
          name: 'Test',
          description: 'Test',
          typeId: 9,
          extractedTags: [],
        },
      ];

      const result = await executeSyncBatch(creates, [], 1, mockClient, mockSyncState);

      expect(result.conflicts).toBe(1);
      expect(result.created).toBe(0);
      expect(mockClient.createDesignElement).not.toHaveBeenCalled();
    });

    test('continues processing on error when stopOnError is false', async () => {
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null);
      (mockClient.createDesignElement as jest.Mock)
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockResolvedValueOnce({
          designElementId: 124,
          name: 'Doc2',
          description: 'Doc2',
          updatedAt: '2025-01-01T00:00:00Z',
          type: { designElementTypeId: 9, name: 'Architecture' },
        });

      const creates: CreateOperation[] = [
        {
          action: 'create',
          sourceFile: '/vault/Doc1.md',
          name: 'Doc1',
          description: 'Doc1',
          typeId: 9,
          extractedTags: [],
        },
        {
          action: 'create',
          sourceFile: '/vault/Doc2.md',
          name: 'Doc2',
          description: 'Doc2',
          typeId: 9,
          extractedTags: [],
        },
      ];

      const result = await executeSyncBatch(creates, [], 1, mockClient, mockSyncState, {
        stopOnError: false,
      });

      expect(result.created).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].file).toBe('/vault/Doc1.md');
    });

    test('stops on error when stopOnError is true', async () => {
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null);
      (mockClient.createDesignElement as jest.Mock).mockRejectedValue(new Error('Error'));

      const creates: CreateOperation[] = [
        {
          action: 'create',
          sourceFile: '/vault/Doc1.md',
          name: 'Doc1',
          description: 'Doc1',
          typeId: 9,
          extractedTags: [],
        },
        {
          action: 'create',
          sourceFile: '/vault/Doc2.md',
          name: 'Doc2',
          description: 'Doc2',
          typeId: 9,
          extractedTags: [],
        },
      ];

      const result = await executeSyncBatch(creates, [], 1, mockClient, mockSyncState, {
        stopOnError: true,
      });

      expect(result.created).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(mockClient.createDesignElement).toHaveBeenCalledTimes(1); // Stopped after first error
    });

    test('rolls back on error when rollbackOnError is true', async () => {
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null);

      let callCount = 0;
      (mockClient.createDesignElement as jest.Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            designElementId: 123,
            name: 'Doc1',
            description: 'Doc1',
            updatedAt: '2025-01-01T00:00:00Z',
            type: { designElementTypeId: 9, name: 'Architecture' },
          });
        }
        return Promise.reject(new Error('Error on second'));
      });

      const creates: CreateOperation[] = [
        {
          action: 'create',
          sourceFile: '/vault/Doc1.md',
          name: 'Doc1',
          description: 'Doc1',
          typeId: 9,
          extractedTags: [],
        },
        {
          action: 'create',
          sourceFile: '/vault/Doc2.md',
          name: 'Doc2',
          description: 'Doc2',
          typeId: 9,
          extractedTags: [],
        },
      ];

      const result = await executeSyncBatch(creates, [], 1, mockClient, mockSyncState, {
        stopOnError: true,
        rollbackOnError: true,
      });

      expect(result.errors).toHaveLength(1);
      // Should have rolled back the first create
      expect(mockClient.deleteDesignElement).toHaveBeenCalledWith(1, 123);
    });
  });
});

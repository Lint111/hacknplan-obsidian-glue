/**
 * Jest tests for single-file sync optimization
 */

import { syncSingleFile, type SingleFileSyncResult } from '../single-file-sync.js';
import type { Pairing, CreateOperation, UpdateOperation } from '../../core/types.js';
import type { SyncStateOps } from '../../tools/types.js';
import type { HacknPlanClient } from '../../core/client.js';
import { promises as fs } from 'fs';
import { stat } from 'fs/promises';
import * as frontmatterModule from '../frontmatter.js';
import * as syncExecutorModule from '../sync-executor.js';

// Mock modules
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
  },
}));

jest.mock('fs/promises', () => ({
  stat: jest.fn(),
}));

jest.mock('../frontmatter.js');
jest.mock('../sync-executor.js');

describe('single-file-sync', () => {
  let mockPairing: Pairing;
  let mockClient: HacknPlanClient;
  let mockSyncState: SyncStateOps;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock pairing
    mockPairing = {
      projectId: 1,
      projectName: 'Test Project',
      vaultPath: '/vault',
      folderMappings: {
        '01-Architecture': 9,
        '03-Research': 10,
        'Subsystems': 11,
      },
      tagMappings: {
        vulkan: 1,
        svo: 2,
        performance: 3,
      },
      defaultBoard: null,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    };

    // Setup mock client
    mockClient = {} as HacknPlanClient;

    // Setup mock sync state
    mockSyncState = {
      getSyncState: jest.fn(),
      setSyncState: jest.fn(),
      clearSyncState: jest.fn(),
      saveSyncState: jest.fn(),
    } as any;

    // Default mock implementations
    (fs.readFile as jest.Mock).mockResolvedValue('# Test content');
    (stat as jest.Mock).mockResolvedValue({});
    (frontmatterModule.extractFrontmatter as jest.Mock).mockReturnValue(null);
    (frontmatterModule.stripFrontmatter as jest.Mock).mockReturnValue('# Test content');
    (syncExecutorModule.executeSyncBatch as jest.Mock).mockResolvedValue({
      success: true,
      errors: [],
      createdElements: [{ hacknplanId: 999 }],
    });
  });

  describe('syncSingleFile - create operation', () => {
    test('creates new file with valid folder mapping', async () => {
      const filePath = '/vault/01-Architecture/MyDoc.md';
      (stat as jest.Mock).mockResolvedValue({});
      (fs.readFile as jest.Mock).mockResolvedValue('# Content');
      (frontmatterModule.extractFrontmatter as jest.Mock).mockReturnValue({
        title: 'My Document',
        tags: ['vulkan', 'svo'],
      });
      (frontmatterModule.stripFrontmatter as jest.Mock).mockReturnValue('# Content');
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null);
      (syncExecutorModule.executeSyncBatch as jest.Mock).mockResolvedValue({
        success: true,
        errors: [],
        createdElements: [{ hacknplanId: 123 }],
      });

      const result = await syncSingleFile(filePath, mockPairing, mockClient, mockSyncState);

      expect(result.success).toBe(true);
      expect(result.operation).toBe('create');
      expect(result.hacknplanId).toBe(123);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(syncExecutorModule.executeSyncBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'create',
            sourceFile: filePath,
            name: 'My Document',
            description: '# Content',
            typeId: 9, // 01-Architecture mapping
            extractedTags: ['vulkan', 'svo'],
          }),
        ]),
        [],
        1,
        mockClient,
        mockSyncState,
        { stopOnError: true, rollbackOnError: true }
      );
    });

    test('creates file with basename as title when no frontmatter title', async () => {
      const filePath = '/vault/03-Research/Analysis.md';
      (stat as jest.Mock).mockResolvedValue({});
      (fs.readFile as jest.Mock).mockResolvedValue('# Content without frontmatter');
      (frontmatterModule.extractFrontmatter as jest.Mock).mockReturnValue(null);
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null);
      (syncExecutorModule.executeSyncBatch as jest.Mock).mockResolvedValue({
        success: true,
        errors: [],
        createdElements: [{ hacknplanId: 456 }],
      });

      const result = await syncSingleFile(filePath, mockPairing, mockClient, mockSyncState);

      expect(result.success).toBe(true);
      expect(result.operation).toBe('create');
      expect(syncExecutorModule.executeSyncBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'Analysis', // Uses basename without extension (path.basename removes .md)
            typeId: 10, // 03-Research mapping
          }),
        ]),
        [],
        expect.any(Number),
        expect.any(Object),
        expect.any(Object),
        expect.any(Object)
      );
    });

    test('fails create when no folder mapping exists', async () => {
      const filePath = '/vault/UnmappedFolder/Doc.md';
      (stat as jest.Mock).mockResolvedValue({});
      (fs.readFile as jest.Mock).mockResolvedValue('# Content');
      (frontmatterModule.extractFrontmatter as jest.Mock).mockReturnValue({ title: 'Doc' });
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null);

      const result = await syncSingleFile(filePath, mockPairing, mockClient, mockSyncState);

      expect(result.success).toBe(false);
      expect(result.operation).toBe('create');
      expect(result.error).toContain('No folder mapping found');
      expect(syncExecutorModule.executeSyncBatch).not.toHaveBeenCalled();
    });

    test('handles subfolder paths correctly', async () => {
      const filePath = '/vault/Subsystems/Rendering/Pipeline.md';
      (stat as jest.Mock).mockResolvedValue({});
      (fs.readFile as jest.Mock).mockResolvedValue('# Pipeline');
      (frontmatterModule.extractFrontmatter as jest.Mock).mockReturnValue({ title: 'Pipeline' });
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null);
      (syncExecutorModule.executeSyncBatch as jest.Mock).mockResolvedValue({
        success: true,
        errors: [],
        createdElements: [{ hacknplanId: 789 }],
      });

      const result = await syncSingleFile(filePath, mockPairing, mockClient, mockSyncState);

      expect(result.success).toBe(true);
      expect(result.operation).toBe('create');
      expect(syncExecutorModule.executeSyncBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            typeId: 11, // Subsystems mapping should match parent folder
          }),
        ]),
        expect.any(Array),
        expect.any(Number),
        expect.any(Object),
        expect.any(Object),
        expect.any(Object)
      );
    });

    test('resolves tags to IDs using tag mappings', async () => {
      const filePath = '/vault/01-Architecture/Doc.md';
      (stat as jest.Mock).mockResolvedValue({});
      (fs.readFile as jest.Mock).mockResolvedValue('# Content');
      (frontmatterModule.extractFrontmatter as jest.Mock).mockReturnValue({
        title: 'Doc',
        tags: ['vulkan', 'performance', 'unknown-tag'],
      });
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null);
      (syncExecutorModule.executeSyncBatch as jest.Mock).mockResolvedValue({
        success: true,
        errors: [],
        createdElements: [{ hacknplanId: 111 }],
      });

      const result = await syncSingleFile(filePath, mockPairing, mockClient, mockSyncState);

      expect(result.success).toBe(true);
      expect(syncExecutorModule.executeSyncBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            extractedTags: ['vulkan', 'performance', 'unknown-tag'], // Preserves all tags (unmapped ones filtered later)
          }),
        ]),
        expect.any(Array),
        expect.any(Number),
        expect.any(Object),
        expect.any(Object),
        expect.any(Object)
      );
    });

    test('handles empty tags array', async () => {
      const filePath = '/vault/01-Architecture/Doc.md';
      (stat as jest.Mock).mockResolvedValue({});
      (fs.readFile as jest.Mock).mockResolvedValue('# Content');
      (frontmatterModule.extractFrontmatter as jest.Mock).mockReturnValue({
        title: 'Doc',
        tags: [],
      });
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null);
      (syncExecutorModule.executeSyncBatch as jest.Mock).mockResolvedValue({
        success: true,
        errors: [],
        createdElements: [{ hacknplanId: 222 }],
      });

      const result = await syncSingleFile(filePath, mockPairing, mockClient, mockSyncState);

      expect(result.success).toBe(true);
      expect(syncExecutorModule.executeSyncBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            extractedTags: [],
          }),
        ]),
        expect.any(Array),
        expect.any(Number),
        expect.any(Object),
        expect.any(Object),
        expect.any(Object)
      );
    });

    test('fails create when executeSyncBatch returns errors', async () => {
      const filePath = '/vault/01-Architecture/Doc.md';
      (stat as jest.Mock).mockResolvedValue({});
      (fs.readFile as jest.Mock).mockResolvedValue('# Content');
      (frontmatterModule.extractFrontmatter as jest.Mock).mockReturnValue({ title: 'Doc' });
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null);
      (syncExecutorModule.executeSyncBatch as jest.Mock).mockResolvedValue({
        success: false,
        errors: [{ operation: 'create', error: 'API error: rate limit' }],
      });

      const result = await syncSingleFile(filePath, mockPairing, mockClient, mockSyncState);

      expect(result.success).toBe(false);
      expect(result.operation).toBe('create');
      expect(result.error).toBe('API error: rate limit');
    });
  });

  describe('syncSingleFile - update operation', () => {
    test('updates existing file with hacknplanId and sync state', async () => {
      const filePath = '/vault/01-Architecture/Existing.md';
      const fileContent = '# Updated content';
      (stat as jest.Mock).mockResolvedValue({});
      (fs.readFile as jest.Mock).mockResolvedValue(fileContent);
      (frontmatterModule.extractFrontmatter as jest.Mock).mockReturnValue({
        hacknplan_id: 123,
        title: 'Updated Title',
        tags: ['vulkan'],
      });
      (frontmatterModule.stripFrontmatter as jest.Mock).mockReturnValue(fileContent);
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue({
        hacknplanId: 123,
        lastSyncHash: 'oldhash',
      });
      (syncExecutorModule.executeSyncBatch as jest.Mock).mockResolvedValue({
        success: true,
        errors: [],
      });

      const result = await syncSingleFile(filePath, mockPairing, mockClient, mockSyncState);

      expect(result.success).toBe(true);
      expect(result.operation).toBe('update');
      expect(result.hacknplanId).toBe(123);
      expect(syncExecutorModule.executeSyncBatch).toHaveBeenCalledWith(
        [], // No creates
        expect.arrayContaining([
          expect.objectContaining({
            action: 'update',
            sourceFile: filePath,
            designElementId: 123,
            name: 'Updated Title',
            description: fileContent,
          }),
        ]),
        1,
        mockClient,
        mockSyncState,
        { stopOnError: true, rollbackOnError: true }
      );
    });

    test('fails update when executeSyncBatch returns errors', async () => {
      const filePath = '/vault/01-Architecture/Existing.md';
      (stat as jest.Mock).mockResolvedValue({});
      (fs.readFile as jest.Mock).mockResolvedValue('# Content');
      (frontmatterModule.extractFrontmatter as jest.Mock).mockReturnValue({
        hacknplan_id: 123,
        title: 'Title',
      });
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue({
        hacknplanId: 123,
        lastSyncHash: 'hash',
      });
      (syncExecutorModule.executeSyncBatch as jest.Mock).mockResolvedValue({
        success: false,
        errors: [{ operation: 'update', error: 'Not found' }],
      });

      const result = await syncSingleFile(filePath, mockPairing, mockClient, mockSyncState);

      expect(result.success).toBe(false);
      expect(result.operation).toBe('update');
      expect(result.error).toBe('Not found');
    });
  });

  describe('syncSingleFile - delete operation', () => {
    test('handles deleted file with sync state', async () => {
      const filePath = '/vault/01-Architecture/Deleted.md';
      (stat as jest.Mock).mockRejectedValue(new Error('ENOENT: file not found'));
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue({
        hacknplanId: 123,
        lastSyncHash: 'hash',
      });

      const result = await syncSingleFile(filePath, mockPairing, mockClient, mockSyncState);

      expect(result.success).toBe(true);
      expect(result.operation).toBe('delete');
      expect(result.hacknplanId).toBe(123);
      expect(mockSyncState.clearSyncState).toHaveBeenCalledWith(filePath);
      expect(mockSyncState.saveSyncState).toHaveBeenCalled();
    });

    test('skips deleted file without sync state', async () => {
      const filePath = '/vault/01-Architecture/NeverSynced.md';
      (stat as jest.Mock).mockRejectedValue(new Error('ENOENT: file not found'));
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null);

      const result = await syncSingleFile(filePath, mockPairing, mockClient, mockSyncState);

      expect(result.success).toBe(true);
      expect(result.operation).toBe('skip');
      expect(mockSyncState.clearSyncState).not.toHaveBeenCalled();
      expect(mockSyncState.saveSyncState).not.toHaveBeenCalled();
    });
  });

  describe('syncSingleFile - skip operation', () => {
    test('skips file with hacknplanId but no sync state (inconsistent)', async () => {
      const filePath = '/vault/01-Architecture/Inconsistent.md';
      (stat as jest.Mock).mockResolvedValue({});
      (fs.readFile as jest.Mock).mockResolvedValue('# Content');
      (frontmatterModule.extractFrontmatter as jest.Mock).mockReturnValue({
        hacknplan_id: 123,
        title: 'Inconsistent',
      });
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null); // No sync state

      const result = await syncSingleFile(filePath, mockPairing, mockClient, mockSyncState);

      expect(result.success).toBe(false);
      expect(result.operation).toBe('skip');
      expect(result.error).toContain('Inconsistent state');
      expect(syncExecutorModule.executeSyncBatch).not.toHaveBeenCalled();
    });

    test('skips file with sync state but no hacknplanId (inconsistent)', async () => {
      const filePath = '/vault/01-Architecture/Inconsistent2.md';
      (stat as jest.Mock).mockResolvedValue({});
      (fs.readFile as jest.Mock).mockResolvedValue('# Content');
      (frontmatterModule.extractFrontmatter as jest.Mock).mockReturnValue({
        title: 'Inconsistent',
      }); // No hacknplan_id
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue({
        hacknplanId: 123,
        lastSyncHash: 'hash',
      });

      const result = await syncSingleFile(filePath, mockPairing, mockClient, mockSyncState);

      expect(result.success).toBe(false);
      expect(result.operation).toBe('skip');
      expect(result.error).toContain('Inconsistent state');
      expect(syncExecutorModule.executeSyncBatch).not.toHaveBeenCalled();
    });
  });

  describe('syncSingleFile - error handling', () => {
    test('catches and returns error when file read fails', async () => {
      const filePath = '/vault/01-Architecture/Unreadable.md';
      (stat as jest.Mock).mockResolvedValue({});
      (fs.readFile as jest.Mock).mockRejectedValue(new Error('Permission denied'));

      const result = await syncSingleFile(filePath, mockPairing, mockClient, mockSyncState);

      expect(result.success).toBe(false);
      expect(result.operation).toBe('skip');
      expect(result.error).toBe('Permission denied');
    });

    test('measures duration correctly', async () => {
      const filePath = '/vault/01-Architecture/Doc.md';
      (stat as jest.Mock).mockResolvedValue({});
      (fs.readFile as jest.Mock).mockResolvedValue('# Content');
      (frontmatterModule.extractFrontmatter as jest.Mock).mockReturnValue({ title: 'Doc' });
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null);
      (syncExecutorModule.executeSyncBatch as jest.Mock).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ success: true, errors: [], createdElements: [{ hacknplanId: 1 }] }), 10))
      );

      const result = await syncSingleFile(filePath, mockPairing, mockClient, mockSyncState);

      expect(result.duration).toBeGreaterThanOrEqual(10);
      expect(result.duration).toBeLessThan(1000); // Reasonable upper bound
    });

    test('handles frontmatter extraction errors gracefully', async () => {
      const filePath = '/vault/01-Architecture/Malformed.md';
      (stat as jest.Mock).mockResolvedValue({});
      (fs.readFile as jest.Mock).mockResolvedValue('---\nmalformed: yaml: [unclosed\n---');
      (frontmatterModule.extractFrontmatter as jest.Mock).mockImplementation(() => {
        throw new Error('YAML parse error');
      });

      const result = await syncSingleFile(filePath, mockPairing, mockClient, mockSyncState);

      expect(result.success).toBe(false);
      expect(result.operation).toBe('skip');
      expect(result.error).toBe('YAML parse error');
    });

    test('handles executeSyncBatch throwing exception', async () => {
      const filePath = '/vault/01-Architecture/Doc.md';
      (stat as jest.Mock).mockResolvedValue({});
      (fs.readFile as jest.Mock).mockResolvedValue('# Content');
      (frontmatterModule.extractFrontmatter as jest.Mock).mockReturnValue({ title: 'Doc' });
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null);
      (syncExecutorModule.executeSyncBatch as jest.Mock).mockRejectedValue(
        new Error('Network timeout')
      );

      const result = await syncSingleFile(filePath, mockPairing, mockClient, mockSyncState);

      expect(result.success).toBe(false);
      expect(result.operation).toBe('skip');
      expect(result.error).toBe('Network timeout');
    });
  });

  describe('syncSingleFile - edge cases', () => {
    test('handles file with only frontmatter (no body content)', async () => {
      const filePath = '/vault/01-Architecture/EmptyBody.md';
      (stat as jest.Mock).mockResolvedValue({});
      (fs.readFile as jest.Mock).mockResolvedValue('---\ntitle: Empty\n---\n');
      (frontmatterModule.extractFrontmatter as jest.Mock).mockReturnValue({ title: 'Empty' });
      (frontmatterModule.stripFrontmatter as jest.Mock).mockReturnValue('');
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null);
      (syncExecutorModule.executeSyncBatch as jest.Mock).mockResolvedValue({
        success: true,
        errors: [],
        createdElements: [{ hacknplanId: 999 }],
      });

      const result = await syncSingleFile(filePath, mockPairing, mockClient, mockSyncState);

      expect(result.success).toBe(true);
      expect(result.operation).toBe('create');
      expect(syncExecutorModule.executeSyncBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            description: '', // Empty description is valid
          }),
        ]),
        expect.any(Array),
        expect.any(Number),
        expect.any(Object),
        expect.any(Object),
        expect.any(Object)
      );
    });

    test('handles exact folder match taking priority over prefix', async () => {
      // Test that exact folder match is checked before prefix matching
      const filePath = '/vault/Subsystems/Doc.md';
      (stat as jest.Mock).mockResolvedValue({});
      (fs.readFile as jest.Mock).mockResolvedValue('# Doc');
      (frontmatterModule.extractFrontmatter as jest.Mock).mockReturnValue({ title: 'Doc' });
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null);
      (syncExecutorModule.executeSyncBatch as jest.Mock).mockResolvedValue({
        success: true,
        errors: [],
        createdElements: [{ hacknplanId: 888 }],
      });

      const result = await syncSingleFile(filePath, mockPairing, mockClient, mockSyncState);

      expect(result.success).toBe(true);
      // Should match exact "Subsystems" folder (typeId 11)
      expect(syncExecutorModule.executeSyncBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            typeId: 11, // Exact folder match
          }),
        ]),
        expect.any(Array),
        expect.any(Number),
        expect.any(Object),
        expect.any(Object),
        expect.any(Object)
      );
    });

    test('handles Windows-style paths correctly', async () => {
      // Simulate Windows path
      mockPairing.vaultPath = 'C:\\Users\\test\\vault';
      const filePath = 'C:\\Users\\test\\vault\\01-Architecture\\Doc.md';

      (stat as jest.Mock).mockResolvedValue({});
      (fs.readFile as jest.Mock).mockResolvedValue('# Content');
      (frontmatterModule.extractFrontmatter as jest.Mock).mockReturnValue({ title: 'Doc' });
      (mockSyncState.getSyncState as jest.Mock).mockReturnValue(null);
      (syncExecutorModule.executeSyncBatch as jest.Mock).mockResolvedValue({
        success: true,
        errors: [],
        createdElements: [{ hacknplanId: 777 }],
      });

      const result = await syncSingleFile(filePath, mockPairing, mockClient, mockSyncState);

      expect(result.success).toBe(true);
      expect(result.operation).toBe('create');
    });
  });
});

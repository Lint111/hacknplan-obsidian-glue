/**
 * Jest tests for Sync State Manager
 */

import { SyncStateManager } from '../sync-state.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

describe('SyncStateManager', () => {
  let testDir: string;
  let stateManager: SyncStateManager;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `sync-state-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    stateManager = new SyncStateManager(testDir);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('load', () => {
    test('creates empty state if file missing', async () => {
      await stateManager.load();
      const state = stateManager.getSyncState('test.md');
      expect(state).toBeUndefined();
    });

    test('loads existing state file', async () => {
      const stateFile = path.join(testDir, '.sync-state.json');
      const stateData = {
        version: '2.0',
        state: {
          'test.md': {
            lastSynced: '2025-01-15T10:00:00Z',
            vaultMtime: 1705316400000,
            hacknplanUpdatedAt: '2025-01-15T10:00:00Z',
            hacknplanId: 123,
          },
        },
      };
      await fs.writeFile(stateFile, JSON.stringify(stateData, null, 2));

      await stateManager.load();
      const state = stateManager.getSyncState('test.md');
      expect(state).toBeDefined();
      expect(state?.hacknplanId).toBe(123);
    });

    test('handles corrupted state file gracefully', async () => {
      const stateFile = path.join(testDir, '.sync-state.json');
      await fs.writeFile(stateFile, 'invalid json{{{');

      await expect(stateManager.load()).resolves.not.toThrow();
    });
  });

  describe('save', () => {
    test('persists state to disk', async () => {
      await stateManager.load();

      stateManager.updateSyncState('test.md', {
        lastSynced: '2025-01-15T10:00:00Z',
        vaultMtime: 1705316400000,
        hacknplanUpdatedAt: '2025-01-15T10:00:00Z',
        hacknplanId: 456,
      });

      await stateManager.save();

      const stateFile = path.join(testDir, '.sync-state.json');
      const data = await fs.readFile(stateFile, 'utf-8');
      const parsed = JSON.parse(data);

      expect(parsed.state['test.md'].hacknplanId).toBe(456);
    });

    test('creates directory if missing', async () => {
      const nestedDir = path.join(testDir, 'nested', 'path');
      const nestedManager = new SyncStateManager(nestedDir);

      await nestedManager.load();
      nestedManager.updateSyncState('test.md', {
        lastSynced: '2025-01-15T10:00:00Z',
        vaultMtime: 1705316400000,
        hacknplanUpdatedAt: '2025-01-15T10:00:00Z',
        hacknplanId: 789,
      });

      await expect(nestedManager.save()).resolves.not.toThrow();

      const stats = await fs.stat(nestedDir);
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe('getSyncState / updateSyncState', () => {
    test('returns undefined for untracked file', async () => {
      await stateManager.load();
      const state = stateManager.getSyncState('nonexistent.md');
      expect(state).toBeUndefined();
    });

    test('stores and retrieves file state', async () => {
      await stateManager.load();

      const fileState = {
        lastSynced: '2025-01-15T10:00:00Z',
        vaultMtime: 1705316400000,
        hacknplanUpdatedAt: '2025-01-15T10:00:00Z',
        hacknplanId: 123,
      };

      stateManager.updateSyncState('test.md', fileState);
      const retrieved = stateManager.getSyncState('test.md');

      expect(retrieved).toEqual(fileState);
    });

    test('updates existing file state', async () => {
      await stateManager.load();

      stateManager.updateSyncState('test.md', {
        lastSynced: '2025-01-15T10:00:00Z',
        vaultMtime: 1705316400000,
        hacknplanUpdatedAt: '2025-01-15T10:00:00Z',
        hacknplanId: 123,
      });

      stateManager.updateSyncState('test.md', {
        lastSynced: '2025-01-15T11:00:00Z',
        vaultMtime: 1705320000000,
        hacknplanUpdatedAt: '2025-01-15T11:00:00Z',
        hacknplanId: 123,
      });

      const state = stateManager.getSyncState('test.md');
      expect(state?.lastSynced).toBe('2025-01-15T11:00:00Z');
    });
  });

  describe('clearSyncState', () => {
    test('removes file from state', async () => {
      await stateManager.load();

      stateManager.updateSyncState('test.md', {
        lastSynced: '2025-01-15T10:00:00Z',
        vaultMtime: 1705316400000,
        hacknplanUpdatedAt: '2025-01-15T10:00:00Z',
        hacknplanId: 123,
      });

      expect(stateManager.getSyncState('test.md')).toBeDefined();

      stateManager.clearSyncState('test.md');
      expect(stateManager.getSyncState('test.md')).toBeUndefined();
    });

    test('handles removing non-existent file', async () => {
      await stateManager.load();
      expect(() => stateManager.clearSyncState('nonexistent.md')).not.toThrow();
    });
  });

  describe('getAllStates', () => {
    test('returns all tracked files', async () => {
      await stateManager.load();

      stateManager.updateSyncState('file1.md', {
        lastSynced: '2025-01-15T10:00:00Z',
        vaultMtime: 1705316400000,
        hacknplanUpdatedAt: '2025-01-15T10:00:00Z',
        hacknplanId: 1,
      });

      stateManager.updateSyncState('file2.md', {
        lastSynced: '2025-01-15T10:00:00Z',
        vaultMtime: 1705316400000,
        hacknplanUpdatedAt: '2025-01-15T10:00:00Z',
        hacknplanId: 2,
      });

      const allStates = stateManager.getAllStates();
      expect(Object.keys(allStates).length).toBe(2);
      expect(allStates['file1.md'].hacknplanId).toBe(1);
      expect(allStates['file2.md'].hacknplanId).toBe(2);
    });

    test('returns empty object when no files tracked', async () => {
      await stateManager.load();
      const allStates = stateManager.getAllStates();
      expect(Object.keys(allStates).length).toBe(0);
    });
  });

  describe('persistence', () => {
    test('state survives load/save cycle', async () => {
      await stateManager.load();

      stateManager.updateSyncState('persistent.md', {
        lastSynced: '2025-01-15T10:00:00Z',
        vaultMtime: 1705316400000,
        hacknplanUpdatedAt: '2025-01-15T10:00:00Z',
        hacknplanId: 999,
      });

      await stateManager.save();

      const newManager = new SyncStateManager(testDir);
      await newManager.load();

      const state = newManager.getSyncState('persistent.md');
      expect(state?.hacknplanId).toBe(999);
    });
  });

  describe('isDirty', () => {
    test('tracks dirty state', async () => {
      await stateManager.load();
      expect(stateManager.isDirty()).toBe(false);

      stateManager.updateSyncState('test.md', {
        lastSynced: '2025-01-15T10:00:00Z',
        vaultMtime: 1705316400000,
        hacknplanUpdatedAt: '2025-01-15T10:00:00Z',
        hacknplanId: 123,
      });

      expect(stateManager.isDirty()).toBe(true);

      await stateManager.save();
      expect(stateManager.isDirty()).toBe(false);
    });
  });
});

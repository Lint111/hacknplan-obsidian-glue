/**
 * Jest tests for sync queue with retry, batching, and concurrency
 */

import { SyncQueue, type QueueItem, type QueueStats, type SyncQueueConfig } from '../sync-queue.js';
import type { FileChange } from '../file-watcher.js';
import type { HacknPlanClient } from '../../core/client.js';
import type { SyncStateOps } from '../../tools/types.js';
import type { Pairing } from '../../core/types.js';
import * as singleFileSyncModule from '../single-file-sync.js';

// Mock p-limit (ESM-only module)
jest.mock('p-limit', () => {
  // Return a mock function that creates a limiter
  const mockPLimit = jest.fn(() => {
    // Return a function that executes promises immediately (no actual limiting in tests)
    return (fn: () => Promise<any>) => fn();
  });
  return {
    __esModule: true,
    default: mockPLimit,
  };
});

// Mock single-file-sync module
jest.mock('../single-file-sync.js');

describe('SyncQueue', () => {
  let mockClient: HacknPlanClient;
  let mockSyncState: SyncStateOps;
  let mockPairing: Pairing;
  let queue: SyncQueue;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockClient = {} as HacknPlanClient;
    mockSyncState = {
      getSyncState: jest.fn(),
      setSyncState: jest.fn(),
      clearSyncState: jest.fn(),
      saveSyncState: jest.fn(),
    } as any;

    mockPairing = {
      projectId: 1,
      projectName: 'Test Project',
      vaultPath: '/vault',
      folderMappings: { '01-Architecture': 9 },
      tagMappings: { vulkan: 1 },
      defaultBoard: null,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    };

    // Default mock: successful sync
    (singleFileSyncModule.syncSingleFile as jest.Mock).mockResolvedValue({
      success: true,
      operation: 'update',
      duration: 100,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor and configuration', () => {
    test('creates queue with default config', () => {
      queue = new SyncQueue(mockClient, mockSyncState);
      const stats = queue.getStats();

      expect(stats.pending).toBe(0);
      expect(stats.processing).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(0);
    });

    test('creates queue with custom config', () => {
      const config: SyncQueueConfig = {
        concurrency: 5,
        maxRetries: 5,
        retryDelayMs: 2000,
        retryBackoffMultiplier: 3,
        batchDelayMs: 5000,
      };

      queue = new SyncQueue(mockClient, mockSyncState, config);
      expect(queue).toBeDefined();
    });

    test('uses default values for partial config', () => {
      const config: SyncQueueConfig = {
        concurrency: 10,
      };

      queue = new SyncQueue(mockClient, mockSyncState, config);
      expect(queue).toBeDefined();
    });
  });

  describe('addChanges', () => {
    beforeEach(() => {
      queue = new SyncQueue(mockClient, mockSyncState, { batchDelayMs: 100 });
    });

    test('adds single change to queue', () => {
      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);

      const stats = queue.getStats();
      expect(stats.pending).toBe(1);
    });

    test('adds multiple changes to queue', () => {
      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
        { path: '/vault/Doc2.md', event: 'add', timestamp: new Date() },
        { path: '/vault/Doc3.md', event: 'unlink', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);

      const stats = queue.getStats();
      expect(stats.pending).toBe(3);
    });

    test('deduplicates changes by path (last change wins)', () => {
      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
        { path: '/vault/Doc1.md', event: 'add', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);

      const stats = queue.getStats();
      expect(stats.pending).toBe(1); // Only one item
    });

    test('emits queue-updated event', (done) => {
      queue.on('queue-updated', (data) => {
        expect(data.pending).toBe(2);
        done();
      });

      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
        { path: '/vault/Doc2.md', event: 'add', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);
    });

    test('skips items already in failed state', async () => {
      // Create queue with only 1 retry to fail faster
      queue = new SyncQueue(mockClient, mockSyncState, {
        batchDelayMs: 50,
        maxRetries: 1,
        retryDelayMs: 50,
      });

      // Make sync fail so item goes to failed state
      (singleFileSyncModule.syncSingleFile as jest.Mock).mockResolvedValue({
        success: false,
        operation: 'skip',
        error: 'Error',
        duration: 10,
      });

      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);

      // Let it fail through initial + 1 retry
      await jest.advanceTimersByTimeAsync(200);

      const statsBefore = queue.getStats();
      expect(statsBefore.failed).toBe(1);

      // Try to add same file again while in failed state - should skip
      queue.addChanges(changes, mockPairing);

      const statsAfter = queue.getStats();
      expect(statsAfter.pending).toBe(0); // Should not re-add
      expect(statsAfter.failed).toBe(1); // Still failed
    });
  });

  describe('processing', () => {
    beforeEach(() => {
      queue = new SyncQueue(mockClient, mockSyncState, {
        batchDelayMs: 100,
        concurrency: 2,
      });
    });

    test('processes single item successfully', async () => {
      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);

      // Wait for batch delay + processing
      await jest.advanceTimersByTimeAsync(200);

      const stats = queue.getStats();
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(0);
      expect(stats.totalProcessed).toBe(1);
    });

    test('processes multiple items concurrently', async () => {
      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
        { path: '/vault/Doc2.md', event: 'change', timestamp: new Date() },
        { path: '/vault/Doc3.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);

      await jest.advanceTimersByTimeAsync(200);

      const stats = queue.getStats();
      expect(stats.completed).toBe(3);
      expect(stats.totalProcessed).toBe(3);
    });

    test('emits processing-started event', (done) => {
      queue.on('processing-started', () => {
        done();
      });

      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);
      jest.advanceTimersByTime(100);
    });

    test('emits item-processing event', (done) => {
      queue.on('item-processing', (data) => {
        expect(data.id).toBe('/vault/Doc1.md');
        expect(data.retries).toBe(0);
        done();
      });

      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);
      jest.advanceTimersByTime(100);
    });

    test('emits item-completed event with duration', (done) => {
      queue.on('item-completed', (data) => {
        expect(data.id).toBe('/vault/Doc1.md');
        expect(data.duration).toBeGreaterThanOrEqual(0);
        done();
      });

      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);
      jest.advanceTimersByTime(100);
    });

    test('emits processing-completed event', (done) => {
      queue.on('processing-completed', (data) => {
        expect(data.processed).toBe(2);
        expect(data.failed).toBe(0);
        done();
      });

      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
        { path: '/vault/Doc2.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);
      jest.advanceTimersByTime(200);
    });

    test('calls syncSingleFile with correct parameters', async () => {
      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);
      await jest.advanceTimersByTimeAsync(200);

      expect(singleFileSyncModule.syncSingleFile).toHaveBeenCalledWith(
        '/vault/Doc1.md',
        mockPairing,
        mockClient,
        mockSyncState,
        undefined  // onEvent callback
      );
    });

    test('updates processing time statistics', async () => {
      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);
      await jest.advanceTimersByTimeAsync(200);

      const stats = queue.getStats();
      expect(stats.averageProcessingTime).toBeGreaterThanOrEqual(0);
      expect(stats.lastProcessedAt).toBeInstanceOf(Date);
    });

    test('processes new items added during processing', async () => {
      const changes1: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes1, mockPairing);

      // Start processing
      await jest.advanceTimersByTimeAsync(50);

      // Add more while processing
      const changes2: FileChange[] = [
        { path: '/vault/Doc2.md', event: 'change', timestamp: new Date() },
      ];
      queue.addChanges(changes2, mockPairing);

      // Complete both batches
      await jest.advanceTimersByTimeAsync(300);

      const stats = queue.getStats();
      expect(stats.totalProcessed).toBe(2);
    });
  });

  describe('retry logic', () => {
    beforeEach(() => {
      queue = new SyncQueue(mockClient, mockSyncState, {
        batchDelayMs: 100,
        maxRetries: 3,
        retryDelayMs: 50,
        retryBackoffMultiplier: 2,
      });
    });

    test('retries failed item with exponential backoff', async () => {
      let callCount = 0;
      (singleFileSyncModule.syncSingleFile as jest.Mock).mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.resolve({ success: false, operation: 'skip', error: 'Temporary error', duration: 10 });
        }
        return Promise.resolve({ success: true, operation: 'update', duration: 10 });
      });

      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);

      // First attempt
      await jest.advanceTimersByTimeAsync(100);
      expect(callCount).toBe(1);

      // First retry (delay: 50ms)
      await jest.advanceTimersByTimeAsync(150);
      expect(callCount).toBe(2);

      // Second retry (delay: 100ms)
      await jest.advanceTimersByTimeAsync(200);
      expect(callCount).toBe(3);

      const stats = queue.getStats();
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(0);
    });

    test('emits item-retry event', (done) => {
      (singleFileSyncModule.syncSingleFile as jest.Mock).mockResolvedValue({
        success: false,
        operation: 'skip',
        error: 'Test error',
        duration: 10,
      });

      queue.on('item-retry', (data) => {
        expect(data.id).toBe('/vault/Doc1.md');
        expect(data.retries).toBe(1);
        expect(data.delay).toBe(50);
        expect(data.error).toBe('Test error');
        done();
      });

      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);
      jest.advanceTimersByTime(100);
    });

    test('marks item as failed after max retries', async () => {
      (singleFileSyncModule.syncSingleFile as jest.Mock).mockResolvedValue({
        success: false,
        operation: 'skip',
        error: 'Persistent error',
        duration: 10,
      });

      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);

      // Initial + 3 retries
      await jest.advanceTimersByTimeAsync(100); // Initial
      await jest.advanceTimersByTimeAsync(150); // Retry 1 (50ms delay)
      await jest.advanceTimersByTimeAsync(200); // Retry 2 (100ms delay)
      await jest.advanceTimersByTimeAsync(300); // Retry 3 (200ms delay)

      const stats = queue.getStats();
      expect(stats.failed).toBe(1);
      expect(stats.completed).toBe(0);

      const failedItems = queue.getFailedItems();
      expect(failedItems.length).toBe(1);
      expect(failedItems[0].lastError).toBe('Persistent error');
    });

    test('emits item-failed event after max retries', async () => {
      (singleFileSyncModule.syncSingleFile as jest.Mock).mockResolvedValue({
        success: false,
        operation: 'skip',
        error: 'Final error',
        duration: 10,
      });

      let failedEventData: any = null;
      queue.on('item-failed', (data) => {
        failedEventData = data;
      });

      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);

      // Fast-forward through all retries
      await jest.advanceTimersByTimeAsync(1000);

      expect(failedEventData).not.toBeNull();
      expect(failedEventData.id).toBe('/vault/Doc1.md');
      expect(failedEventData.error).toBe('Final error');
      expect(failedEventData.retries).toBe(3);
    });

    test('handles exception thrown by syncSingleFile', async () => {
      (singleFileSyncModule.syncSingleFile as jest.Mock).mockRejectedValue(
        new Error('Network timeout')
      );

      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);

      // Should retry and eventually fail
      await jest.advanceTimersByTimeAsync(1000);

      const stats = queue.getStats();
      expect(stats.failed).toBe(1);

      const failedItems = queue.getFailedItems();
      expect(failedItems[0].lastError).toBe('Network timeout');
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      queue = new SyncQueue(mockClient, mockSyncState, { batchDelayMs: 100 });
    });

    test('returns accurate queue statistics', async () => {
      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
        { path: '/vault/Doc2.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);
      await jest.advanceTimersByTimeAsync(200);

      const stats = queue.getStats();
      expect(stats.pending).toBe(0);
      expect(stats.processing).toBe(0);
      expect(stats.completed).toBe(2);
      expect(stats.failed).toBe(0);
      expect(stats.totalProcessed).toBe(2);
      expect(stats.averageProcessingTime).toBeGreaterThanOrEqual(0);
      expect(stats.lastProcessedAt).toBeInstanceOf(Date);
    });

    test('calculates average processing time correctly', async () => {
      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
        { path: '/vault/Doc2.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);
      await jest.advanceTimersByTimeAsync(200);

      const stats = queue.getStats();
      // Average should be positive
      expect(stats.averageProcessingTime).toBeGreaterThanOrEqual(0);
    });

    test('returns zero average when no items processed', () => {
      const stats = queue.getStats();
      expect(stats.averageProcessingTime).toBe(0);
      expect(stats.lastProcessedAt).toBeNull();
    });
  });

  describe('failed item management', () => {
    beforeEach(() => {
      queue = new SyncQueue(mockClient, mockSyncState, {
        batchDelayMs: 100,
        maxRetries: 1,
        retryDelayMs: 50,
      });
    });

    test('getFailedItems returns failed items', async () => {
      (singleFileSyncModule.syncSingleFile as jest.Mock).mockResolvedValue({
        success: false,
        operation: 'skip',
        error: 'Error',
        duration: 10,
      });

      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);
      await jest.advanceTimersByTimeAsync(300);

      const failedItems = queue.getFailedItems();
      expect(failedItems.length).toBe(1);
      expect(failedItems[0].id).toBe('/vault/Doc1.md');
    });

    test('retryFailed resets retry counter and re-queues items', async () => {
      (singleFileSyncModule.syncSingleFile as jest.Mock).mockResolvedValue({
        success: false,
        operation: 'skip',
        error: 'Error',
        duration: 10,
      });

      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);
      await jest.advanceTimersByTimeAsync(300);

      expect(queue.getStats().failed).toBe(1);

      // Now make it succeed
      (singleFileSyncModule.syncSingleFile as jest.Mock).mockResolvedValue({
        success: true,
        operation: 'update',
        duration: 10,
      });

      queue.retryFailed();
      await jest.advanceTimersByTimeAsync(200);

      const stats = queue.getStats();
      expect(stats.failed).toBe(0);
      expect(stats.completed).toBe(1);
    });

    test('retryFailed emits retry-failed event', async () => {
      (singleFileSyncModule.syncSingleFile as jest.Mock).mockResolvedValue({
        success: false,
        operation: 'skip',
        error: 'Error',
        duration: 10,
      });

      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);

      await jest.advanceTimersByTimeAsync(300);

      let eventData: any = null;
      queue.on('retry-failed', (data) => {
        eventData = data;
      });

      queue.retryFailed();

      expect(eventData).not.toBeNull();
      expect(eventData.count).toBe(1);
    });

    test('clearFailed removes all failed items', async () => {
      (singleFileSyncModule.syncSingleFile as jest.Mock).mockResolvedValue({
        success: false,
        operation: 'skip',
        error: 'Error',
        duration: 10,
      });

      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
        { path: '/vault/Doc2.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);
      await jest.advanceTimersByTimeAsync(300);

      expect(queue.getStats().failed).toBe(2);

      queue.clearFailed();

      expect(queue.getStats().failed).toBe(0);
      expect(queue.getFailedItems().length).toBe(0);
    });

    test('clearFailed emits failed-cleared event', (done) => {
      queue.on('failed-cleared', (data) => {
        expect(data.count).toBe(0);
        done();
      });

      queue.clearFailed();
    });
  });

  describe('pause and resume', () => {
    beforeEach(() => {
      queue = new SyncQueue(mockClient, mockSyncState, { batchDelayMs: 100 });
    });

    test('pause sets isProcessing to false', () => {
      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);

      // Pause sets the flag
      queue.pause();

      // isActive should reflect the paused state
      expect(queue.isActive()).toBe(false);
    });

    test('pause emits paused event', (done) => {
      queue.on('paused', () => {
        done();
      });

      queue.pause();
    });

    test('resume triggers processing when items are pending', async () => {
      // Add items and let them complete
      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);
      await jest.advanceTimersByTimeAsync(200);

      // Add more after completion
      const changes2: FileChange[] = [
        { path: '/vault/Doc2.md', event: 'change', timestamp: new Date() },
      ];
      queue.addChanges(changes2, mockPairing);

      // Resume should trigger processing of pending items
      queue.resume();
      await jest.advanceTimersByTimeAsync(200);

      const stats = queue.getStats();
      expect(stats.completed).toBe(2); // Both items completed
    });

    test('resume emits resumed event', (done) => {
      queue.on('resumed', () => {
        done();
      });

      queue.resume();
    });

    test('isActive returns processing state', async () => {
      expect(queue.isActive()).toBe(false);

      const changes: FileChange[] = [
        { path: '/vault/Doc1.md', event: 'change', timestamp: new Date() },
      ];

      queue.addChanges(changes, mockPairing);
      await jest.advanceTimersByTimeAsync(50);

      expect(queue.isActive()).toBe(true);

      await jest.advanceTimersByTimeAsync(200);
      expect(queue.isActive()).toBe(false);
    });
  });
});

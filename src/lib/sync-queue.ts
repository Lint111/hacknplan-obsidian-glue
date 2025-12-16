import { EventEmitter } from 'events';
import pLimit from 'p-limit';
import type { FileChange } from './file-watcher.js';

import type { HacknPlanClient } from '../core/client.js';
import type { SyncStateOps } from '../tools/types.js';
import type { Pairing } from '../core/types.js';

/**
 * Queue item representing a pending sync operation
 */
export interface QueueItem {
  id: string;
  change: FileChange;
  pairing: Pairing;
  retries: number;
  lastError?: string;
  addedAt: Date;
}

/**
 * Queue statistics for monitoring
 */
export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  totalProcessed: number;
  averageProcessingTime: number;
  lastProcessedAt: Date | null;
}

/**
 * Configuration for sync queue behavior
 */
export interface SyncQueueConfig {
  concurrency?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  retryBackoffMultiplier?: number;
  batchDelayMs?: number;
}

/**
 * Sync queue manager with batching, retry logic, and concurrency control.
 *
 * Manages automatic sync operations triggered by file watcher changes.
 * Features:
 * - Concurrent processing with p-limit
 * - Exponential backoff retry
 * - Batching with configurable delay
 * - Event emission for monitoring
 */
export class SyncQueue extends EventEmitter {
  private queue: Map<string, QueueItem> = new Map();
  private processing: Set<string> = new Set();
  private completed: Set<string> = new Set();
  private failed: Map<string, QueueItem> = new Map();

  private hacknplanClient: HacknPlanClient;
  private syncState: SyncStateOps;
  private limit: ReturnType<typeof pLimit>;
  private config: Required<SyncQueueConfig>;

  private isProcessing = false;
  private processingTimeMs: number[] = [];
  private totalProcessed = 0;
  private lastProcessedAt: Date | null = null;

  constructor(hacknplanClient: HacknPlanClient, syncState: SyncStateOps, config: SyncQueueConfig = {}) {
    super();
    this.hacknplanClient = hacknplanClient;
    this.syncState = syncState;
    this.config = {
      concurrency: config.concurrency ?? 3,
      maxRetries: config.maxRetries ?? 3,
      retryDelayMs: config.retryDelayMs ?? 1000,
      retryBackoffMultiplier: config.retryBackoffMultiplier ?? 2,
      batchDelayMs: config.batchDelayMs ?? 2000,
    };
    this.limit = pLimit(this.config.concurrency);
  }

  /**
   * Add file changes to the sync queue.
   * Deduplicates by file path (last change wins).
   */
  addChanges(changes: FileChange[], pairing: Pairing): void {
    for (const change of changes) {
      const id = change.path;

      // If already processing/failed, skip (let current operation finish)
      if (this.processing.has(id) || this.failed.has(id)) {
        continue;
      }

      // Add or update queue item (last change wins)
      this.queue.set(id, {
        id,
        change,
        pairing,
        retries: 0,
        addedAt: new Date(),
      });
    }

    this.emit('queue-updated', { pending: this.queue.size });

    // Start processing if not already running
    if (!this.isProcessing) {
      this.startProcessing();
    }
  }

  /**
   * Start processing queued items with batching delay.
   */
  private async startProcessing(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    this.emit('processing-started');

    // Wait for batch delay (allow more changes to accumulate)
    await this.sleep(this.config.batchDelayMs);

    // Process all queued items concurrently (up to concurrency limit)
    const items = Array.from(this.queue.values());
    const promises = items.map((item) =>
      this.limit(() => this.processItem(item))
    );

    await Promise.allSettled(promises);

    this.isProcessing = false;
    this.emit('processing-completed', {
      processed: this.totalProcessed,
      failed: this.failed.size,
    });

    // If new items were added during processing, start again
    if (this.queue.size > 0) {
      this.startProcessing();
    }
  }

  /**
   * Process a single queue item with retry logic.
   */
  private async processItem(item: QueueItem): Promise<void> {
    const startTime = Date.now();
    this.queue.delete(item.id);
    this.processing.add(item.id);

    try {
      this.emit('item-processing', { id: item.id, retries: item.retries });

      // Execute sync operation
      // Phase 8: Single-file sync optimization
      const { syncSingleFile } = await import('./single-file-sync.js');

      const result = await syncSingleFile(
        item.change.path,
        item.pairing,
        this.hacknplanClient,
        this.syncState
      );

      // Check for errors
      if (!result.success) {
        throw new Error(result.error || 'Sync failed');
      }

      // Success
      this.processing.delete(item.id);
      this.completed.add(item.id);
      this.totalProcessed++;
      this.lastProcessedAt = new Date();

      const duration = Date.now() - startTime;
      this.processingTimeMs.push(duration);
      if (this.processingTimeMs.length > 100) {
        this.processingTimeMs.shift(); // Keep last 100 samples
      }

      this.emit('item-completed', { id: item.id, duration });
    } catch (error: any) {
      this.processing.delete(item.id);

      // Check if we should retry
      if (item.retries < this.config.maxRetries) {
        // Retry with exponential backoff
        const delay =
          this.config.retryDelayMs *
          Math.pow(this.config.retryBackoffMultiplier, item.retries);

        item.retries++;
        item.lastError = error.message;

        this.emit('item-retry', {
          id: item.id,
          retries: item.retries,
          delay,
          error: error.message,
        });

        // Re-add to queue after delay
        await this.sleep(delay);
        this.queue.set(item.id, item);
      } else {
        // Max retries exceeded, mark as failed
        item.lastError = error.message;
        this.failed.set(item.id, item);

        this.emit('item-failed', {
          id: item.id,
          error: error.message,
          retries: item.retries,
        });
      }
    }
  }

  /**
   * Get current queue statistics.
   */
  getStats(): QueueStats {
    const avgTime =
      this.processingTimeMs.length > 0
        ? this.processingTimeMs.reduce((a, b) => a + b, 0) / this.processingTimeMs.length
        : 0;

    return {
      pending: this.queue.size,
      processing: this.processing.size,
      completed: this.completed.size,
      failed: this.failed.size,
      totalProcessed: this.totalProcessed,
      averageProcessingTime: Math.round(avgTime),
      lastProcessedAt: this.lastProcessedAt,
    };
  }

  /**
   * Get failed items for manual retry.
   */
  getFailedItems(): QueueItem[] {
    return Array.from(this.failed.values());
  }

  /**
   * Retry all failed items.
   */
  retryFailed(): void {
    const failedItems = Array.from(this.failed.values());
    this.failed.clear();

    for (const item of failedItems) {
      item.retries = 0; // Reset retry counter
      item.lastError = undefined;
      this.queue.set(item.id, item);
    }

    this.emit('retry-failed', { count: failedItems.length });

    if (!this.isProcessing && this.queue.size > 0) {
      this.startProcessing();
    }
  }

  /**
   * Clear all failed items.
   */
  clearFailed(): void {
    const count = this.failed.size;
    this.failed.clear();
    this.emit('failed-cleared', { count });
  }

  /**
   * Pause queue processing.
   */
  pause(): void {
    this.isProcessing = false;
    this.emit('paused');
  }

  /**
   * Resume queue processing.
   */
  resume(): void {
    if (this.queue.size > 0 && !this.isProcessing) {
      this.startProcessing();
    }
    this.emit('resumed');
  }

  /**
   * Check if queue is currently processing.
   */
  isActive(): boolean {
    return this.isProcessing;
  }

  /**
   * Sleep helper for delays and backoff.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

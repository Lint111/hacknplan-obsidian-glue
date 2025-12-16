import chokidar from 'chokidar';
import debounce from 'lodash.debounce';
import path from 'path';
import { EventEmitter } from 'events';

export interface FileWatcherConfig {
  vaultPath: string;
  debounceMs?: number;
}

export interface WatcherStats {
  isWatching: boolean;
  vaultPath: string | null;
  pendingChanges: number;
  filesWatched: number;
  lastChange: Date | null;
}

export type ChangeEvent = 'add' | 'change' | 'unlink';

export interface FileChange {
  path: string;
  event: ChangeEvent;
  timestamp: Date;
}

/**
 * Real-time file watcher for Obsidian vault using chokidar.
 * Monitors .md files and emits debounced change events for sync processing.
 */
export class FileWatcher extends EventEmitter {
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private changeQueue: Map<string, FileChange> = new Map();
  private vaultPath: string | null = null;
  private debounceMs: number;
  private debouncedProcess: (() => void) | null = null;
  private filesWatched: number = 0;
  private lastChange: Date | null = null;

  constructor() {
    super();
    this.debounceMs = 5000; // Default 5-second debounce
  }

  /**
   * Start watching a vault directory for .md file changes.
   * @param config - Configuration with vault path and optional debounce time
   */
  start(config: FileWatcherConfig): void {
    if (this.watcher) {
      throw new Error('FileWatcher is already running. Call stop() first.');
    }

    this.vaultPath = path.resolve(config.vaultPath);
    this.debounceMs = config.debounceMs ?? 5000;

    // Initialize chokidar with .md file filter
    this.watcher = chokidar.watch('**/*.md', {
      cwd: this.vaultPath,
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/.*', // Hidden files/folders
      ],
      persistent: true,
      ignoreInitial: true, // Don't emit events for existing files on startup
      awaitWriteFinish: {
        stabilityThreshold: 300, // Wait 300ms for file writes to complete
        pollInterval: 100,
      },
    });

    // Set up debounced processing
    this.debouncedProcess = debounce(() => {
      this.processChangeQueue();
    }, this.debounceMs);

    // Watch for file events
    this.watcher
      .on('add', (filePath: string) => this.handleChange(filePath, 'add'))
      .on('change', (filePath: string) => this.handleChange(filePath, 'change'))
      .on('unlink', (filePath: string) => this.handleChange(filePath, 'unlink'))
      .on('error', (error: unknown) => this.emit('error', error))
      .on('ready', () => {
        this.filesWatched = Object.keys(this.watcher?.getWatched() ?? {}).length;
        this.emit('ready', { vaultPath: this.vaultPath, filesWatched: this.filesWatched });
      });

    this.emit('started', { vaultPath: this.vaultPath });
  }

  /**
   * Stop watching the vault and clean up resources.
   */
  async stop(): Promise<void> {
    if (!this.watcher) {
      return;
    }

    // Process any remaining changes before stopping
    if (this.changeQueue.size > 0) {
      this.processChangeQueue();
    }

    await this.watcher.close();
    this.watcher = null;
    this.vaultPath = null;
    this.changeQueue.clear();
    this.debouncedProcess = null;
    this.filesWatched = 0;
    this.lastChange = null;

    this.emit('stopped');
  }

  /**
   * Handle individual file change events.
   * Adds changes to queue and triggers debounced processing.
   */
  private handleChange(filePath: string, event: ChangeEvent): void {
    const absolutePath = path.join(this.vaultPath!, filePath);
    const change: FileChange = {
      path: absolutePath,
      event,
      timestamp: new Date(),
    };

    // Add/update in change queue (last event wins for same file)
    this.changeQueue.set(absolutePath, change);
    this.lastChange = change.timestamp;

    this.emit('change-detected', change);

    // Trigger debounced processing
    this.debouncedProcess?.();
  }

  /**
   * Process accumulated changes and emit sync event.
   * Called after debounce period expires.
   */
  private processChangeQueue(): void {
    if (this.changeQueue.size === 0) {
      return;
    }

    const changes = Array.from(this.changeQueue.values());
    this.changeQueue.clear();

    this.emit('changes-ready', changes);
  }

  /**
   * Get current watcher status and statistics.
   */
  getStatus(): WatcherStats {
    return {
      isWatching: this.watcher !== null,
      vaultPath: this.vaultPath,
      pendingChanges: this.changeQueue.size,
      filesWatched: this.filesWatched,
      lastChange: this.lastChange,
    };
  }

  /**
   * Get pending changes without processing them.
   */
  getPendingChanges(): FileChange[] {
    return Array.from(this.changeQueue.values());
  }

  /**
   * Check if watcher is currently active.
   */
  isWatching(): boolean {
    return this.watcher !== null;
  }
}

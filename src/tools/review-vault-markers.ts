/**
 * Review Vault Markers Tools
 *
 * Tools for managing review markers (NeedsReview, OutOfSync, Completed)
 * in vault documents. These markers are injected when HacknPlan work items
 * change state.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { ToolDefinition } from './types.js';
import {
  scanFilesForMarkers,
  removeMarkerFromFile,
  injectMarkerIntoFile,
  createNeedsReviewMarker,
  createOutOfSyncMarker,
  createCompletedMarker,
  type VaultMarker,
  type MarkerType,
  type MarkerScanResult,
} from '../lib/marker-injector.js';

// ============ Tool 1: Review Vault Markers ============

interface ReviewVaultMarkersArgs {
  vault_path: string;
  marker_type?: MarkerType;
  hacknplan_id?: number;
}

interface ReviewVaultMarkersResult {
  scanned_files: number;
  total_markers: number;
  markers: Array<{
    file: string;
    type: MarkerType;
    hacknplan_id: number;
    date: string;
    reason: string;
  }>;
}

/**
 * Recursively find all markdown files in a directory
 */
async function findMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip .git and node_modules
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      files.push(...(await findMarkdownFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

export const reviewVaultMarkers: ToolDefinition<ReviewVaultMarkersArgs, ReviewVaultMarkersResult> =
  {
    name: 'review_vault_markers',
    description:
      'Scan vault for review markers (NeedsReview, OutOfSync, Completed). ' +
      'These markers are HTML comments injected when HacknPlan work items change state. ' +
      'Optionally filter by marker type or HacknPlan ID.',
    inputSchema: {
      type: 'object',
      properties: {
        vault_path: {
          type: 'string',
          description: 'Absolute path to Obsidian vault root',
        },
        marker_type: {
          type: 'string',
          enum: ['NeedsReview', 'OutOfSync', 'Completed'],
          description: 'Optional: filter by marker type',
        },
        hacknplan_id: {
          type: 'number',
          description: 'Optional: filter by HacknPlan ID',
        },
      },
      required: ['vault_path'],
    },
    handler: async (args, _ctx) => {
      const { vault_path, marker_type, hacknplan_id } = args;

      // Find all markdown files
      const markdownFiles = await findMarkdownFiles(vault_path);

      // Scan all files for markers
      const scanResults = await scanFilesForMarkers(markdownFiles);

      // Filter results
      let filteredResults = scanResults;
      if (marker_type || hacknplan_id !== undefined) {
        filteredResults = scanResults
          .map((result) => ({
            filePath: result.filePath,
            markers: result.markers.filter((m) => {
              if (marker_type && m.type !== marker_type) return false;
              if (hacknplan_id !== undefined && m.hacknplanId !== hacknplan_id) return false;
              return true;
            }),
          }))
          .filter((result) => result.markers.length > 0);
      }

      // Flatten to marker list
      const markers = filteredResults.flatMap((result) =>
        result.markers.map((m) => ({
          file: path.relative(vault_path, result.filePath),
          type: m.type,
          hacknplan_id: m.hacknplanId,
          date: m.date,
          reason: m.reason,
        }))
      );

      return {
        scanned_files: markdownFiles.length,
        total_markers: markers.length,
        markers,
      };
    },
  };

// ============ Tool 2: Clear Vault Marker ============

interface ClearVaultMarkerArgs {
  file_path: string;
  hacknplan_id: number;
  marker_type?: MarkerType;
}

interface ClearVaultMarkerResult {
  success: boolean;
  removed: boolean;
  message: string;
}

export const clearVaultMarker: ToolDefinition<ClearVaultMarkerArgs, ClearVaultMarkerResult> = {
  name: 'clear_vault_marker',
  description:
    'Remove a review marker from a vault document by HacknPlan ID. ' +
    'Optionally specify marker type to remove only that type (otherwise removes all types for that ID).',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute path to the markdown file',
      },
      hacknplan_id: {
        type: 'number',
        description: 'HacknPlan ID to match',
      },
      marker_type: {
        type: 'string',
        enum: ['NeedsReview', 'OutOfSync', 'Completed'],
        description: 'Optional: marker type to remove (removes all types if not specified)',
      },
    },
    required: ['file_path', 'hacknplan_id'],
  },
  handler: async (args, _ctx) => {
    const { file_path, hacknplan_id, marker_type } = args;

    try {
      const removed = await removeMarkerFromFile(file_path, hacknplan_id, marker_type);

      if (removed) {
        return {
          success: true,
          removed: true,
          message: marker_type
            ? `Removed ${marker_type} marker for HP-${hacknplan_id}`
            : `Removed all markers for HP-${hacknplan_id}`,
        };
      } else {
        return {
          success: true,
          removed: false,
          message: `No marker found for HP-${hacknplan_id}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        removed: false,
        message: `Error: ${(error as Error).message}`,
      };
    }
  },
};

// ============ Tool 3: Inject Vault Marker ============

interface InjectVaultMarkerArgs {
  file_path: string;
  marker_type: MarkerType;
  hacknplan_id: number;
  reason: string;
  position?: 'after-frontmatter' | 'end-of-file';
}

interface InjectVaultMarkerResult {
  success: boolean;
  message: string;
  marker: string;
}

export const injectVaultMarker: ToolDefinition<InjectVaultMarkerArgs, InjectVaultMarkerResult> = {
  name: 'inject_vault_marker',
  description:
    'Manually inject a review marker into a vault document. ' +
    'Marker is an HTML comment that is invisible in Obsidian preview mode. ' +
    'Use position="after-frontmatter" (default) or "end-of-file".',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute path to the markdown file',
      },
      marker_type: {
        type: 'string',
        enum: ['NeedsReview', 'OutOfSync', 'Completed'],
        description: 'Marker type to inject',
      },
      hacknplan_id: {
        type: 'number',
        description: 'HacknPlan ID',
      },
      reason: {
        type: 'string',
        description: 'Reason for marker (e.g., "Task completed", "Doc may be stale")',
      },
      position: {
        type: 'string',
        enum: ['after-frontmatter', 'end-of-file'],
        description: 'Where to inject marker (default: after-frontmatter)',
      },
    },
    required: ['file_path', 'marker_type', 'hacknplan_id', 'reason'],
  },
  handler: async (args, _ctx) => {
    const { file_path, marker_type, hacknplan_id, reason, position = 'after-frontmatter' } = args;

    try {
      let marker: VaultMarker;

      switch (marker_type) {
        case 'NeedsReview':
          marker = createNeedsReviewMarker(hacknplan_id, reason);
          break;
        case 'OutOfSync':
          marker = createOutOfSyncMarker(hacknplan_id, reason);
          break;
        case 'Completed':
          marker = createCompletedMarker(hacknplan_id, reason);
          break;
      }

      await injectMarkerIntoFile(file_path, marker, { position });

      return {
        success: true,
        message: `Injected ${marker_type} marker for HP-${hacknplan_id}`,
        marker: `<!-- #${marker_type}[HP-${hacknplan_id}|${marker.date}]: ${reason} -->`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error: ${(error as Error).message}`,
        marker: '',
      };
    }
  },
};

export const reviewMarkerTools = [reviewVaultMarkers, clearVaultMarker, injectVaultMarker];

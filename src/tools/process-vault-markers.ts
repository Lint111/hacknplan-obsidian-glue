/**
 * Process Vault Markers Tool
 *
 * Scans vault documents for #Todo, #Feature, #Limitation, and #Bug markers
 * and creates corresponding HacknPlan design elements.
 */

import { promises as fs } from 'fs';
import path from 'path';
import matter from 'gray-matter';
import type { ToolDefinition } from './types.js';
import { parseMarkers, markerToWorkItemRequest, type Marker } from '../lib/marker-parser.js';

interface ProcessVaultMarkersArgs {
  project_id: number;
  vault_path: string;
  dry_run?: boolean;
  type_id?: number;
}

interface ProcessVaultMarkersResult {
  scanned_files: number;
  markers_found: number;
  markers_processed: number;
  markers_skipped: number;
  operations: Array<{
    file: string;
    marker: string;
    action: string;
    design_element_id?: number;
  }>;
  dry_run: boolean;
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

/**
 * Get marker IDs from frontmatter
 */
function getProcessedMarkerIds(filePath: string, content: string): Map<number, number> {
  try {
    const parsed = matter(content);
    const markerIds = parsed.data.marker_ids as Record<string, number> | undefined;

    if (!markerIds) {
      return new Map();
    }

    // Convert { "12": 456 } to Map<lineNumber, hacknplanId>
    const map = new Map<number, number>();
    for (const [lineStr, id] of Object.entries(markerIds)) {
      map.set(parseInt(lineStr, 10), id);
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Update frontmatter with new marker ID
 */
async function updateMarkerIds(
  filePath: string,
  content: string,
  lineNumber: number,
  hacknplanId: number
): Promise<void> {
  const parsed = matter(content);
  const markerIds = (parsed.data.marker_ids as Record<string, number>) || {};

  markerIds[lineNumber.toString()] = hacknplanId;
  parsed.data.marker_ids = markerIds;

  const updated = matter.stringify(parsed.content, parsed.data);

  // Atomic write
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, updated, 'utf-8');
  await fs.rename(tempPath, filePath);
}

/**
 * Tool: process_vault_markers
 *
 * Scans vault for markers and creates HacknPlan design elements.
 */
export const processVaultMarkers: ToolDefinition<
  ProcessVaultMarkersArgs,
  ProcessVaultMarkersResult
> = {
  name: 'process_vault_markers',
  description:
    'Scan vault for markers (#Todo, #Feature, #Limitation, #Bug) and create HacknPlan design elements. ' +
    'Markers already processed (tracked in frontmatter marker_ids) are skipped. ' +
    'Use dry_run=true to preview operations without creating design elements.',
  inputSchema: {
    type: 'object',
    properties: {
      project_id: {
        type: 'number',
        description: 'HacknPlan project ID',
      },
      vault_path: {
        type: 'string',
        description: 'Absolute path to Obsidian vault root',
      },
      dry_run: {
        type: 'boolean',
        description: 'If true, preview operations without creating design elements (default: false)',
      },
      type_id: {
        type: 'number',
        description:
          'HacknPlan design element type ID to use for all markers. If not specified, must be provided per-marker.',
      },
    },
    required: ['project_id', 'vault_path'],
  },
  handler: async (args, ctx) => {
    const { project_id, vault_path, dry_run = false, type_id } = args;

    if (!ctx.hacknplanClient) {
      throw new Error('HacknPlan API client not available');
    }

    // Find all markdown files
    const markdownFiles = await findMarkdownFiles(vault_path);

    const result: ProcessVaultMarkersResult = {
      scanned_files: markdownFiles.length,
      markers_found: 0,
      markers_processed: 0,
      markers_skipped: 0,
      operations: [],
      dry_run,
    };

    for (const filePath of markdownFiles) {
      const content = await fs.readFile(filePath, 'utf-8');
      const relativePath = path.relative(vault_path, filePath);

      // Parse markers
      const parseResult = parseMarkers(content, relativePath);
      result.markers_found += parseResult.markers.length;

      if (parseResult.markers.length === 0) continue;

      // Get already-processed marker IDs
      const processedIds = getProcessedMarkerIds(filePath, content);

      for (const marker of parseResult.markers) {
        // Skip if already processed
        if (processedIds.has(marker.lineNumber)) {
          result.markers_skipped++;
          result.operations.push({
            file: relativePath,
            marker: marker.rawText,
            action: 'skip (already processed)',
          });
          continue;
        }

        // Convert marker to work item request
        const effectiveTypeId = type_id ?? 0; // Would need type mapping in production
        if (!type_id) {
          result.operations.push({
            file: relativePath,
            marker: marker.rawText,
            action: 'skip (no type_id)',
          });
          result.markers_skipped++;
          continue;
        }

        const request = markerToWorkItemRequest(marker, effectiveTypeId);

        if (dry_run) {
          result.operations.push({
            file: relativePath,
            marker: marker.rawText,
            action: `would create: ${request.name}`,
          });
          result.markers_processed++;
        } else {
          // Create design element via HacknPlan API
          const designElement = await ctx.hacknplanClient.createDesignElement(project_id, {
            typeId: effectiveTypeId,
            name: request.name,
            description: request.description,
          });

          // Update frontmatter with marker ID
          await updateMarkerIds(filePath, content, marker.lineNumber, designElement.designElementId);

          result.operations.push({
            file: relativePath,
            marker: marker.rawText,
            action: 'created',
            design_element_id: designElement.designElementId,
          });
          result.markers_processed++;
        }
      }
    }

    return result;
  },
};

export const processMarkerTools = [processVaultMarkers];

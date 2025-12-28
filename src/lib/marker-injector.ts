/**
 * Marker Injector - Inject review markers into vault documents
 *
 * Phase 11 of the glue MCP: Automatically injects HTML comment markers
 * into vault documents when HacknPlan work items change state.
 *
 * Markers are HTML comments and invisible in Obsidian preview mode.
 */

import { promises as fs } from 'fs';
import matter from 'gray-matter';

// ============ MARKER TYPES ============

/**
 * Marker types that can be injected into vault documents
 */
export type MarkerType = 'NeedsReview' | 'OutOfSync' | 'Completed';

/**
 * A marker instance found in or to be injected into a document
 */
export interface VaultMarker {
  type: MarkerType;
  hacknplanId: number;
  date: string;
  reason: string;
}

/**
 * Result of scanning a file for markers
 */
export interface MarkerScanResult {
  filePath: string;
  markers: VaultMarker[];
}

/**
 * Options for marker injection
 */
export interface InjectionOptions {
  /** Position to inject marker: 'after-frontmatter' or 'end-of-file' */
  position?: 'after-frontmatter' | 'end-of-file';
}

// ============ MARKER PATTERNS ============

/**
 * Create pattern for specific marker type
 */
function createMarkerPattern(type: MarkerType): RegExp {
  return new RegExp(`<!--\\s*#${type}\\[HP-(\\d+)\\|([^\\]]+)\\]:\\s*(.+?)\\s*-->`, 'g');
}

/**
 * Create pattern to match any marker type
 */
function createAnyMarkerPattern(): RegExp {
  return /<!--\s*#(NeedsReview|OutOfSync|Completed)\[HP-(\d+)\|([^\]]+)\]:\s*(.+?)\s*-->/g;
}

// ============ MARKER FORMATTING ============

/**
 * Format a marker as an HTML comment
 *
 * @param marker - Marker to format
 * @returns HTML comment string
 *
 * @example
 * formatMarker({ type: 'NeedsReview', hacknplanId: 123, date: '2025-01-15', reason: 'Task completed' })
 * // Returns: '<!-- #NeedsReview[HP-123|2025-01-15]: Task completed -->'
 */
export function formatMarker(marker: VaultMarker): string {
  return `<!-- #${marker.type}[HP-${marker.hacknplanId}|${marker.date}]: ${marker.reason} -->`;
}

/**
 * Parse a marker from an HTML comment string
 *
 * @param commentText - HTML comment text to parse
 * @returns Parsed marker or null if not a valid marker
 */
export function parseMarker(commentText: string): VaultMarker | null {
  const pattern = createAnyMarkerPattern();
  const match = pattern.exec(commentText);

  if (!match) {
    return null;
  }

  const [, type, idStr, date, reason] = match;
  return {
    type: type as MarkerType,
    hacknplanId: parseInt(idStr, 10),
    date,
    reason,
  };
}

// ============ MARKER INJECTION ============

/**
 * Inject a marker into document content
 *
 * Injects the marker at the specified position while preserving
 * existing content and frontmatter formatting.
 *
 * @param content - Original document content
 * @param marker - Marker to inject
 * @param options - Injection options
 * @returns Document content with marker injected
 */
export function injectMarker(
  content: string,
  marker: VaultMarker,
  options: InjectionOptions = {}
): string {
  const { position = 'after-frontmatter' } = options;
  const markerLine = formatMarker(marker);

  if (position === 'end-of-file') {
    // Ensure newline before marker at end of file
    const trimmed = content.trimEnd();
    return `${trimmed}\n\n${markerLine}\n`;
  }

  // Position: after-frontmatter (default)
  try {
    const parsed = matter(content);
    const hasFrontmatter = Object.keys(parsed.data).length > 0;

    if (hasFrontmatter) {
      // Insert marker after frontmatter, before content
      const frontmatterYaml = matter.stringify('', parsed.data).trim();
      const bodyContent = parsed.content.trimStart();
      return `${frontmatterYaml}\n\n${markerLine}\n\n${bodyContent}`;
    } else {
      // No frontmatter - insert at beginning
      const bodyContent = content.trimStart();
      return `${markerLine}\n\n${bodyContent}`;
    }
  } catch {
    // Fallback: insert at beginning
    const bodyContent = content.trimStart();
    return `${markerLine}\n\n${bodyContent}`;
  }
}

/**
 * Inject a marker into a vault file
 *
 * @param filePath - Absolute path to the markdown file
 * @param marker - Marker to inject
 * @param options - Injection options
 */
export async function injectMarkerIntoFile(
  filePath: string,
  marker: VaultMarker,
  options: InjectionOptions = {}
): Promise<void> {
  const content = await fs.readFile(filePath, 'utf-8');
  const updatedContent = injectMarker(content, marker, options);

  // Atomic write
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, updatedContent, 'utf-8');
  await fs.rename(tempPath, filePath);
}

// ============ MARKER SCANNING ============

/**
 * Scan content for all markers
 *
 * @param content - Document content to scan
 * @returns Array of markers found
 */
export function scanContentForMarkers(content: string): VaultMarker[] {
  const markers: VaultMarker[] = [];
  const pattern = createAnyMarkerPattern();
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const [, type, idStr, date, reason] = match;
    markers.push({
      type: type as MarkerType,
      hacknplanId: parseInt(idStr, 10),
      date,
      reason,
    });
  }

  return markers;
}

/**
 * Scan a file for markers
 *
 * @param filePath - Absolute path to the markdown file
 * @returns Scan result with file path and markers found
 */
export async function scanFileForMarkers(filePath: string): Promise<MarkerScanResult> {
  const content = await fs.readFile(filePath, 'utf-8');
  const markers = scanContentForMarkers(content);
  return { filePath, markers };
}

/**
 * Scan multiple files for markers
 *
 * @param filePaths - Array of absolute paths to scan
 * @returns Array of scan results
 */
export async function scanFilesForMarkers(filePaths: string[]): Promise<MarkerScanResult[]> {
  const results: MarkerScanResult[] = [];

  for (const filePath of filePaths) {
    try {
      const result = await scanFileForMarkers(filePath);
      if (result.markers.length > 0) {
        results.push(result);
      }
    } catch (error) {
      // Skip files that can't be read
      console.error(`[glue] Failed to scan ${filePath}: ${(error as Error).message}`);
    }
  }

  return results;
}

// ============ MARKER REMOVAL ============

/**
 * Remove a specific marker from content
 *
 * @param content - Document content
 * @param hacknplanId - HacknPlan ID to match
 * @param markerType - Optional marker type to match (removes all types if not specified)
 * @returns Content with marker(s) removed
 */
export function removeMarker(
  content: string,
  hacknplanId: number,
  markerType?: MarkerType
): string {
  let result = content;

  if (markerType) {
    // Remove specific marker type
    const pattern = createMarkerPattern(markerType);
    result = result.replace(pattern, (match, id) => {
      if (parseInt(id, 10) === hacknplanId) {
        return '';
      }
      return match;
    });
  } else {
    // Remove all markers for this HacknPlan ID
    const types: MarkerType[] = ['NeedsReview', 'OutOfSync', 'Completed'];
    for (const type of types) {
      const pattern = createMarkerPattern(type);
      result = result.replace(pattern, (match, id) => {
        if (parseInt(id, 10) === hacknplanId) {
          return '';
        }
        return match;
      });
    }
  }

  // Clean up extra newlines
  return result.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/**
 * Remove all markers of a specific type from content
 *
 * @param content - Document content
 * @param markerType - Marker type to remove
 * @returns Content with markers removed
 */
export function removeAllMarkersOfType(content: string, markerType: MarkerType): string {
  const pattern = createMarkerPattern(markerType);
  return content.replace(pattern, '').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/**
 * Remove a marker from a vault file
 *
 * @param filePath - Absolute path to the markdown file
 * @param hacknplanId - HacknPlan ID to match
 * @param markerType - Optional marker type to match
 * @returns True if marker was found and removed
 */
export async function removeMarkerFromFile(
  filePath: string,
  hacknplanId: number,
  markerType?: MarkerType
): Promise<boolean> {
  const content = await fs.readFile(filePath, 'utf-8');
  const markers = scanContentForMarkers(content);

  // Check if marker exists
  const hasMarker = markers.some(
    (m) => m.hacknplanId === hacknplanId && (!markerType || m.type === markerType)
  );

  if (!hasMarker) {
    return false;
  }

  const updatedContent = removeMarker(content, hacknplanId, markerType);

  // Atomic write
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, updatedContent, 'utf-8');
  await fs.rename(tempPath, filePath);

  return true;
}

// ============ MARKER CREATION HELPERS ============

/**
 * Create a NeedsReview marker
 *
 * @param hacknplanId - HacknPlan work item ID
 * @param reason - Reason for review (e.g., "Task completed", "Moved to In Review")
 * @returns Marker object
 */
export function createNeedsReviewMarker(hacknplanId: number, reason: string): VaultMarker {
  return {
    type: 'NeedsReview',
    hacknplanId,
    date: new Date().toISOString().split('T')[0],
    reason,
  };
}

/**
 * Create an OutOfSync marker
 *
 * @param hacknplanId - HacknPlan work item ID
 * @param reason - Optional reason (defaults to "Doc may be stale")
 * @returns Marker object
 */
export function createOutOfSyncMarker(
  hacknplanId: number,
  reason: string = 'Doc may be stale'
): VaultMarker {
  return {
    type: 'OutOfSync',
    hacknplanId,
    date: new Date().toISOString().split('T')[0],
    reason,
  };
}

/**
 * Create a Completed marker
 *
 * @param hacknplanId - HacknPlan work item ID
 * @param title - Work item title
 * @returns Marker object
 */
export function createCompletedMarker(hacknplanId: number, title: string): VaultMarker {
  return {
    type: 'Completed',
    hacknplanId,
    date: new Date().toISOString().split('T')[0],
    reason: title,
  };
}

// ============ VAULT DOC LOOKUP ============

/**
 * Find vault documents related to a HacknPlan ID using sync state
 *
 * @param hacknplanId - HacknPlan design element ID
 * @param syncStateGetter - Function to get sync state entry by HacknPlan ID
 * @returns Array of file paths that are linked to this HacknPlan ID
 */
export function findRelatedVaultDocs(
  hacknplanId: number,
  syncStateGetter: (id: number) => { filePath: string } | undefined
): string[] {
  const entry = syncStateGetter(hacknplanId);
  return entry ? [entry.filePath] : [];
}

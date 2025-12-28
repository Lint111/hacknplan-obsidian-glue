/**
 * Vault marker parsing for automatic HacknPlan work item creation
 *
 * Parses special markers in Obsidian vault documents:
 * - #Todo[category|estimate|tags]: Description
 * - #Feature[priority|milestone]: Description
 * - #Limitation[severity]: Description
 * - #Bug[severity|tags]: Description
 */

/**
 * Marker type enumeration
 */
export type MarkerType = 'Todo' | 'Feature' | 'Limitation' | 'Bug';

/**
 * Priority levels for features and bugs
 */
export type Priority = 'low' | 'medium' | 'high' | 'critical';

/**
 * Severity levels for limitations and bugs
 */
export type Severity = 'info' | 'known' | 'minor' | 'major' | 'critical';

/**
 * Base marker interface with common fields
 */
export interface BaseMarker {
  type: MarkerType;
  description: string;
  rawText: string;
  lineNumber: number;
  sourceFile?: string;
}

/**
 * Todo marker: #Todo[category|estimate|tags]: Description
 *
 * @example #Todo[programming|2h|feature]: Implement single-file sync
 */
export interface TodoMarker extends BaseMarker {
  type: 'Todo';
  category?: string;
  estimate?: string;
  tags: string[];
}

/**
 * Feature marker: #Feature[priority|milestone]: Description
 *
 * @example #Feature[high|v2.0]: Real-time collaboration
 */
export interface FeatureMarker extends BaseMarker {
  type: 'Feature';
  priority?: Priority;
  milestone?: string;
}

/**
 * Limitation marker: #Limitation[severity]: Description
 *
 * @example #Limitation[known]: Full vault sync on every change
 */
export interface LimitationMarker extends BaseMarker {
  type: 'Limitation';
  severity?: Severity;
}

/**
 * Bug marker: #Bug[severity|tags]: Description
 *
 * @example #Bug[critical|regression]: Sync fails on large files
 */
export interface BugMarker extends BaseMarker {
  type: 'Bug';
  severity?: Severity;
  tags: string[];
}

/**
 * Union type for all marker types
 */
export type Marker = TodoMarker | FeatureMarker | LimitationMarker | BugMarker;

/**
 * Result of parsing a document for markers
 */
export interface MarkerParseResult {
  markers: Marker[];
  errors: MarkerParseError[];
}

/**
 * Error encountered during marker parsing
 */
export interface MarkerParseError {
  lineNumber: number;
  rawText: string;
  error: string;
}

// Regex patterns for each marker type
// Format: #Type[params]: Description
const MARKER_PATTERN = /^#(Todo|Feature|Limitation|Bug)\[([^\]]*)\]:\s*(.+)$/;

// Alternative pattern for markers without brackets (just description)
const SIMPLE_MARKER_PATTERN = /^#(Todo|Feature|Limitation|Bug):\s*(.+)$/;

/**
 * Parse estimate string into normalized format
 *
 * Accepts formats: "2h", "2 hours", "30m", "1d", "1.5h"
 *
 * @param estimate - Raw estimate string
 * @returns Normalized estimate or undefined if invalid
 */
export function parseEstimate(estimate: string | undefined): string | undefined {
  if (!estimate) return undefined;

  const trimmed = estimate.trim().toLowerCase();
  if (!trimmed) return undefined;

  // Already in short format (2h, 30m, 1d)
  const shortFormat = /^(\d+(?:\.\d+)?)\s*(h|m|d)$/;
  const shortMatch = shortFormat.exec(trimmed);
  if (shortMatch) {
    return `${shortMatch[1]}${shortMatch[2]}`;
  }

  // Long format (2 hours, 30 minutes, 1 day)
  const longFormat = /^(\d+(?:\.\d+)?)\s*(hours?|minutes?|days?)$/;
  const longMatch = longFormat.exec(trimmed);
  if (longMatch) {
    const unit = longMatch[2].startsWith('hour')
      ? 'h'
      : longMatch[2].startsWith('minute')
        ? 'm'
        : 'd';
    return `${longMatch[1]}${unit}`;
  }

  // Return as-is if format is recognized but unusual
  return trimmed;
}

/**
 * Parse priority string into normalized Priority type
 *
 * @param priority - Raw priority string
 * @returns Normalized priority or undefined if invalid
 */
export function parsePriority(priority: string | undefined): Priority | undefined {
  if (!priority) return undefined;

  const normalized = priority.trim().toLowerCase();
  const validPriorities: Priority[] = ['low', 'medium', 'high', 'critical'];

  if (validPriorities.includes(normalized as Priority)) {
    return normalized as Priority;
  }

  // Handle aliases
  const aliases: Record<string, Priority> = {
    lo: 'low',
    med: 'medium',
    hi: 'high',
    crit: 'critical',
  };

  return aliases[normalized];
}

/**
 * Parse severity string into normalized Severity type
 *
 * @param severity - Raw severity string
 * @returns Normalized severity or undefined if invalid
 */
export function parseSeverity(severity: string | undefined): Severity | undefined {
  if (!severity) return undefined;

  const normalized = severity.trim().toLowerCase();
  const validSeverities: Severity[] = ['info', 'known', 'minor', 'major', 'critical'];

  if (validSeverities.includes(normalized as Severity)) {
    return normalized as Severity;
  }

  return undefined;
}

/**
 * Parse tags from a comma-separated string
 *
 * @param tagsStr - Comma-separated tag string
 * @returns Array of normalized tag strings
 */
export function parseTags(tagsStr: string | undefined): string[] {
  if (!tagsStr) return [];

  return tagsStr
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
}

/**
 * Parse parameters from the bracket section [param1|param2|param3]
 *
 * @param paramsStr - Raw parameter string from brackets
 * @returns Array of trimmed parameter strings
 */
function parseParams(paramsStr: string): string[] {
  if (!paramsStr || paramsStr.trim() === '') return [];
  return paramsStr.split('|').map((p) => p.trim());
}

/**
 * Parse a single Todo marker
 *
 * Format: #Todo[category|estimate|tags]: Description
 *
 * @param params - Parsed parameter array
 * @param description - Marker description text
 * @param rawText - Original line text
 * @param lineNumber - Line number in source file
 * @returns Parsed TodoMarker
 */
function parseTodoMarker(
  params: string[],
  description: string,
  rawText: string,
  lineNumber: number
): TodoMarker {
  return {
    type: 'Todo',
    category: params[0] || undefined,
    estimate: parseEstimate(params[1]),
    tags: parseTags(params[2]),
    description,
    rawText,
    lineNumber,
  };
}

/**
 * Parse a single Feature marker
 *
 * Format: #Feature[priority|milestone]: Description
 *
 * @param params - Parsed parameter array
 * @param description - Marker description text
 * @param rawText - Original line text
 * @param lineNumber - Line number in source file
 * @returns Parsed FeatureMarker
 */
function parseFeatureMarker(
  params: string[],
  description: string,
  rawText: string,
  lineNumber: number
): FeatureMarker {
  return {
    type: 'Feature',
    priority: parsePriority(params[0]),
    milestone: params[1] || undefined,
    description,
    rawText,
    lineNumber,
  };
}

/**
 * Parse a single Limitation marker
 *
 * Format: #Limitation[severity]: Description
 *
 * @param params - Parsed parameter array
 * @param description - Marker description text
 * @param rawText - Original line text
 * @param lineNumber - Line number in source file
 * @returns Parsed LimitationMarker
 */
function parseLimitationMarker(
  params: string[],
  description: string,
  rawText: string,
  lineNumber: number
): LimitationMarker {
  return {
    type: 'Limitation',
    severity: parseSeverity(params[0]),
    description,
    rawText,
    lineNumber,
  };
}

/**
 * Parse a single Bug marker
 *
 * Format: #Bug[severity|tags]: Description
 *
 * @param params - Parsed parameter array
 * @param description - Marker description text
 * @param rawText - Original line text
 * @param lineNumber - Line number in source file
 * @returns Parsed BugMarker
 */
function parseBugMarker(
  params: string[],
  description: string,
  rawText: string,
  lineNumber: number
): BugMarker {
  return {
    type: 'Bug',
    severity: parseSeverity(params[0]),
    tags: parseTags(params[1]),
    description,
    rawText,
    lineNumber,
  };
}

/**
 * Parse a single line for a marker
 *
 * @param line - Line text to parse
 * @param lineNumber - Line number in source file
 * @returns Parsed marker or null if line doesn't contain a marker
 */
export function parseMarkerLine(line: string, lineNumber: number): Marker | null {
  const trimmed = line.trim();

  // Try full marker pattern first
  const fullMatch = MARKER_PATTERN.exec(trimmed);
  if (fullMatch) {
    const [, type, paramsStr, description] = fullMatch;
    const params = parseParams(paramsStr);

    switch (type as MarkerType) {
      case 'Todo':
        return parseTodoMarker(params, description, trimmed, lineNumber);
      case 'Feature':
        return parseFeatureMarker(params, description, trimmed, lineNumber);
      case 'Limitation':
        return parseLimitationMarker(params, description, trimmed, lineNumber);
      case 'Bug':
        return parseBugMarker(params, description, trimmed, lineNumber);
    }
  }

  // Try simple marker pattern (no brackets)
  const simpleMatch = SIMPLE_MARKER_PATTERN.exec(trimmed);
  if (simpleMatch) {
    const [, type, description] = simpleMatch;

    switch (type as MarkerType) {
      case 'Todo':
        return parseTodoMarker([], description, trimmed, lineNumber);
      case 'Feature':
        return parseFeatureMarker([], description, trimmed, lineNumber);
      case 'Limitation':
        return parseLimitationMarker([], description, trimmed, lineNumber);
      case 'Bug':
        return parseBugMarker([], description, trimmed, lineNumber);
    }
  }

  return null;
}

/**
 * Parse document content for all markers
 *
 * Scans each line for marker patterns and extracts structured data.
 *
 * @param content - Full document content
 * @param sourceFile - Optional source file path for error reporting
 * @returns Parse result with markers and any errors encountered
 */
export function parseMarkers(content: string, sourceFile?: string): MarkerParseResult {
  const markers: Marker[] = [];
  const errors: MarkerParseError[] = [];

  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1; // 1-indexed
    const line = lines[i];

    // Quick check: skip lines that don't start with # after trimming
    const trimmed = line.trim();
    if (!trimmed.startsWith('#')) continue;

    // Skip markdown headers (# followed by space is a header)
    if (/^#+\s/.test(trimmed)) continue;

    try {
      const marker = parseMarkerLine(line, lineNumber);
      if (marker) {
        marker.sourceFile = sourceFile;
        markers.push(marker);
      }
    } catch (e) {
      errors.push({
        lineNumber,
        rawText: trimmed,
        error: (e as Error).message,
      });
    }
  }

  return { markers, errors };
}

/**
 * Check if a marker has already been processed (has hacknplan_id)
 *
 * Markers that have been converted to HacknPlan items should have
 * their ID recorded in nearby frontmatter or inline annotation.
 *
 * @param marker - Marker to check
 * @param markerIds - Map of line numbers to HacknPlan IDs
 * @returns True if marker has been processed
 */
export function isMarkerProcessed(
  marker: Marker,
  markerIds?: Map<number, number>
): boolean {
  if (!markerIds) return false;
  return markerIds.has(marker.lineNumber);
}

/**
 * Convert marker to HacknPlan work item creation request
 *
 * Maps marker metadata to HacknPlan API fields.
 *
 * @param marker - Marker to convert
 * @param typeId - HacknPlan design element type ID
 * @returns Work item creation request object
 */
export function markerToWorkItemRequest(
  marker: Marker,
  typeId: number
): {
  typeId: number;
  name: string;
  description: string;
  metadata: Record<string, unknown>;
} {
  const metadata: Record<string, unknown> = {
    markerType: marker.type,
    sourceFile: marker.sourceFile,
    lineNumber: marker.lineNumber,
  };

  // Add type-specific metadata
  switch (marker.type) {
    case 'Todo':
      if (marker.category) metadata.category = marker.category;
      if (marker.estimate) metadata.estimate = marker.estimate;
      if (marker.tags.length > 0) metadata.tags = marker.tags;
      break;
    case 'Feature':
      if (marker.priority) metadata.priority = marker.priority;
      if (marker.milestone) metadata.milestone = marker.milestone;
      break;
    case 'Limitation':
      if (marker.severity) metadata.severity = marker.severity;
      break;
    case 'Bug':
      if (marker.severity) metadata.severity = marker.severity;
      if (marker.tags.length > 0) metadata.tags = marker.tags;
      break;
  }

  return {
    typeId,
    name: marker.description,
    description: `Created from vault marker:\n\`${marker.rawText}\`\n\nSource: ${marker.sourceFile || 'unknown'}:${marker.lineNumber}`,
    metadata,
  };
}

/**
 * Frontmatter parsing utilities for Obsidian markdown files
 *
 * Uses gray-matter for robust YAML parsing that handles:
 * - Arrays: tags: [vulkan, svo, mcp]
 * - Nested objects: config: { sync: { enabled: true } }
 * - Multi-line strings
 * - Missing or invalid frontmatter
 */

import matter from 'gray-matter';
import type { Frontmatter } from '../core/types.js';

/**
 * Extract frontmatter from markdown content
 *
 * Parses YAML-style frontmatter between --- delimiters at the start of a file.
 * Uses gray-matter for robust parsing of complex YAML structures.
 *
 * @param content - Full markdown file content
 * @returns Parsed frontmatter as key-value pairs
 *
 * @example
 * ```typescript
 * const fm = extractFrontmatter(`---
 * hacknplan_id: 123
 * title: My Document
 * tags: [vulkan, svo]
 * config:
 *   sync: true
 * ---
 * # Content here`);
 * // Returns: { hacknplan_id: 123, title: 'My Document', tags: ['vulkan', 'svo'], config: { sync: true } }
 * ```
 */
export function extractFrontmatter(content: string): Frontmatter {
  try {
    const { data } = matter(content);
    return data as Frontmatter;
  } catch (error) {
    // Handle missing or invalid frontmatter gracefully
    return {};
  }
}

/**
 * Update frontmatter in markdown content
 *
 * Merges updates into existing frontmatter and regenerates the content.
 * Preserves existing fields not in updates.
 *
 * @param content - Full markdown file content
 * @param updates - Key-value pairs to merge into frontmatter
 * @returns Updated markdown content with new frontmatter
 *
 * @example
 * ```typescript
 * const updated = updateFrontmatter(
 *   `---
 * title: My Doc
 * ---
 * # Content`,
 *   { synced_at: '2025-01-15T10:00:00Z' }
 * );
 * // Returns content with both title and synced_at in frontmatter
 * ```
 */
export function updateFrontmatter(
  content: string,
  updates: Record<string, unknown>
): string {
  try {
    const parsed = matter(content);
    const newData = { ...parsed.data, ...updates };
    return matter.stringify(parsed.content, newData);
  } catch (error) {
    // If parsing fails, create new frontmatter with updates
    const lines = ['---'];
    for (const [key, value] of Object.entries(updates)) {
      if (value !== null && value !== undefined) {
        if (typeof value === 'object') {
          lines.push(`${key}: ${JSON.stringify(value)}`);
        } else {
          lines.push(`${key}: ${value}`);
        }
      }
    }
    lines.push('---');
    lines.push('');
    lines.push(content);
    return lines.join('\n');
  }
}

/**
 * Strip frontmatter from markdown content
 *
 * @param content - Full markdown file content
 * @returns Content without frontmatter section
 */
export function stripFrontmatter(content: string): string {
  try {
    const { content: body } = matter(content);
    return body;
  } catch (error) {
    // Fallback to regex if gray-matter fails
    return content.replace(/^---\n[\s\S]*?\n---\n*/, '');
  }
}

/**
 * Generate frontmatter YAML string
 *
 * @param data - Key-value pairs to include in frontmatter
 * @returns YAML frontmatter string with delimiters
 */
export function generateFrontmatter(data: Record<string, unknown>): string {
  // Use gray-matter's stringify with empty content to generate just frontmatter
  const result = matter.stringify('', data);
  // Remove trailing content (just newlines after frontmatter)
  return result.trim();
}

/**
 * Check if content has valid frontmatter
 *
 * @param content - Markdown content to check
 * @returns true if content has parseable frontmatter
 */
export function hasFrontmatter(content: string): boolean {
  try {
    const { data } = matter(content);
    return Object.keys(data).length > 0;
  } catch {
    return false;
  }
}

/**
 * Extract tags from markdown content
 *
 * Finds hashtags like #vulkan, #render-graph in the content.
 * Only matches tags that start with a letter (not numbers or special chars).
 *
 * @param content - Markdown content to scan
 * @returns Array of unique lowercase tag names (without # prefix)
 *
 * @example
 * ```typescript
 * extractTags('This uses #vulkan and #render-graph for #vulkan')
 * // Returns: ['vulkan', 'render-graph']
 * ```
 */
export function extractTags(content: string): string[] {
  const tagPattern = /#([a-zA-Z][a-zA-Z0-9-]*)/g;
  const tags = new Set<string>();

  let match;
  while ((match = tagPattern.exec(content)) !== null) {
    tags.add(match[1].toLowerCase());
  }

  return Array.from(tags);
}

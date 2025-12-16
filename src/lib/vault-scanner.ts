/**
 * Vault scanning utilities for Obsidian vaults
 *
 * Phase 2: Async implementation with controlled concurrency
 */

import { promises as fs } from 'fs';
import { readdir, stat } from 'fs/promises';
import { join, basename } from 'path';
import pLimit from 'p-limit';
import type { VaultDocument, VaultDocumentInfo } from '../core/types.js';
import { extractFrontmatter, extractTags } from './frontmatter.js';

// Concurrency limit for parallel file reads
const FILE_READ_CONCURRENCY = 10;

/**
 * Scan a vault folder recursively for markdown files (async)
 *
 * @param folderPath - Absolute path to folder to scan
 * @returns Promise resolving to array of vault documents with content and metadata
 */
export async function scanVaultFolder(folderPath: string): Promise<VaultDocument[]> {
  const limit = pLimit(FILE_READ_CONCURRENCY);
  const filePaths: Array<{ fullPath: string; relativePath: string }> = [];

  // Phase 1: Collect all markdown file paths (async directory traversal)
  async function collectFiles(dir: string, relativePath: string = ''): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });

      const subdirPromises: Promise<void>[] = [];

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          // Skip hidden directories, recurse into others
          subdirPromises.push(collectFiles(fullPath, relPath));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          filePaths.push({ fullPath, relativePath: relPath });
        }
      }

      await Promise.all(subdirPromises);
    } catch (e) {
      // Log error but continue scanning other directories
      console.error(`[glue] Error scanning ${dir}: ${(e as Error).message}`);
    }
  }

  // Check if folder exists
  try {
    await fs.access(folderPath);
  } catch {
    return [];
  }

  // Collect all file paths
  await collectFiles(folderPath);

  // Phase 2: Read all files with controlled concurrency
  const readPromises = filePaths.map(({ fullPath, relativePath }) =>
    limit(async (): Promise<VaultDocument | null> => {
      try {
        const [fileStat, content] = await Promise.all([
          stat(fullPath),
          fs.readFile(fullPath, 'utf-8'),
        ]);

        return {
          path: fullPath,
          relativePath,
          name: basename(fullPath, '.md'),
          modified: fileStat.mtime,
          content,
          frontmatter: extractFrontmatter(content),
        };
      } catch (e) {
        console.error(`[glue] Error reading ${fullPath}: ${(e as Error).message}`);
        return null;
      }
    })
  );

  const results = await Promise.all(readPromises);

  // Filter out null results from failed reads
  return results.filter((doc): doc is VaultDocument => doc !== null);
}

/**
 * Convert vault documents to slim info objects for API responses
 *
 * @param documents - Full vault documents
 * @returns Array of slim document info
 */
export function toDocumentInfo(documents: VaultDocument[]): VaultDocumentInfo[] {
  return documents.map((d: VaultDocument) => {
    const id = d.frontmatter.hacknplan_id;
    return {
      name: d.name,
      relativePath: d.relativePath,
      modified: d.modified,
      tags: extractTags(d.content),
      hasFrontmatter: Object.keys(d.frontmatter).length > 0,
      hacknplanId: id !== undefined ? String(id) : null,
    };
  });
}

/**
 * Extract all tags from documents with usage counts
 *
 * @param documents - Vault documents to analyze
 * @returns Map of tag names to usage counts
 */
export function extractAllTags(documents: VaultDocument[]): Map<string, number> {
  const tagCounts = new Map<string, number>();

  for (const doc of documents) {
    const tags = extractTags(doc.content);
    for (const tag of tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  return tagCounts;
}

/**
 * Find a document by name in a vault (async)
 *
 * @param vaultPath - Path to vault root
 * @param documentName - Name to search for (without .md extension)
 * @returns Matching document or undefined
 */
export async function findDocument(
  vaultPath: string,
  documentName: string
): Promise<VaultDocument | undefined> {
  const documents = await scanVaultFolder(vaultPath);
  return documents.find((d) => d.name === documentName);
}

/**
 * Vault scanning and tag extraction tools
 */

import { join } from 'path';
import type { ToolDefinition } from './types.js';
import type { TagInfo, VaultDocumentInfo } from '../core/types.js';
import { scanVaultFolder, toDocumentInfo, extractAllTags } from '../lib/vault-scanner.js';

// ============ ARGUMENT INTERFACES ============

interface ScanVaultArgs {
  projectId: number;
  folder?: string;
}

interface ExtractVaultTagsArgs {
  projectId: number;
}

// ============ RESULT INTERFACES ============

interface ScanVaultResult {
  vaultPath: string;
  scannedPath: string;
  documentCount: number;
  documents: VaultDocumentInfo[];
}

interface ExtractTagsResult {
  totalDocuments: number;
  uniqueTags: number;
  tags: TagInfo[];
}

// ============ TOOL DEFINITIONS ============

/**
 * Scan vault folders for documents
 */
export const scanVault: ToolDefinition<ScanVaultArgs, ScanVaultResult> = {
  name: 'scan_vault',
  description: 'Scan vault folders and return document inventory with extracted tags',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'number', description: 'Project ID to get vault path from pairing' },
      folder: { type: 'string', description: 'Specific folder to scan (relative to vault root)' },
    },
    required: ['projectId'],
  },
  handler: async (args, ctx) => {
    const pairing = ctx.getPairing(args.projectId);
    if (!pairing) {
      throw new Error(`No pairing for project ${args.projectId}`);
    }

    const scanPath = args.folder
      ? join(pairing.vaultPath, args.folder)
      : pairing.vaultPath;

    // Await async scanVaultFolder
    const docs = await scanVaultFolder(scanPath);

    return {
      vaultPath: pairing.vaultPath,
      scannedPath: scanPath,
      documentCount: docs.length,
      documents: toDocumentInfo(docs),
    };
  },
};

/**
 * Extract all tags from vault documents
 */
export const extractVaultTags: ToolDefinition<ExtractVaultTagsArgs, ExtractTagsResult> = {
  name: 'extract_vault_tags',
  description: 'Extract all tags from vault documents for a project',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'number', description: 'Project ID' },
    },
    required: ['projectId'],
  },
  handler: async (args, ctx) => {
    const pairing = ctx.getPairing(args.projectId);
    if (!pairing) {
      throw new Error(`No pairing for project ${args.projectId}`);
    }

    // Await async scanVaultFolder
    const docs = await scanVaultFolder(pairing.vaultPath);
    const tagCounts = extractAllTags(docs);

    // Sort by count descending
    const sortedTags: TagInfo[] = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({
        tag,
        count,
        mappedTo: pairing.tagMappings?.[tag] || null,
      }));

    return {
      totalDocuments: docs.length,
      uniqueTags: sortedTags.length,
      tags: sortedTags,
    };
  },
};

/**
 * All vault tool handlers
 */
export const vaultTools: ToolDefinition[] = [scanVault, extractVaultTags];

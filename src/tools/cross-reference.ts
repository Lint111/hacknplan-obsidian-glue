/**
 * Cross-reference and work item helper tools
 */

import type { ToolDefinition } from './types.js';
import type { CrossReference, TagMappingResult } from '../core/types.js';
import { findDocument } from '../lib/vault-scanner.js';

// ============ ARGUMENT INTERFACES ============

interface GenerateCrossReferencesArgs {
  projectId: number;
  documentName: string;
  designElementId?: number;
}

interface MapTagsToHacknPlanArgs {
  projectId: number;
  vaultTags: string[];
}

interface GenerateWorkItemDescriptionArgs {
  projectId: number;
  summary: string;
  requirements?: string[];
  relatedFiles?: string[];
  vaultDocs?: string[];
  acceptanceCriteria?: string[];
}

// ============ RESULT INTERFACES ============

interface WorkItemDescriptionResult {
  description: string;
}

// ============ TOOL DEFINITIONS ============

/**
 * Generate cross-reference links between HacknPlan and vault
 */
export const generateCrossReferences: ToolDefinition<GenerateCrossReferencesArgs, CrossReference> = {
  name: 'generate_cross_references',
  description:
    'Generate cross-reference links for a document (HacknPlan links for vault, vault links for HacknPlan)',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'number', description: 'Project ID' },
      documentName: { type: 'string', description: 'Name of the document' },
      designElementId: {
        type: 'number',
        description: 'HacknPlan design element ID (if known)',
      },
    },
    required: ['projectId', 'documentName'],
  },
  handler: async (args, ctx) => {
    const pairing = ctx.getPairing(args.projectId);
    if (!pairing) {
      throw new Error(`No pairing for project ${args.projectId}`);
    }

    const hacknplanUrl = args.designElementId
      ? `https://app.hacknplan.com/p/${args.projectId}/designelements/${args.designElementId}`
      : `https://app.hacknplan.com/p/${args.projectId}/designelements`;

    // Find matching vault document (async)
    const matchingDoc = await findDocument(pairing.vaultPath, args.documentName);

    return {
      documentName: args.documentName,
      hacknplanLink: `[HacknPlan](${hacknplanUrl})`,
      hacknplanMarkdown: `**HacknPlan:** [#${args.designElementId || 'N/A'}](${hacknplanUrl})`,
      vaultLink: matchingDoc ? `[[${matchingDoc.relativePath.replace('.md', '')}]]` : null,
      vaultPath: matchingDoc?.path || null,
    };
  },
};

/**
 * Map vault tags to HacknPlan tag IDs
 */
export const mapTagsToHacknPlan: ToolDefinition<MapTagsToHacknPlanArgs, TagMappingResult> = {
  name: 'map_tags_to_hacknplan',
  description: 'Map vault document tags to HacknPlan tag IDs based on pairing configuration',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'number', description: 'Project ID' },
      vaultTags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of tag names from vault document',
      },
    },
    required: ['projectId', 'vaultTags'],
  },
  handler: async (args, ctx) => {
    const pairing = ctx.getPairing(args.projectId);
    if (!pairing) {
      throw new Error(`No pairing for project ${args.projectId}`);
    }

    const mapped: Array<{ vaultTag: string; hacknplanTagId: number }> = [];
    const unmapped: string[] = [];

    for (const tag of args.vaultTags || []) {
      const tagLower = tag.toLowerCase();
      const tagId = pairing.tagMappings?.[tagLower];

      if (tagId) {
        mapped.push({
          vaultTag: tag,
          hacknplanTagId: tagId,
        });
      } else {
        unmapped.push(tag);
      }
    }

    return {
      mapped,
      unmapped,
      hacknplanTagIds: mapped.map((m) => m.hacknplanTagId),
    };
  },
};

/**
 * Generate a properly formatted work item description
 */
export const generateWorkItemDescription: ToolDefinition<
  GenerateWorkItemDescriptionArgs,
  WorkItemDescriptionResult
> = {
  name: 'generate_work_item_description',
  description:
    'Generate a properly formatted work item description with vault cross-references',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'number', description: 'Project ID' },
      summary: { type: 'string', description: 'Task summary' },
      requirements: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of requirements',
      },
      relatedFiles: {
        type: 'array',
        items: { type: 'string' },
        description: "Related code files (e.g., 'libraries/RenderGraph/src/File.cpp:123')",
      },
      vaultDocs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Related vault documents',
      },
      acceptanceCriteria: {
        type: 'array',
        items: { type: 'string' },
        description: 'Acceptance criteria',
      },
    },
    required: ['projectId', 'summary'],
  },
  handler: async (args, ctx) => {
    const pairing = ctx.getPairing(args.projectId);

    let description = `## Summary\n${args.summary}\n`;

    if (args.requirements?.length) {
      description += `\n## Requirements\n`;
      for (const req of args.requirements) {
        description += `- [ ] ${req}\n`;
      }
    }

    if (args.relatedFiles?.length) {
      description += `\n## Related Files\n`;
      for (const file of args.relatedFiles) {
        description += `- \`${file}\`\n`;
      }
    }

    if (args.vaultDocs?.length && pairing) {
      description += `\n## Vault References\n`;
      for (const doc of args.vaultDocs) {
        description += `- \`${pairing.vaultPath}/${doc}\`\n`;
      }
    }

    if (args.acceptanceCriteria?.length) {
      description += `\n## Acceptance Criteria\n`;
      for (const criteria of args.acceptanceCriteria) {
        description += `- [ ] ${criteria}\n`;
      }
    }

    return { description };
  },
};

/**
 * All cross-reference tool handlers
 */
export const crossReferenceTools: ToolDefinition[] = [
  generateCrossReferences,
  mapTagsToHacknPlan,
  generateWorkItemDescription,
];

#!/usr/bin/env node

/**
 * HacknPlan-Obsidian Glue MCP Server
 *
 * This MCP acts as a synchronization layer between:
 * - HacknPlan MCP (project management API)
 * - Obsidian Vault MCP (documentation)
 *
 * Responsibilities:
 * - Project-vault pairing configuration
 * - Bidirectional sync between design elements and vault docs
 * - Cross-reference management
 * - Tag extraction and auto-assignment
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'fs';
import { join, basename, dirname } from 'path';

// ============ CONFIGURATION ============

const CONFIG_PATH = process.env.GLUE_CONFIG_PATH ||
  process.argv.find(arg => arg.startsWith('--config='))?.split('=')[1] ||
  join(process.cwd(), 'glue-config.json');

// ============ PROJECT-VAULT PAIRING STORAGE ============

let pairings = [];

function loadConfig() {
  try {
    if (existsSync(CONFIG_PATH)) {
      const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      pairings = config.pairings || [];
      console.error(`[glue] Loaded ${pairings.length} pairings from ${CONFIG_PATH}`);
    } else {
      console.error(`[glue] No config file at ${CONFIG_PATH}, starting fresh`);
    }
  } catch (e) {
    console.error(`[glue] Failed to load config: ${e.message}`);
  }
}

function saveConfig() {
  try {
    const dir = dirname(CONFIG_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(CONFIG_PATH, JSON.stringify({ pairings, version: "1.0.0" }, null, 2));
    console.error(`[glue] Saved config to ${CONFIG_PATH}`);
  } catch (e) {
    console.error(`[glue] Failed to save config: ${e.message}`);
  }
}

function getPairingByProject(projectId) {
  return pairings.find(p => p.projectId === projectId);
}

function getPairingByVault(vaultPath) {
  return pairings.find(p => vaultPath.startsWith(p.vaultPath));
}

// Load config on startup
loadConfig();

// ============ VAULT HELPERS ============

function scanVaultFolder(folderPath) {
  const results = [];

  function scan(dir, relativePath = '') {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          scan(fullPath, relPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const stat = statSync(fullPath);
          const content = readFileSync(fullPath, 'utf-8');
          results.push({
            path: fullPath,
            relativePath: relPath,
            name: basename(entry.name, '.md'),
            modified: stat.mtime,
            content,
            frontmatter: extractFrontmatter(content),
          });
        }
      }
    } catch (e) {
      console.error(`[glue] Error scanning ${dir}: ${e.message}`);
    }
  }

  if (existsSync(folderPath)) {
    scan(folderPath);
  }
  return results;
}

function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const frontmatter = {};
  const lines = match[1].split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      frontmatter[key] = value;
    }
  }
  return frontmatter;
}

function extractTags(content) {
  // Extract tags from content like #vulkan, #render-graph, etc.
  const tagPattern = /#([a-zA-Z][a-zA-Z0-9-]*)/g;
  const tags = new Set();
  let match;
  while ((match = tagPattern.exec(content)) !== null) {
    tags.add(match[1].toLowerCase());
  }
  return Array.from(tags);
}

function generateMarkdownFromElement(element, pairing) {
  const now = new Date().toISOString();
  return `---
hacknplan_id: ${element.designElementId}
hacknplan_type: ${element.type?.name || 'Unknown'}
hacknplan_project: ${pairing.projectId}
synced_at: ${now}
---

# ${element.name}

${element.description || ''}

---
*Synced from HacknPlan via hacknplan-obsidian-glue*
`;
}

// ============ CREATE MCP SERVER ============

const server = new Server(
  {
    name: "hacknplan-obsidian-glue",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// ============ RESOURCES ============

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: pairings.map(p => ({
      uri: `glue://pairing/${p.projectId}`,
      name: `${p.projectName} <-> ${basename(p.vaultPath)}`,
      description: `HacknPlan project ${p.projectId} synced with ${p.vaultPath}`,
      mimeType: "application/json",
    })),
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  const match = uri.match(/^glue:\/\/pairing\/(\d+)$/);
  if (match) {
    const projectId = parseInt(match[1]);
    const pairing = getPairingByProject(projectId);
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: JSON.stringify(pairing || { error: "Pairing not found" }, null, 2),
      }],
    };
  }
  throw new Error(`Unknown resource: ${uri}`);
});

// ============ TOOL DEFINITIONS ============

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // ============ PAIRING MANAGEMENT ============
      {
        name: "add_pairing",
        description: "Create a pairing between a HacknPlan project and an Obsidian vault",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "number", description: "HacknPlan project ID" },
            projectName: { type: "string", description: "Human-readable project name" },
            vaultPath: { type: "string", description: "Absolute path to Obsidian vault root" },
            folderMappings: {
              type: "object",
              description: "Map vault folders to HacknPlan design element type IDs. E.g., {'01-Architecture': 9, '03-Research': 10}",
              additionalProperties: { type: "number" }
            },
            tagMappings: {
              type: "object",
              description: "Map vault tags to HacknPlan tag IDs. E.g., {'vulkan': 1, 'render-graph': 2}",
              additionalProperties: { type: "number" }
            },
            defaultBoard: { type: "number", description: "Default board ID for new work items" },
          },
          required: ["projectId", "projectName", "vaultPath"],
        },
      },
      {
        name: "remove_pairing",
        description: "Remove a project-vault pairing",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "number", description: "HacknPlan project ID" },
          },
          required: ["projectId"],
        },
      },
      {
        name: "list_pairings",
        description: "List all configured project-vault pairings",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_pairing",
        description: "Get details of a specific pairing",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "number", description: "HacknPlan project ID" },
          },
          required: ["projectId"],
        },
      },
      {
        name: "update_pairing",
        description: "Update an existing pairing configuration",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "number", description: "HacknPlan project ID" },
            folderMappings: { type: "object", additionalProperties: { type: "number" } },
            tagMappings: { type: "object", additionalProperties: { type: "number" } },
            defaultBoard: { type: "number" },
          },
          required: ["projectId"],
        },
      },

      // ============ VAULT SCANNING ============
      {
        name: "scan_vault",
        description: "Scan vault folders and return document inventory with extracted tags",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "number", description: "Project ID to get vault path from pairing" },
            folder: { type: "string", description: "Specific folder to scan (relative to vault root)" },
          },
          required: ["projectId"],
        },
      },
      {
        name: "extract_vault_tags",
        description: "Extract all tags from vault documents for a project",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "number", description: "Project ID" },
          },
          required: ["projectId"],
        },
      },

      // ============ SYNC OPERATIONS ============
      {
        name: "sync_vault_to_hacknplan",
        description: "Sync Obsidian vault documents to HacknPlan design elements. Returns operations to perform (does not execute them directly - use HacknPlan MCP for that).",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "number", description: "Project ID" },
            dryRun: { type: "boolean", description: "If true, only report what would be synced" },
          },
          required: ["projectId"],
        },
      },
      {
        name: "sync_hacknplan_to_vault",
        description: "Generate vault file content from HacknPlan design elements. Returns file operations to perform.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "number", description: "Project ID" },
            elements: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  designElementId: { type: "number" },
                  name: { type: "string" },
                  description: { type: "string" },
                  type: { type: "object" },
                }
              },
              description: "Design elements from HacknPlan (pass result from hacknplan MCP list_design_elements)"
            },
            dryRun: { type: "boolean", description: "If true, only report what would be created" },
          },
          required: ["projectId", "elements"],
        },
      },

      // ============ CROSS-REFERENCE ============
      {
        name: "generate_cross_references",
        description: "Generate cross-reference links for a document (HacknPlan links for vault, vault links for HacknPlan)",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "number", description: "Project ID" },
            documentName: { type: "string", description: "Name of the document" },
            designElementId: { type: "number", description: "HacknPlan design element ID (if known)" },
          },
          required: ["projectId", "documentName"],
        },
      },
      {
        name: "map_tags_to_hacknplan",
        description: "Map vault document tags to HacknPlan tag IDs based on pairing configuration",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "number", description: "Project ID" },
            vaultTags: {
              type: "array",
              items: { type: "string" },
              description: "Array of tag names from vault document"
            },
          },
          required: ["projectId", "vaultTags"],
        },
      },

      // ============ WORK ITEM HELPERS ============
      {
        name: "generate_work_item_description",
        description: "Generate a properly formatted work item description with vault cross-references",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "number", description: "Project ID" },
            summary: { type: "string", description: "Task summary" },
            requirements: {
              type: "array",
              items: { type: "string" },
              description: "List of requirements"
            },
            relatedFiles: {
              type: "array",
              items: { type: "string" },
              description: "Related code files (e.g., 'libraries/RenderGraph/src/File.cpp:123')"
            },
            vaultDocs: {
              type: "array",
              items: { type: "string" },
              description: "Related vault documents"
            },
            acceptanceCriteria: {
              type: "array",
              items: { type: "string" },
              description: "Acceptance criteria"
            },
          },
          required: ["projectId", "summary"],
        },
      },
    ],
  };
});

// ============ TOOL HANDLERS ============

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {
      // ============ PAIRING MANAGEMENT ============
      case "add_pairing": {
        const pairing = {
          projectId: args.projectId,
          projectName: args.projectName,
          vaultPath: args.vaultPath,
          folderMappings: args.folderMappings || {},
          tagMappings: args.tagMappings || {},
          defaultBoard: args.defaultBoard || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        // Remove existing pairing for same project
        pairings = pairings.filter(p => p.projectId !== args.projectId);
        pairings.push(pairing);
        saveConfig();
        result = { success: true, pairing };
        break;
      }

      case "remove_pairing": {
        const before = pairings.length;
        pairings = pairings.filter(p => p.projectId !== args.projectId);
        saveConfig();
        result = { success: true, removed: before > pairings.length };
        break;
      }

      case "list_pairings":
        result = pairings;
        break;

      case "get_pairing":
        result = getPairingByProject(args.projectId) || { error: "No pairing found" };
        break;

      case "update_pairing": {
        const pairing = getPairingByProject(args.projectId);
        if (!pairing) {
          result = { error: "Pairing not found" };
        } else {
          if (args.folderMappings) pairing.folderMappings = args.folderMappings;
          if (args.tagMappings) pairing.tagMappings = args.tagMappings;
          if (args.defaultBoard !== undefined) pairing.defaultBoard = args.defaultBoard;
          pairing.updatedAt = new Date().toISOString();
          saveConfig();
          result = { success: true, pairing };
        }
        break;
      }

      // ============ VAULT SCANNING ============
      case "scan_vault": {
        const pairing = getPairingByProject(args.projectId);
        if (!pairing) throw new Error(`No pairing for project ${args.projectId}`);

        const scanPath = args.folder
          ? join(pairing.vaultPath, args.folder)
          : pairing.vaultPath;

        const docs = scanVaultFolder(scanPath);
        result = {
          vaultPath: pairing.vaultPath,
          scannedPath: scanPath,
          documentCount: docs.length,
          documents: docs.map(d => ({
            name: d.name,
            relativePath: d.relativePath,
            modified: d.modified,
            tags: extractTags(d.content),
            hasFrontmatter: Object.keys(d.frontmatter).length > 0,
            hacknplanId: d.frontmatter.hacknplan_id || null,
          })),
        };
        break;
      }

      case "extract_vault_tags": {
        const pairing = getPairingByProject(args.projectId);
        if (!pairing) throw new Error(`No pairing for project ${args.projectId}`);

        const docs = scanVaultFolder(pairing.vaultPath);
        const tagCounts = {};

        for (const doc of docs) {
          const tags = extractTags(doc.content);
          for (const tag of tags) {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
          }
        }

        // Sort by count
        const sortedTags = Object.entries(tagCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([tag, count]) => ({
            tag,
            count,
            mappedTo: pairing.tagMappings?.[tag] || null,
          }));

        result = {
          totalDocuments: docs.length,
          uniqueTags: sortedTags.length,
          tags: sortedTags,
        };
        break;
      }

      // ============ SYNC OPERATIONS ============
      case "sync_vault_to_hacknplan": {
        const pairing = getPairingByProject(args.projectId);
        if (!pairing) throw new Error(`No pairing for project ${args.projectId}`);

        const operations = { create: [], update: [], skip: [] };

        for (const [folder, typeId] of Object.entries(pairing.folderMappings)) {
          const folderPath = join(pairing.vaultPath, folder);
          const docs = scanVaultFolder(folderPath);

          for (const doc of docs) {
            const existingId = doc.frontmatter.hacknplan_id;

            if (existingId) {
              operations.update.push({
                action: 'update',
                designElementId: parseInt(existingId),
                name: doc.name,
                description: doc.content.replace(/^---[\s\S]*?---\n*/, ''), // Strip frontmatter
                sourceFile: doc.path,
              });
            } else {
              operations.create.push({
                action: 'create',
                typeId,
                name: doc.name,
                description: doc.content,
                sourceFile: doc.path,
                extractedTags: extractTags(doc.content),
              });
            }
          }
        }

        result = {
          dryRun: args.dryRun || false,
          projectId: args.projectId,
          operations,
          summary: {
            toCreate: operations.create.length,
            toUpdate: operations.update.length,
            skipped: operations.skip.length,
          },
          instructions: "Use hacknplan MCP create_design_element/update_design_element to execute these operations",
        };
        break;
      }

      case "sync_hacknplan_to_vault": {
        const pairing = getPairingByProject(args.projectId);
        if (!pairing) throw new Error(`No pairing for project ${args.projectId}`);

        const operations = { create: [], update: [], skip: [] };

        // Reverse mapping: typeId -> folder
        const typeToFolder = {};
        for (const [folder, typeId] of Object.entries(pairing.folderMappings)) {
          typeToFolder[typeId] = folder;
        }

        for (const element of args.elements || []) {
          const typeId = element.type?.designElementTypeId;
          const folder = typeToFolder[typeId];

          if (!folder) {
            operations.skip.push({
              name: element.name,
              reason: `No folder mapping for type ${typeId}`,
            });
            continue;
          }

          const filePath = join(pairing.vaultPath, folder, `${element.name}.md`);
          const content = generateMarkdownFromElement(element, pairing);
          const exists = existsSync(filePath);

          if (exists) {
            operations.update.push({
              action: 'update',
              filePath,
              content,
              elementId: element.designElementId,
            });
          } else {
            operations.create.push({
              action: 'create',
              filePath,
              content,
              elementId: element.designElementId,
            });
          }
        }

        // Execute if not dry run
        if (!args.dryRun) {
          for (const op of [...operations.create, ...operations.update]) {
            const dir = dirname(op.filePath);
            if (!existsSync(dir)) {
              mkdirSync(dir, { recursive: true });
            }
            writeFileSync(op.filePath, op.content, 'utf-8');
          }
        }

        result = {
          dryRun: args.dryRun || false,
          operations,
          summary: {
            created: operations.create.length,
            updated: operations.update.length,
            skipped: operations.skip.length,
          },
        };
        break;
      }

      // ============ CROSS-REFERENCE ============
      case "generate_cross_references": {
        const pairing = getPairingByProject(args.projectId);
        if (!pairing) throw new Error(`No pairing for project ${args.projectId}`);

        const hacknplanUrl = args.designElementId
          ? `https://app.hacknplan.com/p/${args.projectId}/designelements/${args.designElementId}`
          : `https://app.hacknplan.com/p/${args.projectId}/designelements`;

        // Find vault doc
        const docs = scanVaultFolder(pairing.vaultPath);
        const matchingDoc = docs.find(d => d.name === args.documentName);

        result = {
          documentName: args.documentName,
          hacknplanLink: `[HacknPlan](${hacknplanUrl})`,
          hacknplanMarkdown: `**HacknPlan:** [#${args.designElementId || 'N/A'}](${hacknplanUrl})`,
          vaultLink: matchingDoc ? `[[${matchingDoc.relativePath.replace('.md', '')}]]` : null,
          vaultPath: matchingDoc?.path || null,
        };
        break;
      }

      case "map_tags_to_hacknplan": {
        const pairing = getPairingByProject(args.projectId);
        if (!pairing) throw new Error(`No pairing for project ${args.projectId}`);

        const mapped = [];
        const unmapped = [];

        for (const tag of args.vaultTags || []) {
          const tagLower = tag.toLowerCase();
          if (pairing.tagMappings?.[tagLower]) {
            mapped.push({
              vaultTag: tag,
              hacknplanTagId: pairing.tagMappings[tagLower],
            });
          } else {
            unmapped.push(tag);
          }
        }

        result = {
          mapped,
          unmapped,
          hacknplanTagIds: mapped.map(m => m.hacknplanTagId),
        };
        break;
      }

      // ============ WORK ITEM HELPERS ============
      case "generate_work_item_description": {
        const pairing = getPairingByProject(args.projectId);

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

        result = { description };
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// ============ START SERVER ============

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[glue] HacknPlan-Obsidian Glue MCP v1.0.0 running");
  console.error(`[glue] Config: ${CONFIG_PATH}`);
  console.error(`[glue] Pairings: ${pairings.length}`);
}

main().catch((error) => {
  console.error("[glue] Fatal error:", error);
  process.exit(1);
});

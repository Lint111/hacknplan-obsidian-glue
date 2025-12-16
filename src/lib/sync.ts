/**
 * Sync utilities for bidirectional HacknPlan-Obsidian synchronization
 */

import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type {
  Pairing,
  VaultDocument,
  DesignElement,
  VaultToHacknPlanOps,
  HacknPlanToVaultOps,
  CreateOperation,
  UpdateOperation,
  FileOperation,
  SkipOperation,
} from '../core/types.js';
import { stripFrontmatter, extractTags } from './frontmatter.js';
import { scanVaultFolder } from './vault-scanner.js';

/**
 * Generate sync operations from vault to HacknPlan
 *
 * Scans mapped folders and generates create/update operations for design elements.
 * Does NOT execute the operations - returns them for the caller to execute via HacknPlan API.
 *
 * @param pairing - Project-vault pairing config
 * @returns Operations to create/update design elements
 */
export async function generateVaultToHacknPlanOps(pairing: Pairing): Promise<VaultToHacknPlanOps> {
  const operations: VaultToHacknPlanOps = {
    create: [],
    update: [],
    skip: [],
  };

  for (const [folder, typeId] of Object.entries(pairing.folderMappings)) {
    const folderPath = join(pairing.vaultPath, folder);
    const docs = await scanVaultFolder(folderPath);

    for (const doc of docs) {
      const existingId = doc.frontmatter.hacknplan_id;

      if (existingId !== undefined) {
        // Document already linked - generate update operation
        const updateOp: UpdateOperation = {
          action: 'update',
          designElementId: typeof existingId === 'number' ? existingId : parseInt(existingId, 10),
          name: doc.name,
          description: stripFrontmatter(doc.content),
          sourceFile: doc.path,
        };
        operations.update.push(updateOp);
      } else {
        // New document - generate create operation
        const createOp: CreateOperation = {
          action: 'create',
          typeId,
          name: doc.name,
          description: doc.content,
          sourceFile: doc.path,
          extractedTags: extractTags(doc.content),
        };
        operations.create.push(createOp);
      }
    }
  }

  return operations;
}

/**
 * Generate markdown content from a HacknPlan design element
 *
 * @param element - Design element data
 * @param pairing - Pairing config for cross-references
 * @returns Markdown content with frontmatter
 */
export function generateMarkdownFromElement(element: DesignElement, pairing: Pairing): string {
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

/**
 * Generate sync operations from HacknPlan to vault
 *
 * Takes design elements and generates file create/update operations.
 *
 * @param pairing - Project-vault pairing config
 * @param elements - Design elements from HacknPlan
 * @returns File operations to create/update
 */
export function generateHacknPlanToVaultOps(
  pairing: Pairing,
  elements: DesignElement[]
): HacknPlanToVaultOps {
  const operations: HacknPlanToVaultOps = {
    create: [],
    update: [],
    skip: [],
  };

  // Build reverse mapping: typeId -> folder
  const typeToFolder: Record<number, string> = {};
  for (const [folder, typeId] of Object.entries(pairing.folderMappings)) {
    typeToFolder[typeId] = folder;
  }

  for (const element of elements) {
    const typeId = element.type?.designElementTypeId;

    if (!typeId) {
      operations.skip.push({
        name: element.name,
        reason: 'No type information',
      });
      continue;
    }

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

    const op: FileOperation = {
      action: exists ? 'update' : 'create',
      filePath,
      content,
      elementId: element.designElementId,
    };

    if (exists) {
      operations.update.push(op);
    } else {
      operations.create.push(op);
    }
  }

  return operations;
}

/**
 * Execute file operations (write files to vault)
 *
 * @param operations - File operations to execute
 */
export function executeFileOperations(operations: HacknPlanToVaultOps): void {
  const allOps = [...operations.create, ...operations.update];

  for (const op of allOps) {
    const dir = dirname(op.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(op.filePath, op.content, 'utf-8');
    console.error(`[glue] Wrote: ${op.filePath}`);
  }
}

/**
 * Jest tests for Vault Scanner
 */

// Mock p-limit to avoid ESM issues in Jest
jest.mock('p-limit', () => ({
  __esModule: true,
  default: jest.fn(() => (fn: any) => fn())
}));

import { scanVaultFolder, toDocumentInfo, extractAllTags } from '../vault-scanner.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

describe('scanVaultFolder', () => {
  let testVault: string;

  beforeEach(async () => {
    testVault = path.join(os.tmpdir(), `vault-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testVault, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testVault, { recursive: true, force: true }).catch(() => {});
  });

  test('scans empty vault', async () => {
    const docs = await scanVaultFolder(testVault);
    expect(docs.length).toBe(0);
  });

  test('finds markdown files in root', async () => {
    await fs.writeFile(path.join(testVault, 'test1.md'), '# Test 1');
    await fs.writeFile(path.join(testVault, 'test2.md'), '# Test 2');

    const docs = await scanVaultFolder(testVault);
    expect(docs.length).toBe(2);
    expect(docs.map(d => d.name).sort()).toEqual(['test1', 'test2']);
  });

  test('recursively scans subdirectories', async () => {
    await fs.mkdir(path.join(testVault, 'folder1'), { recursive: true });
    await fs.mkdir(path.join(testVault, 'folder2'), { recursive: true });

    await fs.writeFile(path.join(testVault, 'root.md'), '# Root');
    await fs.writeFile(path.join(testVault, 'folder1', 'sub1.md'), '# Sub1');
    await fs.writeFile(path.join(testVault, 'folder2', 'sub2.md'), '# Sub2');

    const docs = await scanVaultFolder(testVault);
    expect(docs.length).toBe(3);
  });

  test('skips hidden directories', async () => {
    await fs.mkdir(path.join(testVault, '.obsidian'), { recursive: true });
    await fs.mkdir(path.join(testVault, '.git'), { recursive: true });

    await fs.writeFile(path.join(testVault, 'visible.md'), '# Visible');
    await fs.writeFile(path.join(testVault, '.obsidian', 'hidden.md'), '# Hidden');
    await fs.writeFile(path.join(testVault, '.git', 'also-hidden.md'), '# Hidden');

    const docs = await scanVaultFolder(testVault);
    expect(docs.length).toBe(1);
    expect(docs[0].name).toBe('visible');
  });

  test('ignores non-markdown files', async () => {
    await fs.writeFile(path.join(testVault, 'doc.md'), '# Markdown');
    await fs.writeFile(path.join(testVault, 'image.png'), 'fake image data');
    await fs.writeFile(path.join(testVault, 'text.txt'), 'text file');

    const docs = await scanVaultFolder(testVault);
    expect(docs.length).toBe(1);
    expect(docs[0].name).toBe('doc');
  });

  test('extracts frontmatter from files', async () => {
    const content = `---
title: Test Document
hacknplan_id: 123
tags: [vulkan, test]
---
# Content`;

    await fs.writeFile(path.join(testVault, 'with-fm.md'), content);

    const docs = await scanVaultFolder(testVault);
    expect(docs.length).toBe(1);
    expect(docs[0].frontmatter.title).toBe('Test Document');
    expect(docs[0].frontmatter.hacknplan_id).toBe(123);
    expect(docs[0].frontmatter.tags).toEqual(['vulkan', 'test']);
  });

  test('stores file path information', async () => {
    await fs.mkdir(path.join(testVault, 'Architecture'), { recursive: true });
    await fs.writeFile(path.join(testVault, 'Architecture', 'System.md'), '# System');

    const docs = await scanVaultFolder(testVault);
    expect(docs.length).toBe(1);
    expect(docs[0].name).toBe('System');
    expect(docs[0].relativePath).toContain('Architecture');
  });

  test('includes full content', async () => {
    const content = '# Test\n\nFull content here.';
    await fs.writeFile(path.join(testVault, 'test.md'), content);

    const docs = await scanVaultFolder(testVault);
    expect(docs.length).toBe(1);
    expect(docs[0].content).toBe(content);
  });

  test('handles deeply nested folders', async () => {
    const deepPath = path.join(testVault, 'a', 'b', 'c', 'd');
    await fs.mkdir(deepPath, { recursive: true });
    await fs.writeFile(path.join(deepPath, 'deep.md'), '# Deep');

    const docs = await scanVaultFolder(testVault);
    expect(docs.length).toBe(1);
    expect(docs[0].name).toBe('deep');
  });

  test('includes modification time', async () => {
    await fs.writeFile(path.join(testVault, 'test.md'), '# Test');

    const docs = await scanVaultFolder(testVault);
    expect(docs.length).toBe(1);
    expect(typeof docs[0].modified).toBe('object'); // Date object
  });
});

describe('toDocumentInfo', () => {
  test('converts documents to info objects', () => {
    const docs = [
      {
        path: '/vault/test.md',
        relativePath: 'test.md',
        name: 'test.md',
        modified: new Date(),
        content: '# Test content',
        frontmatter: { hacknplan_id: 123 }
      }
    ];

    const infos = toDocumentInfo(docs);
    expect(infos.length).toBe(1);
    expect(infos[0].name).toBe('test.md');
    expect(infos[0].hacknplanId).toBe('123');
  });

  test('handles docs without hacknplan_id', () => {
    const docs = [
      {
        path: '/vault/test.md',
        relativePath: 'test.md',
        name: 'test.md',
        modified: new Date(),
        content: '# Test',
        frontmatter: {}
      }
    ];

    const infos = toDocumentInfo(docs);
    expect(infos.length).toBe(1);
    expect(infos[0].hacknplanId).toBeNull();
  });

  test('detects frontmatter presence', () => {
    const docs = [
      {
        path: '/vault/with-fm.md',
        relativePath: 'with-fm.md',
        name: 'with-fm.md',
        modified: new Date(),
        content: '---\ntitle: Test\n---\n# Content',
        frontmatter: { title: 'Test' }
      },
      {
        path: '/vault/without-fm.md',
        relativePath: 'without-fm.md',
        name: 'without-fm.md',
        modified: new Date(),
        content: '# Just content',
        frontmatter: {}
      }
    ];

    const infos = toDocumentInfo(docs);
    expect(infos[0].hasFrontmatter).toBe(true);
    expect(infos[1].hasFrontmatter).toBe(false);
  });
});

describe('extractAllTags', () => {
  test('extracts tags from multiple documents', () => {
    const docs = [
      {
        path: '/vault/doc1.md',
        relativePath: 'doc1.md',
        name: 'doc1.md',
        modified: new Date(),
        content: 'Uses #vulkan and #rendering',
        frontmatter: {}
      },
      {
        path: '/vault/doc2.md',
        relativePath: 'doc2.md',
        name: 'doc2.md',
        modified: new Date(),
        content: 'Also #vulkan and #mcp',
        frontmatter: {}
      }
    ];

    const tagMap = extractAllTags(docs);
    expect(tagMap.get('vulkan')).toBe(2);
    expect(tagMap.get('rendering')).toBe(1);
    expect(tagMap.get('mcp')).toBe(1);
  });

  test('handles documents with no tags', () => {
    const docs = [
      {
        path: '/vault/doc.md',
        relativePath: 'doc.md',
        name: 'doc.md',
        modified: new Date(),
        content: 'No tags here',
        frontmatter: {}
      }
    ];

    const tagMap = extractAllTags(docs);
    expect(tagMap.size).toBe(0);
  });
});

describe('error handling', () => {
  test('handles missing vault directory gracefully', async () => {
    const nonExistent = path.join(os.tmpdir(), 'does-not-exist-12345');
    // Function handles missing dirs gracefully, returns empty array
    const docs = await scanVaultFolder(nonExistent);
    expect(docs.length).toBe(0);
  });
});

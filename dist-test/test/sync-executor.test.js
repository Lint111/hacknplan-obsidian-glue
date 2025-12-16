/**
 * Test sync executor functions
 *
 * This test verifies Phase 5 functionality:
 * - Frontmatter updates
 * - Sync execution flow
 */
import { promises as fs } from 'fs';
import path from 'path';
import { updateVaultFileFrontmatter, revertVaultFile } from '../src/lib/sync-executor.js';
import { extractFrontmatter } from '../src/lib/frontmatter.js';
const TEST_DIR = path.join(process.cwd(), 'test', 'fixtures');
async function ensureTestDir() {
    try {
        await fs.mkdir(TEST_DIR, { recursive: true });
    }
    catch {
        // Directory exists
    }
}
async function cleanupTestFile(filePath) {
    try {
        await fs.unlink(filePath);
    }
    catch {
        // File doesn't exist
    }
}
async function testFrontmatterUpdate() {
    await ensureTestDir();
    const testFile = path.join(TEST_DIR, 'test-frontmatter.md');
    // Create test file
    const originalContent = `---
title: Test Document
tags: [test, example]
---

# Test Content

This is test content.
`;
    await fs.writeFile(testFile, originalContent, 'utf-8');
    try {
        // Test frontmatter update
        const savedOriginal = await updateVaultFileFrontmatter(testFile, {
            hacknplan_id: 123,
            hacknplan_project: 456,
            synced_at: '2025-01-15T10:00:00.000Z',
        });
        // Verify original was returned
        if (savedOriginal !== originalContent) {
            throw new Error('Original content not preserved correctly');
        }
        // Verify updated content
        const updatedContent = await fs.readFile(testFile, 'utf-8');
        const frontmatter = extractFrontmatter(updatedContent);
        if (frontmatter.hacknplan_id !== 123) {
            throw new Error(`Expected hacknplan_id 123, got ${frontmatter.hacknplan_id}`);
        }
        if (frontmatter.hacknplan_project !== 456) {
            throw new Error(`Expected hacknplan_project 456, got ${frontmatter.hacknplan_project}`);
        }
        if (frontmatter.title !== 'Test Document') {
            throw new Error('Original title was not preserved');
        }
        console.log('PASS: Frontmatter update works correctly');
        // Test revert
        await revertVaultFile(testFile, originalContent);
        const revertedContent = await fs.readFile(testFile, 'utf-8');
        if (revertedContent !== originalContent) {
            throw new Error('Revert did not restore original content');
        }
        console.log('PASS: Frontmatter revert works correctly');
    }
    finally {
        await cleanupTestFile(testFile);
    }
}
async function testSyncExecutionResultType() {
    // Types don't exist at runtime - just verify the module can be imported
    await import('../src/core/types.js');
    // We can't check a type at runtime, but we can verify the import works
    console.log('PASS: types module is importable');
}
async function testHacknPlanClient() {
    const { HacknPlanClient } = await import('../src/core/client.js');
    // Test client instantiation
    const client = new HacknPlanClient('test-api-key');
    // Verify client has expected methods
    if (typeof client.createDesignElement !== 'function') {
        throw new Error('Missing createDesignElement method');
    }
    if (typeof client.updateDesignElement !== 'function') {
        throw new Error('Missing updateDesignElement method');
    }
    if (typeof client.getDesignElement !== 'function') {
        throw new Error('Missing getDesignElement method');
    }
    if (typeof client.deleteDesignElement !== 'function') {
        throw new Error('Missing deleteDesignElement method');
    }
    console.log('PASS: HacknPlanClient has all expected methods');
}
async function main() {
    console.log('=== Phase 5: Sync Executor Tests ===\n');
    try {
        await testFrontmatterUpdate();
        await testSyncExecutionResultType();
        await testHacknPlanClient();
        console.log('\n=== All tests passed ===');
        process.exit(0);
    }
    catch (error) {
        console.error('\n=== Test failed ===');
        console.error(error);
        process.exit(1);
    }
}
main();

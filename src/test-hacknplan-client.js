#!/usr/bin/env node

/**
 * Test script for HacknPlan HTTP Client
 *
 * Tests the client against project 230955 (HacknPlan-Obsidian Glue MCP).
 *
 * Usage:
 *   HACKNPLAN_API_KEY=your-key node src/test-hacknplan-client.js
 */

import HacknPlanClient, { createClientFromEnv, HacknPlanAPIError } from './hacknplan-client.js';

const TEST_PROJECT_ID = 230955;

async function runTests() {
  console.log('=== HacknPlan Client Test Suite ===\n');

  // Check for API key
  if (!process.env.HACKNPLAN_API_KEY) {
    console.error('ERROR: HACKNPLAN_API_KEY environment variable not set');
    console.error('Usage: HACKNPLAN_API_KEY=your-key node src/test-hacknplan-client.js');
    process.exit(1);
  }

  const client = createClientFromEnv();
  let testElementId = null;
  let passed = 0;
  let failed = 0;

  // Helper function
  function test(name, fn) {
    return { name, fn };
  }

  const tests = [
    // Test 1: Get project details
    test('Get project details', async () => {
      const project = await client.getProject(TEST_PROJECT_ID);
      // API returns id, not projectId
      console.log(`  Project: ${project.name} (ID: ${project.id || project.projectId})`);
      if (!project.name) {
        throw new Error('Missing project name field');
      }
    }),

    // Test 2: List design element types
    test('List design element types', async () => {
      const types = await client.listDesignElementTypes(TEST_PROJECT_ID);
      console.log(`  Found ${types.items?.length || types.length || 0} design element types`);
      const typeList = types.items || types;
      if (typeList.length > 0) {
        console.log(`  First type: ${typeList[0].name} (ID: ${typeList[0].designElementTypeId})`);
      }
    }),

    // Test 3: List existing design elements
    test('List design elements', async () => {
      const elements = await client.listDesignElements(TEST_PROJECT_ID, null, 0, 10);
      const elementList = elements.items || elements;
      console.log(`  Found ${elementList.length} design elements (first page)`);
      if (elementList.length > 0) {
        console.log(`  Example: ${elementList[0].name}`);
      }
    }),

    // Test 4: Create a test design element
    test('Create design element', async () => {
      // First, get design element types to find a valid typeId
      const types = await client.listDesignElementTypes(TEST_PROJECT_ID);
      const typeList = types.items || types;
      if (typeList.length === 0) {
        throw new Error('No design element types available');
      }
      const testTypeId = typeList[0].designElementTypeId;

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const testName = `Test Element ${timestamp}`;
      const testDescription = `This is a test design element created by hacknplan-client.js at ${timestamp}.\n\nThis element will be deleted after testing.`;

      const created = await client.createDesignElement(
        TEST_PROJECT_ID,
        testTypeId,
        testName,
        testDescription
      );

      testElementId = created.designElementId;
      console.log(`  Created: ${created.name} (ID: ${created.designElementId})`);

      if (!created.designElementId || !created.name) {
        throw new Error('Missing created element fields');
      }
    }),

    // Test 5: Get the created design element
    test('Get design element by ID', async () => {
      if (!testElementId) {
        throw new Error('No test element ID - create test must have failed');
      }

      const element = await client.getDesignElement(TEST_PROJECT_ID, testElementId);
      console.log(`  Retrieved: ${element.name}`);

      if (element.designElementId !== testElementId) {
        throw new Error('Retrieved element ID does not match');
      }
    }),

    // Test 6: Update the design element
    test('Update design element', async () => {
      if (!testElementId) {
        throw new Error('No test element ID');
      }

      const updated = await client.updateDesignElement(TEST_PROJECT_ID, testElementId, {
        description: 'Updated description via API test.',
      });

      console.log(`  Updated element description`);

      // Verify the update
      const element = await client.getDesignElement(TEST_PROJECT_ID, testElementId);
      if (!element.description.includes('Updated description')) {
        throw new Error('Update did not apply correctly');
      }
    }),

    // Test 7: Delete the test design element
    test('Delete design element', async () => {
      if (!testElementId) {
        throw new Error('No test element ID');
      }

      await client.deleteDesignElement(TEST_PROJECT_ID, testElementId);
      console.log(`  Deleted element ID: ${testElementId}`);

      // Verify deletion - should get 404
      try {
        await client.getDesignElement(TEST_PROJECT_ID, testElementId);
        throw new Error('Element still exists after deletion');
      } catch (error) {
        if (error instanceof HacknPlanAPIError && error.status === 404) {
          console.log(`  Verified: Element no longer exists (404)`);
        } else {
          throw error;
        }
      }

      testElementId = null; // Clear so cleanup doesn't try again
    }),

    // Test 8: List tags
    test('List tags', async () => {
      const tags = await client.listTags(TEST_PROJECT_ID);
      const tagList = tags.items || tags;
      console.log(`  Found ${tagList.length} tags`);
      if (tagList.length > 0) {
        console.log(`  First tag: ${tagList[0].name} (ID: ${tagList[0].tagId})`);
      }
    }),

    // Test 9: Error handling - 404
    test('Error handling - 404 Not Found', async () => {
      try {
        await client.getDesignElement(TEST_PROJECT_ID, 99999999);
        throw new Error('Should have thrown 404 error');
      } catch (error) {
        if (error instanceof HacknPlanAPIError && error.status === 404) {
          console.log(`  Correctly caught 404 error`);
        } else {
          throw error;
        }
      }
    }),

    // Test 10: Error handling - invalid API key
    test('Error handling - 401 Unauthorized', async () => {
      const badClient = new HacknPlanClient('invalid-api-key');
      try {
        await badClient.getProject(TEST_PROJECT_ID);
        throw new Error('Should have thrown 401 error');
      } catch (error) {
        if (error instanceof HacknPlanAPIError && error.status === 401) {
          console.log(`  Correctly caught 401 error`);
        } else if (error instanceof HacknPlanAPIError && error.status === 403) {
          // Some APIs return 403 for invalid key
          console.log(`  Correctly caught 403 error (forbidden)`);
        } else {
          throw error;
        }
      }
    }),
  ];

  // Run tests
  for (const { name, fn } of tests) {
    try {
      console.log(`\n[TEST] ${name}`);
      await fn();
      console.log(`  [PASS]`);
      passed++;
    } catch (error) {
      console.log(`  [FAIL] ${error.message}`);
      if (error.status) {
        console.log(`  Status: ${error.status}`);
      }
      failed++;
    }
  }

  // Cleanup: ensure test element is deleted
  if (testElementId) {
    console.log(`\n[CLEANUP] Deleting leftover test element ${testElementId}`);
    try {
      await client.deleteDesignElement(TEST_PROJECT_ID, testElementId);
      console.log('  Cleaned up');
    } catch (e) {
      console.log(`  Cleanup failed: ${e.message}`);
    }
  }

  // Summary
  console.log('\n=== Test Summary ===');
  console.log(`Passed: ${passed}/${tests.length}`);
  console.log(`Failed: ${failed}/${tests.length}`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

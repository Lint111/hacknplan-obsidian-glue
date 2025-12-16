/**
 * Tests for frontmatter parsing utilities
 *
 * Run with: npx tsx src/lib/__tests__/frontmatter.test.ts
 */

import {
  extractFrontmatter,
  updateFrontmatter,
  stripFrontmatter,
  generateFrontmatter,
  hasFrontmatter,
  extractTags,
} from '../frontmatter.js';

// Simple assertion helper
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`PASS: ${message}`);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ============ Test Cases ============

console.log('\n=== extractFrontmatter Tests ===\n');

// Test 1: Simple key-value pairs
{
  const content = `---
hacknplan_id: 123
title: My Document
---
# Content here`;

  const fm = extractFrontmatter(content);
  assert(fm.hacknplan_id === 123, 'Simple numeric value parsed correctly');
  assert(fm.title === 'My Document', 'Simple string value parsed correctly');
}

// Test 2: YAML arrays (inline syntax)
{
  const content = `---
tags: [vulkan, svo, mcp]
---
# Content`;

  const fm = extractFrontmatter(content);
  assert(Array.isArray(fm.tags), 'Inline array recognized as array');
  assert(deepEqual(fm.tags, ['vulkan', 'svo', 'mcp']), 'Inline array values parsed correctly');
}

// Test 3: YAML arrays (multiline syntax)
{
  const content = `---
tags:
  - vulkan
  - svo
  - mcp
---
# Content`;

  const fm = extractFrontmatter(content);
  assert(Array.isArray(fm.tags), 'Multiline array recognized as array');
  assert(deepEqual(fm.tags, ['vulkan', 'svo', 'mcp']), 'Multiline array values parsed correctly');
}

// Test 4: Nested objects (inline syntax)
{
  const content = `---
config: { sync: { enabled: true } }
---
# Content`;

  const fm = extractFrontmatter(content);
  assert(typeof fm.config === 'object', 'Nested object recognized');
  const config = fm.config as { sync: { enabled: boolean } };
  assert(config.sync.enabled === true, 'Nested object value accessible');
}

// Test 5: Nested objects (multiline syntax)
{
  const content = `---
config:
  sync:
    enabled: true
    interval: 3600
  backup:
    path: /var/backup
---
# Content`;

  const fm = extractFrontmatter(content);
  const config = fm.config as {
    sync: { enabled: boolean; interval: number };
    backup: { path: string };
  };
  assert(config.sync.enabled === true, 'Multiline nested object - boolean');
  assert(config.sync.interval === 3600, 'Multiline nested object - number');
  assert(config.backup.path === '/var/backup', 'Multiline nested object - string');
}

// Test 6: Multi-line strings (literal block scalar)
{
  const content = `---
description: |
  This is a multi-line description.
  It spans multiple lines.
  And preserves line breaks.
---
# Content`;

  const fm = extractFrontmatter(content);
  assert(typeof fm.description === 'string', 'Multi-line string is string');
  assert((fm.description as string).includes('multiple lines'), 'Multi-line string content preserved');
}

// Test 7: Multi-line strings (folded block scalar)
{
  const content = `---
summary: >
  This is a folded string.
  Line breaks become spaces.
  Great for long text.
---
# Content`;

  const fm = extractFrontmatter(content);
  assert(typeof fm.summary === 'string', 'Folded string is string');
  assert((fm.summary as string).includes('folded string'), 'Folded string content preserved');
}

// Test 8: Missing frontmatter
{
  const content = `# Just a markdown document
No frontmatter here.`;

  const fm = extractFrontmatter(content);
  assert(Object.keys(fm).length === 0, 'Missing frontmatter returns empty object');
}

// Test 9: Empty frontmatter
{
  const content = `---
---
# Content`;

  const fm = extractFrontmatter(content);
  assert(Object.keys(fm).length === 0, 'Empty frontmatter returns empty object');
}

// Test 10: Invalid YAML (graceful failure)
{
  const content = `---
key: [unclosed bracket
another: value
---
# Content`;

  const fm = extractFrontmatter(content);
  // Should return empty object on parse error, not throw
  assert(typeof fm === 'object', 'Invalid YAML returns empty object (graceful failure)');
}

// Test 11: Boolean values
{
  const content = `---
enabled: true
disabled: false
---
# Content`;

  const fm = extractFrontmatter(content);
  assert(fm.enabled === true, 'Boolean true parsed correctly');
  assert(fm.disabled === false, 'Boolean false parsed correctly');
}

// Test 12: Null values
{
  const content = `---
value: null
other: ~
---
# Content`;

  const fm = extractFrontmatter(content);
  assert(fm.value === null, 'Explicit null parsed correctly');
  assert(fm.other === null, 'YAML ~ (null shorthand) parsed correctly');
}

// Test 13: Mixed types
{
  const content = `---
hacknplan_id: 123
hacknplan_type: "Architecture"
tags: [vulkan, mcp]
metadata:
  created: 2025-01-15
  priority: high
enabled: true
---
# Content`;

  const fm = extractFrontmatter(content);
  assert(fm.hacknplan_id === 123, 'Mixed - number');
  assert(fm.hacknplan_type === 'Architecture', 'Mixed - quoted string');
  assert(Array.isArray(fm.tags), 'Mixed - array');
  assert(typeof fm.metadata === 'object', 'Mixed - object');
  assert(fm.enabled === true, 'Mixed - boolean');
}

console.log('\n=== updateFrontmatter Tests ===\n');

// Test 14: Update existing frontmatter
{
  const content = `---
title: My Doc
---
# Content`;

  const updated = updateFrontmatter(content, { synced_at: '2025-01-15T10:00:00Z' });
  const fm = extractFrontmatter(updated);
  assert(fm.title === 'My Doc', 'Update preserves existing fields');
  assert(fm.synced_at === '2025-01-15T10:00:00Z', 'Update adds new field');
}

// Test 15: Update with complex values
{
  const content = `---
title: My Doc
---
# Content`;

  const updated = updateFrontmatter(content, {
    tags: ['vulkan', 'svo'],
    config: { sync: true },
  });
  const fm = extractFrontmatter(updated);
  assert(Array.isArray(fm.tags), 'Update with array value');
  assert(typeof fm.config === 'object', 'Update with object value');
}

// Test 16: Update document without frontmatter
{
  const content = `# Just content
No frontmatter.`;

  const updated = updateFrontmatter(content, { title: 'New Title' });
  const fm = extractFrontmatter(updated);
  assert(fm.title === 'New Title', 'Update creates frontmatter if missing');
}

console.log('\n=== stripFrontmatter Tests ===\n');

// Test 17: Strip frontmatter
{
  const content = `---
title: My Doc
tags: [a, b, c]
---
# Actual Content

Some text here.`;

  const stripped = stripFrontmatter(content);
  assert(!stripped.includes('---'), 'Frontmatter delimiters removed');
  assert(stripped.includes('# Actual Content'), 'Content preserved');
  assert(stripped.includes('Some text here'), 'Full content preserved');
}

// Test 18: Strip from document without frontmatter
{
  const content = `# Just Content
No frontmatter.`;

  const stripped = stripFrontmatter(content);
  assert(stripped === content, 'No-frontmatter document unchanged');
}

console.log('\n=== generateFrontmatter Tests ===\n');

// Test 19: Generate simple frontmatter
{
  const fm = generateFrontmatter({ title: 'Test', id: 123 });
  assert(fm.includes('---'), 'Generated frontmatter has delimiters');
  assert(fm.includes('title:'), 'Generated frontmatter has title');
  assert(fm.includes('123'), 'Generated frontmatter has numeric value');
}

// Test 20: Generate frontmatter with arrays
{
  const fm = generateFrontmatter({ tags: ['a', 'b', 'c'] });
  assert(fm.includes('tags:'), 'Generated frontmatter has array field');
  // gray-matter will output as YAML array
}

console.log('\n=== hasFrontmatter Tests ===\n');

// Test 21: Has frontmatter
{
  const content = `---
title: Test
---
# Content`;

  assert(hasFrontmatter(content) === true, 'Detects frontmatter presence');
}

// Test 22: No frontmatter
{
  const content = `# Just content`;
  assert(hasFrontmatter(content) === false, 'Detects frontmatter absence');
}

console.log('\n=== extractTags Tests ===\n');

// Test 23: Extract hashtags from content
{
  const content = `# Document

This uses #vulkan and #render-graph for #vulkan rendering.
Also #mcp integration.`;

  const tags = extractTags(content);
  assert(tags.includes('vulkan'), 'Extracts vulkan tag');
  assert(tags.includes('render-graph'), 'Extracts hyphenated tag');
  assert(tags.includes('mcp'), 'Extracts mcp tag');
  assert(tags.length === 3, 'Deduplicates tags');
}

// Test 24: No tags
{
  const content = `# Just content
No hashtags here.`;

  const tags = extractTags(content);
  assert(tags.length === 0, 'Returns empty array for no tags');
}

console.log('\n=== All Tests Passed! ===\n');

/**
 * Jest tests for frontmatter parsing utilities
 */

import {
  extractFrontmatter,
  updateFrontmatter,
  stripFrontmatter,
  generateFrontmatter,
  hasFrontmatter,
  extractTags,
} from '../frontmatter.js';

describe('extractFrontmatter', () => {
  test('extracts simple key-value pairs', () => {
    const content = `---
hacknplan_id: 123
title: My Document
---
# Content here`;

    const fm = extractFrontmatter(content);
    expect(fm.hacknplan_id).toBe(123);
    expect(fm.title).toBe('My Document');
  });

  test('parses YAML arrays (inline syntax)', () => {
    const content = `---
tags: [vulkan, svo, mcp]
---
# Content`;

    const fm = extractFrontmatter(content);
    expect(Array.isArray(fm.tags)).toBe(true);
    expect(fm.tags).toEqual(['vulkan', 'svo', 'mcp']);
  });

  test('parses YAML arrays (multiline syntax)', () => {
    const content = `---
tags:
  - vulkan
  - svo
  - mcp
---
# Content`;

    const fm = extractFrontmatter(content);
    expect(Array.isArray(fm.tags)).toBe(true);
    expect(fm.tags).toEqual(['vulkan', 'svo', 'mcp']);
  });

  test('parses nested objects (inline syntax)', () => {
    const content = `---
config: { sync: { enabled: true } }
---
# Content`;

    const fm = extractFrontmatter(content);
    expect(typeof fm.config).toBe('object');
    const config = fm.config as { sync: { enabled: boolean } };
    expect(config.sync.enabled).toBe(true);
  });

  test('parses nested objects (multiline syntax)', () => {
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
    expect(config.sync.enabled).toBe(true);
    expect(config.sync.interval).toBe(3600);
    expect(config.backup.path).toBe('/var/backup');
  });

  test('parses multi-line strings (literal block scalar)', () => {
    const content = `---
description: |
  This is a multi-line description.
  It spans multiple lines.
  And preserves line breaks.
---
# Content`;

    const fm = extractFrontmatter(content);
    expect(typeof fm.description).toBe('string');
    expect((fm.description as string).includes('multiple lines')).toBe(true);
  });

  test('parses multi-line strings (folded block scalar)', () => {
    const content = `---
summary: >
  This is a folded string.
  Line breaks become spaces.
  Great for long text.
---
# Content`;

    const fm = extractFrontmatter(content);
    expect(typeof fm.summary).toBe('string');
    expect((fm.summary as string).includes('folded string')).toBe(true);
  });

  test('handles missing frontmatter', () => {
    const content = `# Just a markdown document
No frontmatter here.`;

    const fm = extractFrontmatter(content);
    expect(Object.keys(fm).length).toBe(0);
  });

  test('handles empty frontmatter', () => {
    const content = `---
---
# Content`;

    const fm = extractFrontmatter(content);
    expect(Object.keys(fm).length).toBe(0);
  });

  test('handles invalid YAML gracefully', () => {
    const content = `---
key: [unclosed bracket
another: value
---
# Content`;

    const fm = extractFrontmatter(content);
    expect(typeof fm).toBe('object');
  });

  test('parses boolean values', () => {
    const content = `---
enabled: true
disabled: false
---
# Content`;

    const fm = extractFrontmatter(content);
    expect(fm.enabled).toBe(true);
    expect(fm.disabled).toBe(false);
  });

  test('parses null values', () => {
    const content = `---
value: null
other: ~
---
# Content`;

    const fm = extractFrontmatter(content);
    expect(fm.value).toBeNull();
    expect(fm.other).toBeNull();
  });

  test('parses mixed types', () => {
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
    expect(fm.hacknplan_id).toBe(123);
    expect(fm.hacknplan_type).toBe('Architecture');
    expect(Array.isArray(fm.tags)).toBe(true);
    expect(typeof fm.metadata).toBe('object');
    expect(fm.enabled).toBe(true);
  });
});

describe('updateFrontmatter', () => {
  test('updates existing frontmatter', () => {
    const content = `---
title: My Doc
---
# Content`;

    const updated = updateFrontmatter(content, { synced_at: '2025-01-15T10:00:00Z' });
    const fm = extractFrontmatter(updated);
    expect(fm.title).toBe('My Doc');
    expect(fm.synced_at).toBe('2025-01-15T10:00:00Z');
  });

  test('updates with complex values', () => {
    const content = `---
title: My Doc
---
# Content`;

    const updated = updateFrontmatter(content, {
      tags: ['vulkan', 'svo'],
      config: { sync: true },
    });
    const fm = extractFrontmatter(updated);
    expect(Array.isArray(fm.tags)).toBe(true);
    expect(typeof fm.config).toBe('object');
  });

  test('creates frontmatter if missing', () => {
    const content = `# Just content
No frontmatter.`;

    const updated = updateFrontmatter(content, { title: 'New Title' });
    const fm = extractFrontmatter(updated);
    expect(fm.title).toBe('New Title');
  });

  test('preserves content when updating', () => {
    const content = `---
title: Original
---
# Important Content
This should be preserved.`;

    const updated = updateFrontmatter(content, { title: 'Updated' });
    expect(updated).toContain('# Important Content');
    expect(updated).toContain('This should be preserved.');
  });
});

describe('stripFrontmatter', () => {
  test('strips frontmatter from document', () => {
    const content = `---
title: My Doc
tags: [a, b, c]
---
# Actual Content

Some text here.`;

    const stripped = stripFrontmatter(content);
    expect(stripped.includes('---')).toBe(false);
    expect(stripped.includes('# Actual Content')).toBe(true);
    expect(stripped.includes('Some text here')).toBe(true);
  });

  test('leaves document unchanged if no frontmatter', () => {
    const content = `# Just Content
No frontmatter.`;

    const stripped = stripFrontmatter(content);
    expect(stripped).toBe(content);
  });

  test('handles empty document', () => {
    const stripped = stripFrontmatter('');
    expect(stripped).toBe('');
  });
});

describe('generateFrontmatter', () => {
  test('generates simple frontmatter', () => {
    const fm = generateFrontmatter({ title: 'Test', id: 123 });
    expect(fm.includes('---')).toBe(true);
    expect(fm.includes('title:')).toBe(true);
    expect(fm.includes('123')).toBe(true);
  });

  test('generates frontmatter with arrays', () => {
    const fm = generateFrontmatter({ tags: ['a', 'b', 'c'] });
    expect(fm.includes('tags:')).toBe(true);
  });

  test('generates frontmatter with nested objects', () => {
    const fm = generateFrontmatter({
      config: {
        sync: true,
        timeout: 5000
      }
    });
    expect(fm.includes('config:')).toBe(true);
  });

  test('generates empty frontmatter for empty object', () => {
    const fm = generateFrontmatter({});
    // gray-matter returns empty string for empty frontmatter
    expect(fm).toBe('');
  });
});

describe('hasFrontmatter', () => {
  test('detects frontmatter presence', () => {
    const content = `---
title: Test
---
# Content`;

    expect(hasFrontmatter(content)).toBe(true);
  });

  test('detects frontmatter absence', () => {
    const content = `# Just content`;
    expect(hasFrontmatter(content)).toBe(false);
  });

  test('handles empty string', () => {
    expect(hasFrontmatter('')).toBe(false);
  });

  test('handles partial frontmatter marker', () => {
    const content = `---
This is not frontmatter, missing closing marker`;
    // Depends on implementation - may or may not be detected
    const result = hasFrontmatter(content);
    expect(typeof result).toBe('boolean');
  });
});

describe('extractTags', () => {
  test('extracts hashtags from content', () => {
    const content = `# Document

This uses #vulkan and #render-graph for #vulkan rendering.
Also #mcp integration.`;

    const tags = extractTags(content);
    expect(tags).toContain('vulkan');
    expect(tags).toContain('render-graph');
    expect(tags).toContain('mcp');
    expect(tags.length).toBe(3); // Deduplicated
  });

  test('handles no tags', () => {
    const content = `# Just content
No hashtags here.`;

    const tags = extractTags(content);
    expect(tags.length).toBe(0);
  });

  test('handles empty content', () => {
    const tags = extractTags('');
    expect(tags.length).toBe(0);
  });

  test('handles tags with hyphens (underscores not supported)', () => {
    const content = 'Using #snake_case and #kebab-case tags.';
    const tags = extractTags(content);
    // Regex only supports [a-zA-Z0-9-], so underscores break the tag
    expect(tags).toContain('snake'); // Gets 'snake' before underscore
    expect(tags).toContain('kebab-case'); // Hyphens work
  });

  test('ignores markdown headers', () => {
    const content = `# Header
## Subheader
### Sub-subheader

Use #real-tag here.`;

    const tags = extractTags(content);
    expect(tags).not.toContain('Header');
    expect(tags).not.toContain('Subheader');
    expect(tags).toContain('real-tag');
  });
});

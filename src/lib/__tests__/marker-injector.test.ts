/**
 * Jest tests for Marker Injector
 *
 * Tests all functions for injecting and managing HTML comment markers
 * in vault documents for HacknPlan sync status tracking.
 */

import {
  formatMarker,
  parseMarker,
  injectMarker,
  injectMarkerIntoFile,
  scanContentForMarkers,
  scanFileForMarkers,
  scanFilesForMarkers,
  removeMarker,
  removeMarkerFromFile,
  removeAllMarkersOfType,
  createNeedsReviewMarker,
  createOutOfSyncMarker,
  createCompletedMarker,
  findRelatedVaultDocs,
  type VaultMarker,
  type MarkerType,
} from '../marker-injector.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

describe('formatMarker', () => {
  test('formats NeedsReview marker', () => {
    const marker: VaultMarker = {
      type: 'NeedsReview',
      hacknplanId: 123,
      date: '2025-01-15',
      reason: 'Task completed',
    };

    const result = formatMarker(marker);
    expect(result).toBe('<!-- #NeedsReview[HP-123|2025-01-15]: Task completed -->');
  });

  test('formats OutOfSync marker', () => {
    const marker: VaultMarker = {
      type: 'OutOfSync',
      hacknplanId: 456,
      date: '2025-01-16',
      reason: 'Doc may be stale',
    };

    const result = formatMarker(marker);
    expect(result).toBe('<!-- #OutOfSync[HP-456|2025-01-16]: Doc may be stale -->');
  });

  test('formats Completed marker', () => {
    const marker: VaultMarker = {
      type: 'Completed',
      hacknplanId: 789,
      date: '2025-01-17',
      reason: 'Feature implementation done',
    };

    const result = formatMarker(marker);
    expect(result).toBe('<!-- #Completed[HP-789|2025-01-17]: Feature implementation done -->');
  });

  test('handles special characters in reason', () => {
    const marker: VaultMarker = {
      type: 'NeedsReview',
      hacknplanId: 100,
      date: '2025-01-15',
      reason: 'Task with "quotes" and <brackets>',
    };

    const result = formatMarker(marker);
    expect(result).toContain('Task with "quotes" and <brackets>');
  });
});

describe('parseMarker', () => {
  test('parses NeedsReview marker', () => {
    const result = parseMarker('<!-- #NeedsReview[HP-123|2025-01-15]: Task completed -->');

    expect(result).not.toBeNull();
    expect(result?.type).toBe('NeedsReview');
    expect(result?.hacknplanId).toBe(123);
    expect(result?.date).toBe('2025-01-15');
    expect(result?.reason).toBe('Task completed');
  });

  test('parses OutOfSync marker', () => {
    const result = parseMarker('<!-- #OutOfSync[HP-456|2025-01-16]: Doc may be stale -->');

    expect(result).not.toBeNull();
    expect(result?.type).toBe('OutOfSync');
    expect(result?.hacknplanId).toBe(456);
  });

  test('parses Completed marker', () => {
    const result = parseMarker('<!-- #Completed[HP-789|2025-01-17]: Done -->');

    expect(result).not.toBeNull();
    expect(result?.type).toBe('Completed');
    expect(result?.hacknplanId).toBe(789);
  });

  test('returns null for non-marker comment', () => {
    const result = parseMarker('<!-- Regular HTML comment -->');
    expect(result).toBeNull();
  });

  test('returns null for invalid marker format', () => {
    const result = parseMarker('<!-- #Invalid[HP-123]: Something -->');
    expect(result).toBeNull();
  });

  test('returns null for empty string', () => {
    const result = parseMarker('');
    expect(result).toBeNull();
  });

  test('handles whitespace variations', () => {
    const result = parseMarker('<!--  #NeedsReview[HP-123|2025-01-15]:  Task completed  -->');
    expect(result).not.toBeNull();
    expect(result?.hacknplanId).toBe(123);
  });
});

describe('injectMarker', () => {
  const testMarker: VaultMarker = {
    type: 'NeedsReview',
    hacknplanId: 123,
    date: '2025-01-15',
    reason: 'Task completed',
  };

  describe('after-frontmatter position (default)', () => {
    test('injects after YAML frontmatter', () => {
      const content = `---
title: Test Doc
tags: [test]
---

# Heading

Content here.`;

      const result = injectMarker(content, testMarker);

      expect(result).toContain('<!-- #NeedsReview[HP-123|2025-01-15]: Task completed -->');
      // Marker should be between frontmatter and content
      const markerIndex = result.indexOf('<!-- #NeedsReview');
      const headingIndex = result.indexOf('# Heading');
      expect(markerIndex).toBeLessThan(headingIndex);
    });

    test('injects at beginning when no frontmatter', () => {
      const content = `# Heading

Content here.`;

      const result = injectMarker(content, testMarker);

      expect(result.startsWith('<!-- #NeedsReview')).toBe(true);
    });

    test('handles empty frontmatter', () => {
      const content = `---
---

# Heading`;

      const result = injectMarker(content, testMarker);
      expect(result).toContain('<!-- #NeedsReview');
    });
  });

  describe('end-of-file position', () => {
    test('injects at end of file', () => {
      const content = `---
title: Test
---

# Heading

Content here.`;

      const result = injectMarker(content, testMarker, { position: 'end-of-file' });

      expect(result.trimEnd().endsWith('Task completed -->')).toBe(true);
    });

    test('handles trailing whitespace', () => {
      const content = `Content here.

`;

      const result = injectMarker(content, testMarker, { position: 'end-of-file' });

      // Should not have excessive newlines
      expect(result).not.toContain('\n\n\n\n');
    });

    test('adds newline before marker at end', () => {
      const content = 'Content without trailing newline';

      const result = injectMarker(content, testMarker, { position: 'end-of-file' });

      expect(result).toContain('\n\n<!-- #NeedsReview');
    });
  });

  describe('edge cases', () => {
    test('handles content with only frontmatter', () => {
      const content = `---
title: Just frontmatter
---`;

      const result = injectMarker(content, testMarker);
      expect(result).toContain('<!-- #NeedsReview');
    });

    test('handles empty content', () => {
      const result = injectMarker('', testMarker);
      expect(result).toContain('<!-- #NeedsReview');
    });

    test('handles malformed frontmatter gracefully', () => {
      const content = `---
unclosed frontmatter
# Heading`;

      // Should not throw
      const result = injectMarker(content, testMarker);
      expect(result).toContain('<!-- #NeedsReview');
    });
  });
});

describe('scanContentForMarkers', () => {
  test('finds single marker', () => {
    const content = `# Document

<!-- #NeedsReview[HP-123|2025-01-15]: Task completed -->

Some content.`;

    const markers = scanContentForMarkers(content);

    expect(markers.length).toBe(1);
    expect(markers[0].type).toBe('NeedsReview');
    expect(markers[0].hacknplanId).toBe(123);
  });

  test('finds multiple markers', () => {
    const content = `# Document

<!-- #NeedsReview[HP-123|2025-01-15]: First task -->

Some content.

<!-- #OutOfSync[HP-456|2025-01-16]: Doc stale -->

More content.

<!-- #Completed[HP-789|2025-01-17]: Done -->`;

    const markers = scanContentForMarkers(content);

    expect(markers.length).toBe(3);
    expect(markers[0].type).toBe('NeedsReview');
    expect(markers[1].type).toBe('OutOfSync');
    expect(markers[2].type).toBe('Completed');
  });

  test('ignores regular HTML comments', () => {
    const content = `# Document

<!-- This is a regular comment -->

<!-- #NeedsReview[HP-123|2025-01-15]: Actual marker -->

<!-- Another regular comment -->`;

    const markers = scanContentForMarkers(content);

    expect(markers.length).toBe(1);
    expect(markers[0].hacknplanId).toBe(123);
  });

  test('returns empty array when no markers found', () => {
    const content = `# Document

Just regular content here.

<!-- Regular HTML comment -->`;

    const markers = scanContentForMarkers(content);
    expect(markers).toEqual([]);
  });

  test('handles empty content', () => {
    const markers = scanContentForMarkers('');
    expect(markers).toEqual([]);
  });

  test('finds markers on same line', () => {
    const content =
      '<!-- #NeedsReview[HP-1|2025-01-15]: A --> <!-- #OutOfSync[HP-2|2025-01-15]: B -->';

    const markers = scanContentForMarkers(content);
    expect(markers.length).toBe(2);
  });
});

describe('removeMarker', () => {
  describe('by ID (all types)', () => {
    test('removes all markers for a HacknPlan ID', () => {
      const content = `# Document

<!-- #NeedsReview[HP-123|2025-01-15]: Review needed -->

<!-- #OutOfSync[HP-123|2025-01-16]: Out of sync -->

Other content.`;

      const result = removeMarker(content, 123);

      expect(result).not.toContain('HP-123');
      expect(result).toContain('Other content');
    });

    test('preserves markers for other IDs', () => {
      const content = `<!-- #NeedsReview[HP-123|2025-01-15]: First -->
<!-- #NeedsReview[HP-456|2025-01-15]: Second -->`;

      const result = removeMarker(content, 123);

      expect(result).not.toContain('HP-123');
      expect(result).toContain('HP-456');
    });
  });

  describe('by type', () => {
    test('removes specific marker type', () => {
      const content = `<!-- #NeedsReview[HP-123|2025-01-15]: Review -->
<!-- #OutOfSync[HP-123|2025-01-16]: Sync -->`;

      const result = removeMarker(content, 123, 'NeedsReview');

      expect(result).not.toContain('NeedsReview');
      expect(result).toContain('OutOfSync');
    });

    test('does not remove other types for same ID', () => {
      const content = `<!-- #NeedsReview[HP-123|2025-01-15]: Review -->
<!-- #Completed[HP-123|2025-01-17]: Done -->`;

      const result = removeMarker(content, 123, 'NeedsReview');

      expect(result).not.toContain('NeedsReview');
      expect(result).toContain('Completed');
    });
  });

  test('cleans up extra newlines', () => {
    const content = `Content before.


<!-- #NeedsReview[HP-123|2025-01-15]: Marker -->


Content after.`;

    const result = removeMarker(content, 123);

    // Should not have more than 2 consecutive newlines
    expect(result).not.toContain('\n\n\n');
  });

  test('handles no matching markers', () => {
    const content = `# Document

<!-- #NeedsReview[HP-456|2025-01-15]: Other ID -->

Content.`;

    const result = removeMarker(content, 123);

    expect(result).toContain('HP-456');
  });
});

describe('removeAllMarkersOfType', () => {
  test('removes all NeedsReview markers', () => {
    const content = `<!-- #NeedsReview[HP-1|2025-01-15]: First -->
<!-- #NeedsReview[HP-2|2025-01-15]: Second -->
<!-- #OutOfSync[HP-3|2025-01-15]: Keep this -->`;

    const result = removeAllMarkersOfType(content, 'NeedsReview');

    expect(result).not.toContain('NeedsReview');
    expect(result).toContain('OutOfSync');
  });

  test('removes all OutOfSync markers', () => {
    const content = `<!-- #OutOfSync[HP-1|2025-01-15]: First -->
<!-- #OutOfSync[HP-2|2025-01-15]: Second -->
<!-- #NeedsReview[HP-3|2025-01-15]: Keep this -->`;

    const result = removeAllMarkersOfType(content, 'OutOfSync');

    expect(result).not.toContain('OutOfSync');
    expect(result).toContain('NeedsReview');
  });

  test('removes all Completed markers', () => {
    const content = `<!-- #Completed[HP-1|2025-01-15]: First -->
<!-- #Completed[HP-2|2025-01-15]: Second -->`;

    const result = removeAllMarkersOfType(content, 'Completed');

    expect(result).not.toContain('Completed');
  });

  test('handles empty content', () => {
    const result = removeAllMarkersOfType('', 'NeedsReview');
    expect(result).toBe('\n');
  });
});

describe('createNeedsReviewMarker', () => {
  test('creates marker with current date', () => {
    const marker = createNeedsReviewMarker(123, 'Task completed');

    expect(marker.type).toBe('NeedsReview');
    expect(marker.hacknplanId).toBe(123);
    expect(marker.reason).toBe('Task completed');
    // Date should be in YYYY-MM-DD format
    expect(marker.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('accepts custom reason', () => {
    const marker = createNeedsReviewMarker(456, 'Moved to In Review');
    expect(marker.reason).toBe('Moved to In Review');
  });
});

describe('createOutOfSyncMarker', () => {
  test('creates marker with default reason', () => {
    const marker = createOutOfSyncMarker(123);

    expect(marker.type).toBe('OutOfSync');
    expect(marker.hacknplanId).toBe(123);
    expect(marker.reason).toBe('Doc may be stale');
  });

  test('creates marker with custom reason', () => {
    const marker = createOutOfSyncMarker(456, 'HacknPlan item updated');

    expect(marker.reason).toBe('HacknPlan item updated');
  });
});

describe('createCompletedMarker', () => {
  test('creates marker with title as reason', () => {
    const marker = createCompletedMarker(123, 'Implement feature X');

    expect(marker.type).toBe('Completed');
    expect(marker.hacknplanId).toBe(123);
    expect(marker.reason).toBe('Implement feature X');
  });
});

describe('findRelatedVaultDocs', () => {
  test('returns file path when sync state entry exists', () => {
    const mockGetter = (id: number) => {
      if (id === 123) {
        return { filePath: 'path/to/doc.md' };
      }
      return undefined;
    };

    const result = findRelatedVaultDocs(123, mockGetter);

    expect(result).toEqual(['path/to/doc.md']);
  });

  test('returns empty array when no sync state entry', () => {
    const mockGetter = () => undefined;

    const result = findRelatedVaultDocs(123, mockGetter);

    expect(result).toEqual([]);
  });

  test('returns empty array for non-matching ID', () => {
    const mockGetter = (id: number) => {
      if (id === 456) {
        return { filePath: 'path/to/other.md' };
      }
      return undefined;
    };

    const result = findRelatedVaultDocs(123, mockGetter);

    expect(result).toEqual([]);
  });
});

// ============ FILE I/O TESTS ============

describe('injectMarkerIntoFile', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `marker-inject-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  test('injects marker into file and persists', async () => {
    const filePath = path.join(testDir, 'test.md');
    const originalContent = `---
title: Test Doc
---

# Content`;

    await fs.writeFile(filePath, originalContent);

    const marker: VaultMarker = {
      type: 'NeedsReview',
      hacknplanId: 123,
      date: '2025-01-15',
      reason: 'Task completed',
    };

    await injectMarkerIntoFile(filePath, marker);

    const result = await fs.readFile(filePath, 'utf-8');
    expect(result).toContain('<!-- #NeedsReview[HP-123|2025-01-15]: Task completed -->');
  });

  test('injects at end of file with option', async () => {
    const filePath = path.join(testDir, 'test.md');
    await fs.writeFile(filePath, '# Start\n\nContent here.');

    const marker: VaultMarker = {
      type: 'Completed',
      hacknplanId: 456,
      date: '2025-01-16',
      reason: 'Done',
    };

    await injectMarkerIntoFile(filePath, marker, { position: 'end-of-file' });

    const result = await fs.readFile(filePath, 'utf-8');
    expect(result.trimEnd().endsWith('Done -->')).toBe(true);
  });

  test('atomic write leaves no temp files', async () => {
    const filePath = path.join(testDir, 'atomic.md');
    await fs.writeFile(filePath, '# Test');

    const marker: VaultMarker = {
      type: 'NeedsReview',
      hacknplanId: 789,
      date: '2025-01-17',
      reason: 'Review',
    };

    await injectMarkerIntoFile(filePath, marker);

    const files = await fs.readdir(testDir);
    expect(files).toEqual(['atomic.md']);
    expect(files).not.toContain('atomic.md.tmp');
  });
});

describe('scanFileForMarkers', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `marker-scan-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  test('returns file path and markers found', async () => {
    const filePath = path.join(testDir, 'with-markers.md');
    const content = `# Doc

<!-- #NeedsReview[HP-123|2025-01-15]: Review this -->

Some content.

<!-- #Completed[HP-456|2025-01-16]: Done -->`;

    await fs.writeFile(filePath, content);

    const result = await scanFileForMarkers(filePath);

    expect(result.filePath).toBe(filePath);
    expect(result.markers.length).toBe(2);
    expect(result.markers[0].hacknplanId).toBe(123);
    expect(result.markers[1].hacknplanId).toBe(456);
  });

  test('returns empty markers array for file without markers', async () => {
    const filePath = path.join(testDir, 'no-markers.md');
    await fs.writeFile(filePath, '# Regular content\n\nNo markers here.');

    const result = await scanFileForMarkers(filePath);

    expect(result.filePath).toBe(filePath);
    expect(result.markers).toEqual([]);
  });
});

describe('scanFilesForMarkers', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `marker-multi-scan-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  test('scans multiple files and returns only files with markers', async () => {
    const file1 = path.join(testDir, 'has-marker.md');
    const file2 = path.join(testDir, 'no-marker.md');
    const file3 = path.join(testDir, 'also-has-marker.md');

    await fs.writeFile(file1, '<!-- #NeedsReview[HP-1|2025-01-15]: A -->');
    await fs.writeFile(file2, 'No markers here');
    await fs.writeFile(file3, '<!-- #Completed[HP-2|2025-01-16]: B -->');

    const results = await scanFilesForMarkers([file1, file2, file3]);

    expect(results.length).toBe(2);
    expect(results.map((r) => r.filePath)).toContain(file1);
    expect(results.map((r) => r.filePath)).toContain(file3);
    expect(results.map((r) => r.filePath)).not.toContain(file2);
  });

  test('skips files that cannot be read', async () => {
    const existingFile = path.join(testDir, 'exists.md');
    const nonExistentFile = path.join(testDir, 'does-not-exist.md');

    await fs.writeFile(existingFile, '<!-- #NeedsReview[HP-1|2025-01-15]: A -->');

    // Should not throw, should skip the non-existent file
    const results = await scanFilesForMarkers([existingFile, nonExistentFile]);

    expect(results.length).toBe(1);
    expect(results[0].filePath).toBe(existingFile);
  });

  test('returns empty array when all files have no markers', async () => {
    const file1 = path.join(testDir, 'plain1.md');
    const file2 = path.join(testDir, 'plain2.md');

    await fs.writeFile(file1, 'Plain content 1');
    await fs.writeFile(file2, 'Plain content 2');

    const results = await scanFilesForMarkers([file1, file2]);

    expect(results).toEqual([]);
  });
});

describe('removeMarkerFromFile', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `marker-remove-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  test('removes marker and returns true when found', async () => {
    const filePath = path.join(testDir, 'removable.md');
    const content = `# Doc

<!-- #NeedsReview[HP-123|2025-01-15]: Remove me -->

Content.`;

    await fs.writeFile(filePath, content);

    const removed = await removeMarkerFromFile(filePath, 123);

    expect(removed).toBe(true);

    const result = await fs.readFile(filePath, 'utf-8');
    expect(result).not.toContain('HP-123');
    expect(result).toContain('Content');
  });

  test('returns false when marker not found', async () => {
    const filePath = path.join(testDir, 'no-match.md');
    await fs.writeFile(filePath, '<!-- #NeedsReview[HP-456|2025-01-15]: Different ID -->');

    const removed = await removeMarkerFromFile(filePath, 123);

    expect(removed).toBe(false);
  });

  test('removes only specified marker type when provided', async () => {
    const filePath = path.join(testDir, 'multi-type.md');
    const content = `<!-- #NeedsReview[HP-123|2025-01-15]: Review -->
<!-- #OutOfSync[HP-123|2025-01-16]: Sync -->`;

    await fs.writeFile(filePath, content);

    const removed = await removeMarkerFromFile(filePath, 123, 'NeedsReview');

    expect(removed).toBe(true);

    const result = await fs.readFile(filePath, 'utf-8');
    expect(result).not.toContain('NeedsReview');
    expect(result).toContain('OutOfSync');
  });

  test('atomic write leaves no temp files after removal', async () => {
    const filePath = path.join(testDir, 'atomic-remove.md');
    await fs.writeFile(filePath, '<!-- #NeedsReview[HP-999|2025-01-15]: Test -->');

    await removeMarkerFromFile(filePath, 999);

    const files = await fs.readdir(testDir);
    expect(files).toEqual(['atomic-remove.md']);
  });
});

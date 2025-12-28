/**
 * Jest tests for Marker Parser
 *
 * Tests all parsing functions for vault markers:
 * - #Todo[category|estimate|tags]: Description
 * - #Feature[priority|milestone]: Description
 * - #Limitation[severity]: Description
 * - #Bug[severity|tags]: Description
 */

import {
  parseEstimate,
  parsePriority,
  parseSeverity,
  parseTags,
  parseMarkerLine,
  parseMarkers,
  isMarkerProcessed,
  markerToWorkItemRequest,
  type Marker,
  type TodoMarker,
  type FeatureMarker,
  type LimitationMarker,
  type BugMarker,
  type Priority,
  type Severity,
} from '../marker-parser.js';

describe('parseEstimate', () => {
  describe('short formats', () => {
    test('parses hours format (2h)', () => {
      expect(parseEstimate('2h')).toBe('2h');
    });

    test('parses minutes format (30m)', () => {
      expect(parseEstimate('30m')).toBe('30m');
    });

    test('parses days format (1d)', () => {
      expect(parseEstimate('1d')).toBe('1d');
    });

    test('parses decimal hours (1.5h)', () => {
      expect(parseEstimate('1.5h')).toBe('1.5h');
    });

    test('handles whitespace around short format', () => {
      expect(parseEstimate('  2h  ')).toBe('2h');
    });
  });

  describe('long formats', () => {
    test('parses singular hour (1 hour)', () => {
      expect(parseEstimate('1 hour')).toBe('1h');
    });

    test('parses plural hours (2 hours)', () => {
      expect(parseEstimate('2 hours')).toBe('2h');
    });

    test('parses singular minute (1 minute)', () => {
      expect(parseEstimate('1 minute')).toBe('1m');
    });

    test('parses plural minutes (30 minutes)', () => {
      expect(parseEstimate('30 minutes')).toBe('30m');
    });

    test('parses singular day (1 day)', () => {
      expect(parseEstimate('1 day')).toBe('1d');
    });

    test('parses plural days (3 days)', () => {
      expect(parseEstimate('3 days')).toBe('3d');
    });

    test('handles decimal in long format (1.5 hours)', () => {
      expect(parseEstimate('1.5 hours')).toBe('1.5h');
    });
  });

  describe('edge cases', () => {
    test('returns undefined for empty string', () => {
      expect(parseEstimate('')).toBeUndefined();
    });

    test('returns undefined for undefined input', () => {
      expect(parseEstimate(undefined)).toBeUndefined();
    });

    test('returns undefined for whitespace-only', () => {
      expect(parseEstimate('   ')).toBeUndefined();
    });

    test('returns unrecognized format as-is', () => {
      expect(parseEstimate('two hours')).toBe('two hours');
    });

    test('handles case insensitivity', () => {
      expect(parseEstimate('2H')).toBe('2h');
      expect(parseEstimate('2 HOURS')).toBe('2h');
    });
  });
});

describe('parsePriority', () => {
  describe('valid priorities', () => {
    test('parses low', () => {
      expect(parsePriority('low')).toBe('low');
    });

    test('parses medium', () => {
      expect(parsePriority('medium')).toBe('medium');
    });

    test('parses high', () => {
      expect(parsePriority('high')).toBe('high');
    });

    test('parses critical', () => {
      expect(parsePriority('critical')).toBe('critical');
    });
  });

  describe('aliases', () => {
    test('parses lo as low', () => {
      expect(parsePriority('lo')).toBe('low');
    });

    test('parses med as medium', () => {
      expect(parsePriority('med')).toBe('medium');
    });

    test('parses hi as high', () => {
      expect(parsePriority('hi')).toBe('high');
    });

    test('parses crit as critical', () => {
      expect(parsePriority('crit')).toBe('critical');
    });
  });

  describe('normalization', () => {
    test('handles uppercase', () => {
      expect(parsePriority('HIGH')).toBe('high');
    });

    test('handles mixed case', () => {
      expect(parsePriority('MeDiUm')).toBe('medium');
    });

    test('trims whitespace', () => {
      expect(parsePriority('  high  ')).toBe('high');
    });
  });

  describe('edge cases', () => {
    test('returns undefined for empty string', () => {
      expect(parsePriority('')).toBeUndefined();
    });

    test('returns undefined for undefined input', () => {
      expect(parsePriority(undefined)).toBeUndefined();
    });

    test('returns undefined for invalid priority', () => {
      expect(parsePriority('urgent')).toBeUndefined();
    });
  });
});

describe('parseSeverity', () => {
  describe('valid severities', () => {
    test('parses info', () => {
      expect(parseSeverity('info')).toBe('info');
    });

    test('parses known', () => {
      expect(parseSeverity('known')).toBe('known');
    });

    test('parses minor', () => {
      expect(parseSeverity('minor')).toBe('minor');
    });

    test('parses major', () => {
      expect(parseSeverity('major')).toBe('major');
    });

    test('parses critical', () => {
      expect(parseSeverity('critical')).toBe('critical');
    });
  });

  describe('normalization', () => {
    test('handles uppercase', () => {
      expect(parseSeverity('MAJOR')).toBe('major');
    });

    test('handles mixed case', () => {
      expect(parseSeverity('Minor')).toBe('minor');
    });

    test('trims whitespace', () => {
      expect(parseSeverity('  critical  ')).toBe('critical');
    });
  });

  describe('edge cases', () => {
    test('returns undefined for empty string', () => {
      expect(parseSeverity('')).toBeUndefined();
    });

    test('returns undefined for undefined input', () => {
      expect(parseSeverity(undefined)).toBeUndefined();
    });

    test('returns undefined for invalid severity', () => {
      expect(parseSeverity('severe')).toBeUndefined();
    });
  });
});

describe('parseTags', () => {
  test('parses single tag', () => {
    expect(parseTags('feature')).toEqual(['feature']);
  });

  test('parses multiple comma-separated tags', () => {
    expect(parseTags('feature,bug,regression')).toEqual(['feature', 'bug', 'regression']);
  });

  test('trims whitespace from tags', () => {
    expect(parseTags('feature , bug , regression')).toEqual(['feature', 'bug', 'regression']);
  });

  test('normalizes tags to lowercase', () => {
    expect(parseTags('Feature,BUG,Regression')).toEqual(['feature', 'bug', 'regression']);
  });

  test('filters empty tags', () => {
    expect(parseTags('feature,,bug,,')).toEqual(['feature', 'bug']);
  });

  test('returns empty array for empty string', () => {
    expect(parseTags('')).toEqual([]);
  });

  test('returns empty array for undefined input', () => {
    expect(parseTags(undefined)).toEqual([]);
  });

  test('handles whitespace-only tags', () => {
    expect(parseTags('feature,   ,bug')).toEqual(['feature', 'bug']);
  });
});

describe('parseMarkerLine', () => {
  describe('Todo markers', () => {
    test('parses full Todo marker', () => {
      const result = parseMarkerLine('#Todo[programming|2h|feature,api]: Implement sync', 1);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('Todo');

      const todo = result as TodoMarker;
      expect(todo.category).toBe('programming');
      expect(todo.estimate).toBe('2h');
      expect(todo.tags).toEqual(['feature', 'api']);
      expect(todo.description).toBe('Implement sync');
      expect(todo.lineNumber).toBe(1);
    });

    test('parses Todo with partial parameters', () => {
      const result = parseMarkerLine('#Todo[programming|]: Basic task', 5) as TodoMarker;
      expect(result?.category).toBe('programming');
      expect(result?.estimate).toBeUndefined();
      expect(result?.tags).toEqual([]);
    });

    test('parses Todo with empty brackets', () => {
      const result = parseMarkerLine('#Todo[]: Simple task', 1) as TodoMarker;
      expect(result?.category).toBeUndefined();
      expect(result?.estimate).toBeUndefined();
      expect(result?.tags).toEqual([]);
    });
  });

  describe('Feature markers', () => {
    test('parses full Feature marker', () => {
      const result = parseMarkerLine('#Feature[high|v2.0]: Real-time collab', 1);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('Feature');

      const feature = result as FeatureMarker;
      expect(feature.priority).toBe('high');
      expect(feature.milestone).toBe('v2.0');
      expect(feature.description).toBe('Real-time collab');
    });

    test('parses Feature with priority alias', () => {
      const result = parseMarkerLine('#Feature[hi|]: High priority feature', 1) as FeatureMarker;
      expect(result?.priority).toBe('high');
    });

    test('parses Feature with only milestone', () => {
      const result = parseMarkerLine('#Feature[|beta]: Beta feature', 1) as FeatureMarker;
      expect(result?.priority).toBeUndefined();
      expect(result?.milestone).toBe('beta');
    });
  });

  describe('Limitation markers', () => {
    test('parses full Limitation marker', () => {
      const result = parseMarkerLine('#Limitation[known]: Full vault sync on every change', 1);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('Limitation');

      const limitation = result as LimitationMarker;
      expect(limitation.severity).toBe('known');
      expect(limitation.description).toBe('Full vault sync on every change');
    });

    test('parses Limitation with empty severity', () => {
      const result = parseMarkerLine('#Limitation[]: No severity specified', 1) as LimitationMarker;
      expect(result?.severity).toBeUndefined();
    });
  });

  describe('Bug markers', () => {
    test('parses full Bug marker', () => {
      const result = parseMarkerLine('#Bug[critical|regression,ui]: Sync fails on large files', 1);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('Bug');

      const bug = result as BugMarker;
      expect(bug.severity).toBe('critical');
      expect(bug.tags).toEqual(['regression', 'ui']);
      expect(bug.description).toBe('Sync fails on large files');
    });

    test('parses Bug with only severity', () => {
      const result = parseMarkerLine('#Bug[minor|]: Minor UI glitch', 1) as BugMarker;
      expect(result?.severity).toBe('minor');
      expect(result?.tags).toEqual([]);
    });
  });

  describe('simple syntax (no brackets)', () => {
    test('parses simple Todo', () => {
      const result = parseMarkerLine('#Todo: Simple todo item', 1) as TodoMarker;
      expect(result?.type).toBe('Todo');
      expect(result?.description).toBe('Simple todo item');
      expect(result?.category).toBeUndefined();
      expect(result?.tags).toEqual([]);
    });

    test('parses simple Feature', () => {
      const result = parseMarkerLine('#Feature: Simple feature', 1) as FeatureMarker;
      expect(result?.type).toBe('Feature');
      expect(result?.priority).toBeUndefined();
    });

    test('parses simple Limitation', () => {
      const result = parseMarkerLine('#Limitation: Simple limitation', 1) as LimitationMarker;
      expect(result?.type).toBe('Limitation');
      expect(result?.severity).toBeUndefined();
    });

    test('parses simple Bug', () => {
      const result = parseMarkerLine('#Bug: Simple bug', 1) as BugMarker;
      expect(result?.type).toBe('Bug');
      expect(result?.severity).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    test('returns null for non-marker line', () => {
      expect(parseMarkerLine('Just a regular line', 1)).toBeNull();
    });

    test('returns null for markdown header', () => {
      expect(parseMarkerLine('# Heading', 1)).toBeNull();
    });

    test('returns null for invalid marker type', () => {
      expect(parseMarkerLine('#Task[]: Something', 1)).toBeNull();
    });

    test('handles leading whitespace', () => {
      const result = parseMarkerLine('   #Todo[]: Task', 1);
      expect(result?.type).toBe('Todo');
    });

    test('preserves raw text', () => {
      const result = parseMarkerLine('#Todo[programming|2h]: Implement sync', 1);
      expect(result?.rawText).toBe('#Todo[programming|2h]: Implement sync');
    });
  });
});

describe('parseMarkers', () => {
  test('parses document with multiple markers', () => {
    const content = `# Document Title

#Todo[programming|2h]: First task

Some regular text.

#Feature[high|v1.0]: New feature

#Bug[major|]: Critical bug`;

    const result = parseMarkers(content);
    expect(result.markers.length).toBe(3);
    expect(result.errors.length).toBe(0);

    expect(result.markers[0].type).toBe('Todo');
    expect(result.markers[1].type).toBe('Feature');
    expect(result.markers[2].type).toBe('Bug');
  });

  test('assigns correct line numbers', () => {
    const content = `Line 1
#Todo: Task on line 2
Line 3
#Feature: Feature on line 4`;

    const result = parseMarkers(content);
    expect(result.markers[0].lineNumber).toBe(2);
    expect(result.markers[1].lineNumber).toBe(4);
  });

  test('skips markdown headers', () => {
    const content = `# Heading 1
## Heading 2
### Heading 3
#Todo: Actual task`;

    const result = parseMarkers(content);
    expect(result.markers.length).toBe(1);
    expect(result.markers[0].type).toBe('Todo');
  });

  test('skips lines not starting with #', () => {
    const content = `Regular line
Some #Todo[]: inline marker should be ignored
#Todo: This one counts`;

    const result = parseMarkers(content);
    expect(result.markers.length).toBe(1);
  });

  test('attaches source file to markers', () => {
    const content = '#Todo: Task';
    const result = parseMarkers(content, 'path/to/file.md');

    expect(result.markers[0].sourceFile).toBe('path/to/file.md');
  });

  test('returns empty arrays for content with no markers', () => {
    const content = `# Just a heading

Regular paragraph text.

Another paragraph.`;

    const result = parseMarkers(content);
    expect(result.markers).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test('handles empty content', () => {
    const result = parseMarkers('');
    expect(result.markers).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test('handles content with only whitespace', () => {
    const result = parseMarkers('   \n\n   \n');
    expect(result.markers).toEqual([]);
  });
});

describe('isMarkerProcessed', () => {
  const testMarker: Marker = {
    type: 'Todo',
    description: 'Test task',
    rawText: '#Todo: Test task',
    lineNumber: 5,
    category: undefined,
    estimate: undefined,
    tags: [],
  };

  test('returns false when markerIds is undefined', () => {
    expect(isMarkerProcessed(testMarker)).toBe(false);
  });

  test('returns false when marker line not in map', () => {
    const markerIds = new Map<number, number>();
    markerIds.set(1, 100);
    markerIds.set(10, 200);

    expect(isMarkerProcessed(testMarker, markerIds)).toBe(false);
  });

  test('returns true when marker line is in map', () => {
    const markerIds = new Map<number, number>();
    markerIds.set(5, 123);

    expect(isMarkerProcessed(testMarker, markerIds)).toBe(true);
  });
});

describe('markerToWorkItemRequest', () => {
  describe('Todo markers', () => {
    test('converts full Todo marker', () => {
      const marker: TodoMarker = {
        type: 'Todo',
        description: 'Implement feature X',
        rawText: '#Todo[programming|2h|api]: Implement feature X',
        lineNumber: 10,
        sourceFile: 'path/to/doc.md',
        category: 'programming',
        estimate: '2h',
        tags: ['api', 'feature'],
      };

      const result = markerToWorkItemRequest(marker, 1);

      expect(result.typeId).toBe(1);
      expect(result.name).toBe('Implement feature X');
      expect(result.description).toContain('Created from vault marker');
      expect(result.description).toContain('path/to/doc.md:10');
      expect(result.metadata.markerType).toBe('Todo');
      expect(result.metadata.category).toBe('programming');
      expect(result.metadata.estimate).toBe('2h');
      expect(result.metadata.tags).toEqual(['api', 'feature']);
    });

    test('omits undefined fields from metadata', () => {
      const marker: TodoMarker = {
        type: 'Todo',
        description: 'Simple task',
        rawText: '#Todo: Simple task',
        lineNumber: 1,
        category: undefined,
        estimate: undefined,
        tags: [],
      };

      const result = markerToWorkItemRequest(marker, 1);

      expect(result.metadata.category).toBeUndefined();
      expect(result.metadata.estimate).toBeUndefined();
      expect(result.metadata.tags).toBeUndefined();
    });
  });

  describe('Feature markers', () => {
    test('converts full Feature marker', () => {
      const marker: FeatureMarker = {
        type: 'Feature',
        description: 'New feature',
        rawText: '#Feature[high|v2.0]: New feature',
        lineNumber: 5,
        sourceFile: 'features.md',
        priority: 'high',
        milestone: 'v2.0',
      };

      const result = markerToWorkItemRequest(marker, 2);

      expect(result.metadata.priority).toBe('high');
      expect(result.metadata.milestone).toBe('v2.0');
    });

    test('omits undefined priority and milestone', () => {
      const marker: FeatureMarker = {
        type: 'Feature',
        description: 'Simple feature',
        rawText: '#Feature: Simple feature',
        lineNumber: 1,
        priority: undefined,
        milestone: undefined,
      };

      const result = markerToWorkItemRequest(marker, 2);

      expect(result.metadata.priority).toBeUndefined();
      expect(result.metadata.milestone).toBeUndefined();
    });
  });

  describe('Limitation markers', () => {
    test('converts full Limitation marker', () => {
      const marker: LimitationMarker = {
        type: 'Limitation',
        description: 'Performance issue',
        rawText: '#Limitation[known]: Performance issue',
        lineNumber: 3,
        sourceFile: 'limits.md',
        severity: 'known',
      };

      const result = markerToWorkItemRequest(marker, 3);

      expect(result.metadata.severity).toBe('known');
    });
  });

  describe('Bug markers', () => {
    test('converts full Bug marker', () => {
      const marker: BugMarker = {
        type: 'Bug',
        description: 'Critical crash',
        rawText: '#Bug[critical|regression]: Critical crash',
        lineNumber: 15,
        sourceFile: 'bugs.md',
        severity: 'critical',
        tags: ['regression'],
      };

      const result = markerToWorkItemRequest(marker, 4);

      expect(result.metadata.severity).toBe('critical');
      expect(result.metadata.tags).toEqual(['regression']);
    });

    test('omits empty tags array', () => {
      const marker: BugMarker = {
        type: 'Bug',
        description: 'Simple bug',
        rawText: '#Bug: Simple bug',
        lineNumber: 1,
        severity: undefined,
        tags: [],
      };

      const result = markerToWorkItemRequest(marker, 4);

      expect(result.metadata.tags).toBeUndefined();
    });
  });

  test('includes source file as unknown when not provided', () => {
    const marker: TodoMarker = {
      type: 'Todo',
      description: 'Task',
      rawText: '#Todo: Task',
      lineNumber: 1,
      category: undefined,
      estimate: undefined,
      tags: [],
    };

    const result = markerToWorkItemRequest(marker, 1);

    expect(result.description).toContain('unknown:1');
    expect(result.metadata.sourceFile).toBeUndefined();
  });
});

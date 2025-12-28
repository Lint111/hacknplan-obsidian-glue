# Documentation Patterns

This document provides ready-to-use templates for documenting glue MCP features with proper tagging and cross-references.

## Frontmatter Patterns

### Basic Design Element (Research/Feature Doc)

```yaml
---
tags: [TAG1, TAG2, TAG3]
hacknplan_id: DESIGN_ELEMENT_ID
hacknplan_project: PROJECT_ID
synced_at: YYYY-MM-DDTHH:MM:SSZ
---
```

**Example:**
```yaml
---
tags: [mcp, glue-layer, sync]
hacknplan_id: 15
hacknplan_project: 230955
synced_at: 2025-12-17T10:30:00Z
---
```

### Work Item Reference (Implementation Doc)

```yaml
---
tags: [TAG1, TAG2]
work_item_id: WORK_ITEM_ID
status: STATUS
estimate: HOURS
---
```

**Example:**
```yaml
---
tags: [implementation, marker-injection]
work_item_id: 38
status: in-progress
estimate: 4h
---
```

### With Marker Tracking

For documents that process vault markers (#Todo, #Feature, etc.):

```yaml
---
tags: [TAG1, TAG2]
hacknplan_id: DESIGN_ELEMENT_ID
marker_ids:
  LINE_NUMBER: HACKNPLAN_ID
  LINE_NUMBER: HACKNPLAN_ID
---
```

**Example:**
```yaml
---
tags: [research, algorithm]
hacknplan_id: 42
marker_ids:
  15: 123
  28: 124
  45: 125
---
```

## Document Templates

### Architecture Document

```markdown
---
tags: [architecture, COMPONENT_NAME]
hacknplan_id: DESIGN_ELEMENT_ID
---

# TITLE

**Status:** STATUS
**HacknPlan:** [#DESIGN_ELEMENT_ID](https://app.hacknplan.com/p/PROJECT_ID/kanban?categoryId=DESIGN_ELEMENT_TYPE_ID&designElementId=DESIGN_ELEMENT_ID)

## Overview

Brief description of the architectural component.

## Components

### Component 1

Description and responsibilities.

### Component 2

Description and responsibilities.

## Data Flow

Describe how data flows through the system.

## Integration Points

- **Integration 1:** Description
- **Integration 2:** Description

## Related Documents

- [[Other-Document-1]]
- [[Other-Document-2]]
```

**Example:**
```markdown
---
tags: [architecture, sync-queue]
hacknplan_id: 20
---

# Sync Queue Architecture

**Status:** Implemented
**HacknPlan:** [#20](https://app.hacknplan.com/p/230955/kanban?categoryId=9&designElementId=20)

## Overview

The sync queue manages automatic file synchronization with retry logic and concurrency control.

## Components

### Queue Manager

Tracks pending, processing, and completed sync operations.

### Retry Handler

Implements exponential backoff for failed operations.

## Data Flow

File changes → Debounce → Queue → Concurrent execution → Sync state update

## Integration Points

- **File Watcher:** Receives change events
- **Sync Executor:** Executes HacknPlan API calls
- **Sync State:** Tracks sync status

## Related Documents

- [[Sync-Executor]]
- [[File-Watcher]]
```

### Research/Design Element Document

```markdown
---
tags: [research, TOPIC]
hacknplan_id: DESIGN_ELEMENT_ID
hacknplan_project: PROJECT_ID
---

# TITLE

**Type:** Research | Feature | Limitation | Bug
**Created:** YYYY-MM-DD
**HacknPlan:** [#DESIGN_ELEMENT_ID](https://app.hacknplan.com/p/PROJECT_ID/kanban?categoryId=DESIGN_ELEMENT_TYPE_ID&designElementId=DESIGN_ELEMENT_ID)

## Problem Statement

What problem does this address?

## Proposed Solution

High-level approach.

## Implementation Notes

Technical details, considerations, edge cases.

## Todo Items

#Todo[programming|4h|TAG1,TAG2]: Task description
#Todo[programming|2h|TAG1]: Another task

## Limitations

#Limitation[known]: Known limitation description

## Related Work

- [[Related-Document-1]]
- [[Related-Document-2]]
```

**Example:**
```markdown
---
tags: [research, marker-system, notifications]
hacknplan_id: 33
hacknplan_project: 230955
---

# Review Marker System

**Type:** Feature
**Created:** 2025-12-17
**HacknPlan:** [#33](https://app.hacknplan.com/p/230955/kanban?categoryId=9&designElementId=33)

## Problem Statement

Need automatic notifications in vault docs when HacknPlan work items change state.

## Proposed Solution

Inject HTML comment markers (invisible in preview) when items complete or get updated.

## Implementation Notes

- Markers: `NeedsReview`, `OutOfSync`, `Completed`
- Format: `<!-- #Type[HP-ID|DATE]: Reason -->`
- Injectable at `after-frontmatter` or `end-of-file`

## Todo Items

#Todo[programming|3h|mcp,events]: Add event emitters to sync-executor
#Todo[programming|2h|mcp]: Create event listeners in index.ts

## Limitations

#Limitation[known]: Only works for documents linked via sync state

## Related Work

- [[Marker-Injector]]
- [[Sync-Executor]]
```

### Implementation Guide

```markdown
---
tags: [implementation, COMPONENT_NAME]
---

# TITLE - Implementation Guide

## Prerequisites

- Prerequisite 1
- Prerequisite 2

## Step-by-Step

### 1. STEP_TITLE

Description and code examples.

```typescript
// Code example
```

### 2. STEP_TITLE

Description and code examples.

```typescript
// Code example
```

## Testing

How to test the implementation.

## Troubleshooting

Common issues and solutions.

## Related

- [[Related-Doc-1]]
- [[Related-Doc-2]]
```

### Session Notes

```markdown
---
tags: [session, DATE]
date: YYYY-MM-DD
sprint: SPRINT_NAME
---

# Session YYYY-MM-DD - TITLE

## Goals

- [ ] Goal 1
- [ ] Goal 2

## Work Completed

### Task #ID: TITLE

- Accomplishment 1
- Accomplishment 2
- Time logged: Xh

### Task #ID: TITLE

- Accomplishment 1
- Time logged: Xh

## Decisions Made

- Decision 1 and rationale
- Decision 2 and rationale

## Blockers

- Blocker 1 and proposed solution
- Blocker 2

## Next Steps

- [ ] Next task 1
- [ ] Next task 2

## Links

- [[Related-Doc-1]]
- [[Related-Doc-2]]
```

## Marker Patterns

### Vault Markers (Auto-create work items)

```markdown
#Todo[CATEGORY|ESTIMATE|TAG1,TAG2]: Task description
#Feature[PRIORITY|MILESTONE]: Feature description
#Limitation[SEVERITY]: Limitation description
#Bug[SEVERITY|TAG1,TAG2]: Bug description
```

**Examples:**
```markdown
#Todo[programming|4h|mcp,glue]: Implement event emission in sync-executor
#Feature[high|v2.0]: Real-time collaboration support
#Limitation[known]: Full vault sync required on startup
#Bug[critical|regression]: Sync fails on files >1MB
```

### Review Markers (Auto-injected by glue)

These are injected automatically - you don't need to write them manually:

```html
<!-- #NeedsReview[HP-ID|DATE]: Reason -->
<!-- #OutOfSync[HP-ID|DATE]: Reason -->
<!-- #Completed[HP-ID|DATE]: Reason -->
```

**Examples:**
```html
<!-- #NeedsReview[HP-38|2025-12-17]: Task moved to Completed -->
<!-- #OutOfSync[HP-42|2025-12-17]: Description updated in HacknPlan -->
<!-- #Completed[HP-35|2025-12-17]: Marker tools implemented -->
```

## Tag Patterns

### Recommended Tag Structure

```
Primary Category:
- architecture
- implementation
- research
- session

Component:
- mcp
- glue-layer
- sync-queue
- marker-system
- file-watcher

Domain:
- notifications
- events
- cross-reference
- frontmatter
```

### Example Tag Combinations

```yaml
# Architecture doc
tags: [architecture, sync-queue, concurrency]

# Research/design element
tags: [research, marker-system, notifications]

# Implementation guide
tags: [implementation, mcp, cross-reference]

# Session notes
tags: [session, 2025-12-17, sprint-2]
```

## Cross-Reference Patterns

### HacknPlan Links

```markdown
**HacknPlan:** [#ID](https://app.hacknplan.com/p/PROJECT_ID/kanban?categoryId=TYPE_ID&designElementId=ID)
```

**Example:**
```markdown
**HacknPlan:** [#38](https://app.hacknplan.com/p/230955/kanban?categoryId=9&designElementId=38)
```

### Work Item Links

```markdown
**Work Item:** [#ID](https://app.hacknplan.com/p/PROJECT_ID/kanban?itemId=ID)
```

### Vault Links

```markdown
[[Document-Name]]
[[folder/Document-Name]]
[[Document-Name|Display Text]]
```

## Quick Copy-Paste Templates

### New Architecture Doc

```markdown
---
tags: [architecture, COMPONENT]
hacknplan_id: ID
---

# COMPONENT Architecture

**Status:** STATUS
**HacknPlan:** [#ID](LINK)

## Overview

## Components

## Data Flow

## Related Documents
```

### New Research Doc

```markdown
---
tags: [research, TOPIC]
hacknplan_id: ID
---

# TITLE

**Type:** Research
**Created:** DATE
**HacknPlan:** [#ID](LINK)

## Problem Statement

## Proposed Solution

## Implementation Notes

## Todo Items

## Related Work
```

### New Implementation Guide

```markdown
---
tags: [implementation, COMPONENT]
---

# COMPONENT - Implementation Guide

## Prerequisites

## Step-by-Step

### 1. STEP

## Testing

## Troubleshooting

## Related
```

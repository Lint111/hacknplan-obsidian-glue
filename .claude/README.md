# Claude Agent Configuration

This directory contains agent definitions and documentation patterns for use with Claude Code and the Claude Agent SDK.

## Directory Structure

```
.claude/
├── agents/                  # Agent definitions (YAML frontmatter + markdown)
│   ├── hacknplan-manager.md  # HacknPlan project management
│   └── obsidian-manager.md   # Obsidian vault documentation
├── documentation-patterns.md # Copy-paste templates for documentation
└── README.md               # This file
```

## Agents

### hacknplan-manager

Dedicated agent for HacknPlan operations. Use this agent when you need to:
- Create, update, or query work items
- Manage sprints and milestones
- Log work sessions
- Track task status

**Model:** Haiku (fast and cost-effective for project management tasks)

**Configuration:** Update the project-specific values in the agent file:
- `PROJECT_ID`: Your HacknPlan project ID
- `PROJECT_NAME`: Your project name
- `DEFAULT_BOARD_ID`: Your default sprint board
- `USER_ID`: Your HacknPlan user ID

**Environment Variables:**
```bash
export HACKNPLAN_API_KEY="your-api-key"
export HACKNPLAN_DEFAULT_PROJECT="your-project-id"
```

### obsidian-manager

Dedicated agent for Obsidian vault operations. Use this agent when you need to:
- Search vault documents
- Create or update documentation
- Manage cross-references with HacknPlan
- Generate session notes

**Model:** Haiku

**Configuration:** Update the vault path in the agent file:
- `VAULT_PATH`: Absolute path to your Obsidian vault

## Documentation Patterns

The `documentation-patterns.md` file provides ready-to-use templates for:

### 1. Frontmatter Patterns
- Basic design elements
- Work item references
- Marker tracking

### 2. Document Templates
- Architecture documents
- Research/design element docs
- Implementation guides
- Session notes

### 3. Marker Patterns
- Vault markers (#Todo, #Feature, #Limitation, #Bug)
- Review markers (auto-injected by glue MCP)

### 4. Tag Patterns
- Recommended tag structure
- Example tag combinations

### 5. Cross-Reference Patterns
- HacknPlan links
- Work item links
- Vault links

## Usage

### In Claude Code

Claude Code automatically detects agent definitions in `.claude/agents/`. When you reference an agent, Claude will:
1. Read the agent definition from the markdown file
2. Use the specified model (e.g., Haiku)
3. Follow the agent's instructions and configuration

**Example:**
```
User: "Create a task for implementing event hooks"
Claude: [Launches hacknplan-manager agent to create work item]
```

### In Claude Agent SDK

Import and use agents programmatically:

```typescript
import { Agent } from '@anthropic-ai/agent-sdk';

const agent = new Agent({
  definition: './claude/agents/hacknplan-manager.md',
  model: 'claude-haiku-4-5-20251101'
});

const result = await agent.run({
  prompt: "Log 3 hours on task #38"
});
```

## Environment Setup

### Required Environment Variables

```bash
# HacknPlan MCP
export HACKNPLAN_API_KEY="your-hacknplan-api-key"
export HACKNPLAN_DEFAULT_PROJECT="your-project-id"

# Obsidian Vault (optional - can be configured in pairing)
export OBSIDIAN_VAULT_PATH="/path/to/vault"
```

### MCP Configuration

Add the glue MCP to your `claude_desktop_config.json` or `mcp_config.json`:

```json
{
  "mcpServers": {
    "hacknplan-obsidian-glue": {
      "command": "node",
      "args": ["/path/to/hacknplan-obsidian-glue/dist/index.js"],
      "env": {
        "HACKNPLAN_API_KEY": "your-api-key"
      }
    }
  }
}
```

## MCP Tools Available

The glue MCP provides 4 categories of tools:

### 1. Pairing Management
- `add_pairing`: Create project-vault pairing
- `remove_pairing`: Remove pairing
- `update_pairing`: Update pairing config (including `autoInjectMarkers`)
- `get_pairing`: Get pairing details
- `list_pairings`: List all pairings

### 2. Vault Operations
- `scan_vault`: Scan vault for documents
- `extract_vault_tags`: Extract all tags from vault
- `process_vault_markers`: Parse #Todo/#Feature markers and create work items

### 3. Sync Operations
- `sync_vault_to_hacknplan`: Sync vault docs to HacknPlan design elements
- `sync_hacknplan_to_vault`: Sync design elements to vault
- `start_file_watcher`: Enable automatic sync on file changes
- `stop_file_watcher`: Disable file watcher

### 4. Review Markers
- `review_vault_markers`: Scan vault for review markers
- `clear_vault_marker`: Remove specific marker
- `inject_vault_marker`: Manually inject marker

### 5. Cross-References
- `generate_cross_references`: Create bidirectional links
- `map_tags_to_hacknplan`: Map vault tags to HacknPlan tag IDs

## Marker Injection Configuration

To enable automatic marker injection when HacknPlan work items change:

```typescript
// Update pairing with auto-injection enabled
mcp__hacknplan-obsidian-glue__update_pairing({
  projectId: YOUR_PROJECT_ID,
  autoInjectMarkers: true,  // Enable automatic injection
  markerPosition: "after-frontmatter"  // or "end-of-file"
});
```

When enabled, the glue MCP will automatically inject review markers:
- `#NeedsReview` when work items complete
- `#OutOfSync` when descriptions change
- `#Completed` when tasks are marked done

## Best Practices

### 1. Use Dedicated Agents
- Let `hacknplan-manager` handle all HacknPlan operations
- Let `obsidian-manager` handle all vault operations
- This reduces context bloat in the main conversation

### 2. Tag Consistently
Follow the tag patterns in `documentation-patterns.md`:
- Primary category: architecture, research, implementation
- Component: mcp, glue-layer, sync-queue
- Domain: notifications, events, cross-reference

### 3. Cross-Reference Everything
- Add `hacknplan_id` to vault docs
- Link to related vault documents
- Use the patterns from `documentation-patterns.md`

### 4. Use Vault Markers
For design docs, add markers for auto-task creation:
```markdown
#Todo[programming|4h|mcp]: Implement feature X
#Feature[high|v2.0]: Add real-time sync
#Limitation[known]: Requires full scan on startup
```

### 5. Enable Auto-Injection
Configure pairings with `autoInjectMarkers: true` to get automatic notifications in vault docs when HacknPlan items change state.

## Example Workflow

### 1. Start a New Sprint

```bash
# User prompt
"What tasks are in Sprint 2?"

# Claude launches hacknplan-manager
[Agent queries board, returns task list]
```

### 2. Implement a Feature

```bash
# User prompt
"Create architecture doc for marker injection system"

# Claude launches obsidian-manager
[Agent creates doc with proper frontmatter and tags]
```

### 3. Track Progress

```bash
# User prompt
"Log 4 hours on task #38 and move it to Completed"

# Claude launches hacknplan-manager
[Agent logs time and updates status]
```

### 4. Automatic Markers

With `autoInjectMarkers: true`, when task #38 completes:
```html
<!-- #NeedsReview[HP-38|2025-12-17]: Task moved to Completed -->
```

This marker is automatically injected into the linked vault document.

## Troubleshooting

### Agent Not Found
- Ensure `.claude/agents/` directory exists
- Check agent filename matches reference (e.g., `hacknplan-manager.md`)
- Verify YAML frontmatter is valid

### MCP Tools Not Available
- Check `mcp_config.json` configuration
- Verify `HACKNPLAN_API_KEY` is set
- Ensure glue MCP server is built (`npm run build`)

### Markers Not Injecting
- Verify `autoInjectMarkers: true` in pairing config
- Check that vault doc has `hacknplan_id` in frontmatter
- Ensure file watcher is running (`start_file_watcher`)

## Contributing

To add new agents:
1. Create `<agent-name>.md` in `.claude/agents/`
2. Include YAML frontmatter with `name`, `description`, `model`
3. Document the agent's purpose and operations
4. Update this README with the new agent

## Resources

- [Claude Agent SDK Documentation](https://github.com/anthropics/anthropic-sdk-typescript)
- [MCP Documentation](https://modelcontextprotocol.io)
- [HacknPlan API v7.0](https://hacknplan.com/api)
- [Obsidian Documentation](https://obsidian.md)

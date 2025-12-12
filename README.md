# HacknPlan-Obsidian Glue MCP

Synchronization layer between HacknPlan project management and Obsidian documentation vaults.

## Architecture

```
┌─────────────────────┐     ┌──────────────────────────┐     ┌─────────────────────┐
│ obsidian-vault MCP  │◄────│ hacknplan-obsidian-glue  │────►│ hacknplan MCP       │
│ (existing 3rd party)│     │ MCP (this server)        │     │ (pure API wrapper)  │
│                     │     │ - pairings config        │     │                     │
│                     │     │ - bidirectional sync     │     │                     │
│                     │     │ - cross-references       │     │                     │
└─────────────────────┘     └──────────────────────────┘     └─────────────────────┘
```

## Features

- **Project-Vault Pairings**: Link HacknPlan projects to Obsidian vault folders
- **Bidirectional Sync**: Sync design elements ↔ vault documents
- **Tag Mapping**: Map vault tags (#vulkan, #render-graph) to HacknPlan tag IDs
- **Cross-References**: Generate proper links between systems
- **Work Item Helpers**: Generate properly formatted descriptions with vault refs

## Installation

```bash
cd hacknplan-obsidian-glue
npm install
```

## Usage

### Start the MCP Server

```bash
npm start
# or
node src/index.js --config=/path/to/glue-config.json
```

### Claude Code Configuration

Add to `~/.claude.json` or project `.mcp.json`:

```json
{
  "mcpServers": {
    "hacknplan-obsidian-glue": {
      "command": "node",
      "args": ["C:/cpp/hacknplan-obsidian-glue/src/index.js"],
      "env": {
        "GLUE_CONFIG_PATH": "C:/cpp/hacknplan-obsidian-glue/glue-config.json"
      }
    }
  }
}
```

## Tools

### Pairing Management

| Tool | Description |
|------|-------------|
| `add_pairing` | Create project-vault pairing |
| `remove_pairing` | Remove pairing |
| `list_pairings` | List all pairings |
| `get_pairing` | Get pairing details |
| `update_pairing` | Update pairing config |

### Vault Operations

| Tool | Description |
|------|-------------|
| `scan_vault` | Scan vault folders, extract metadata |
| `extract_vault_tags` | Get all tags from vault documents |

### Sync Operations

| Tool | Description |
|------|-------------|
| `sync_vault_to_hacknplan` | Generate operations to sync vault → HacknPlan |
| `sync_hacknplan_to_vault` | Sync HacknPlan elements → vault files |

### Cross-Reference

| Tool | Description |
|------|-------------|
| `generate_cross_references` | Generate links between systems |
| `map_tags_to_hacknplan` | Map vault tags to HacknPlan tag IDs |
| `generate_work_item_description` | Format work item with vault refs |

## Configuration

### Pairing Example

```json
{
  "pairings": [
    {
      "projectId": 230809,
      "projectName": "Vixen",
      "vaultPath": "C:/cpp/VBVS--VIXEN/VIXEN/Vixen-Docs",
      "folderMappings": {
        "01-Architecture": 9,
        "03-Research": 10
      },
      "tagMappings": {
        "vulkan": 1,
        "render-graph": 2,
        "svo": 3,
        "ray-tracing": 4,
        "shader": 5,
        "documentation": 6,
        "refactor": 7,
        "performance": 8
      },
      "defaultBoard": 649644
    }
  ]
}
```

## Workflow Example

### Initial Setup

```javascript
// 1. Create pairing
glue.add_pairing({
  projectId: 230809,
  projectName: "Vixen",
  vaultPath: "C:/cpp/VBVS--VIXEN/VIXEN/Vixen-Docs",
  folderMappings: { "01-Architecture": 9 },
  tagMappings: { "vulkan": 1 }
})

// 2. Scan vault to see what's there
glue.scan_vault({ projectId: 230809 })

// 3. Generate sync operations
glue.sync_vault_to_hacknplan({ projectId: 230809, dryRun: true })

// 4. Execute via HacknPlan MCP
hacknplan.create_design_element({ ... })
```

### Creating Work Items

```javascript
// Generate formatted description
const desc = glue.generate_work_item_description({
  projectId: 230809,
  summary: "Implement new buffer allocation strategy",
  requirements: ["Support multiple allocation sizes", "Thread-safe"],
  relatedFiles: ["libraries/RenderGraph/src/Buffer.cpp:123"],
  vaultDocs: ["01-Architecture/RenderGraph-System.md"],
  acceptanceCriteria: ["Tests pass", "No memory leaks"]
})

// Create work item with HacknPlan MCP
hacknplan.create_work_item({
  projectId: 230809,
  title: "[RenderGraph] Implement buffer allocation",
  description: desc.description,
  categoryId: 1,
  tagIds: [2] // render-graph
})
```

## License

MIT

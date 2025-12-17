# Contributing Guide

Thank you for contributing to the HacknPlan-Obsidian Glue MCP!

## Getting Started

### Prerequisites

- Node.js 20+ and npm
- TypeScript 5.7+
- Git
- HacknPlan account (for E2E testing)
- Obsidian (optional, for manual testing)

### Development Setup

```bash
# Clone repository
git clone https://github.com/yourusername/hacknplan-obsidian-glue.git
cd hacknplan-obsidian-glue

# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test

# Start in watch mode for development
npm run watch
```

## Project Structure

```
hacknplan-obsidian-glue/
├── src/                    # TypeScript source
│   ├── index.ts           # MCP server entry point
│   ├── lib/               # Core libraries
│   └── tools/             # MCP tool implementations
├── dist/                  # Compiled JavaScript
├── docs/                  # Documentation
│   ├── API.md            # API reference
│   ├── ARCHITECTURE.md   # System architecture
│   ├── TESTING.md        # Testing guide
│   └── CONTRIBUTING.md   # This file
├── tests/                 # Test suites
│   ├── unit/             # Unit tests (60%)
│   ├── integration/      # Integration tests (30%)
│   └── e2e/              # End-to-end tests (10%)
├── glue-config.json      # Pairing configuration
├── sync-state.json       # Sync state tracking
├── package.json
├── tsconfig.json
└── jest.config.js
```

## Development Workflow

### 1. Create Feature Branch

```bash
git checkout -b feature/your-feature-name
```

Branch naming conventions:
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Test additions/improvements

### 2. Make Changes

Follow coding standards (see below).

### 3. Add Tests

All new features require:
- Unit tests (mandatory)
- Integration tests (if applicable)
- E2E tests (for major features)

**Coverage requirement: 80%+**

### 4. Run Tests

```bash
# All tests
npm test

# With coverage
npm test -- --coverage

# Specific test file
npm test -- pairing-manager.test.ts
```

### 5. Build

```bash
npm run build
```

Ensure TypeScript compiles without errors.

### 6. Commit

Follow conventional commits:

```bash
git commit -m "feat: add single-file sync optimization"
git commit -m "fix: handle race condition in sync queue"
git commit -m "docs: update API reference"
git commit -m "test: add unit tests for file watcher"
```

**Commit message format:**

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `style` - Formatting
- `refactor` - Code restructuring
- `test` - Adding tests
- `chore` - Maintenance

### 7. Push and Create PR

```bash
git push origin feature/your-feature-name
```

Create pull request on GitHub.

## Coding Standards

### TypeScript Style

**Use strict TypeScript:**

```typescript
// ✅ Good
function syncFile(path: string, projectId: number): Promise<SyncResult> {
  // ...
}

// ❌ Bad
function syncFile(path: any, projectId: any): Promise<any> {
  // ...
}
```

**Use interfaces for complex types:**

```typescript
// ✅ Good
interface Pairing {
  projectId: number;
  projectName: string;
  vaultPath: string;
}

// ❌ Bad
type Pairing = {
  projectId: number;
  projectName: string;
  vaultPath: string;
};
```

**Avoid any, use unknown:**

```typescript
// ✅ Good
function parseJson(json: string): unknown {
  return JSON.parse(json);
}

// ❌ Bad
function parseJson(json: string): any {
  return JSON.parse(json);
}
```

### Naming Conventions

- **Files:** `kebab-case.ts` (e.g., `single-file-sync.ts`)
- **Classes:** `PascalCase` (e.g., `PairingManager`)
- **Functions:** `camelCase` (e.g., `syncSingleFile`)
- **Constants:** `UPPER_SNAKE_CASE` (e.g., `MAX_RETRIES`)
- **Interfaces:** `PascalCase` (e.g., `Pairing`, `SyncResult`)

### Error Handling

Always use typed errors:

```typescript
// ✅ Good
class PairingNotFoundError extends Error {
  constructor(projectId: number) {
    super(`Pairing not found for project ${projectId}`);
    this.name = 'PairingNotFoundError';
  }
}

throw new PairingNotFoundError(230809);

// ❌ Bad
throw new Error('Pairing not found');
```

### Async/Await

Always use `async/await`, avoid callbacks:

```typescript
// ✅ Good
async function syncFile(path: string): Promise<void> {
  const content = await fs.readFile(path, 'utf-8');
  await processContent(content);
}

// ❌ Bad
function syncFile(path: string, callback: (err: Error | null) => void): void {
  fs.readFile(path, 'utf-8', (err, content) => {
    if (err) return callback(err);
    processContent(content, callback);
  });
}
```

### Documentation

Add JSDoc comments for public APIs:

```typescript
/**
 * Synchronize a single vault file to HacknPlan.
 *
 * @param filePath - Absolute path to vault file
 * @param projectId - HacknPlan project ID
 * @param pairing - Project-vault pairing configuration
 * @returns Sync operation result
 * @throws {FolderNotMappedError} If file's folder not in pairing
 */
async function syncSingleFile(
  filePath: string,
  projectId: number,
  pairing: Pairing
): Promise<SyncResult> {
  // ...
}
```

## Testing Guidelines

### Unit Tests

Test pure functions in isolation:

```typescript
describe('hashContent', () => {
  it('should return consistent hash for same content', () => {
    const content = 'test content';
    const hash1 = hashContent(content);
    const hash2 = hashContent(content);
    expect(hash1).toBe(hash2);
  });

  it('should return different hash for different content', () => {
    const hash1 = hashContent('content 1');
    const hash2 = hashContent('content 2');
    expect(hash1).not.toBe(hash2);
  });
});
```

### Integration Tests

Test module interactions:

```typescript
describe('FileWatcher + SyncQueue', () => {
  it('should queue file changes detected by watcher', async () => {
    const watcher = new FileWatcher(vaultPath, (path, event) => {
      queue.enqueue({ filePath: path, operation: event });
    });

    watcher.start();

    await fs.writeFile(testFile, 'content');
    await delay(1500);  // Wait for debounce

    expect(queue.length()).toBe(1);
  });
});
```

### E2E Tests

Test complete workflows:

```typescript
describe('E2E: Real-time sync', () => {
  it('should sync vault change to HacknPlan', async () => {
    // Create pairing
    const pairing = await manager.addPairing({...});

    // Create vault file
    await fs.writeFile(vaultFile, content);

    // Wait for sync
    await delay(2000);

    // Verify in HacknPlan
    const elements = await hacknplan.list_design_elements({...});
    expect(elements.items).toContainEqual(
      expect.objectContaining({ name: 'Test' })
    );
  });
});
```

## Pull Request Process

### Before Submitting

- [ ] Tests pass (`npm test`)
- [ ] Coverage >= 80% (`npm test -- --coverage`)
- [ ] TypeScript compiles (`npm run build`)
- [ ] Code follows style guide
- [ ] Documentation updated (if applicable)
- [ ] CHANGELOG.md updated

### PR Template

```markdown
## Description

Brief description of changes.

## Type of Change

- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New feature (non-breaking change adding functionality)
- [ ] Breaking change (fix/feature causing existing functionality to change)
- [ ] Documentation update

## Testing

Describe testing performed:
- Unit tests added/updated
- Integration tests added/updated
- E2E tests added/updated
- Manual testing performed

## Checklist

- [ ] Tests pass
- [ ] Coverage >= 80%
- [ ] TypeScript compiles
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
```

### Review Process

1. Automated checks run (GitHub Actions)
2. Code review by maintainers
3. Address feedback
4. Approval and merge

## Release Process

### Version Numbering

Follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (X.0.0): Breaking changes
- **MINOR** (0.X.0): New features (backward-compatible)
- **PATCH** (0.0.X): Bug fixes (backward-compatible)

### Creating a Release

```bash
# Update version in package.json
npm version minor  # or major/patch

# Update CHANGELOG.md
# Add release notes under new version heading

# Commit and tag
git add package.json CHANGELOG.md
git commit -m "chore: release v2.1.0"
git tag v2.1.0

# Push with tags
git push origin main --tags

# Build and publish
npm run build
npm publish
```

## Code of Conduct

### Our Standards

- Be respectful and inclusive
- Welcome constructive criticism
- Focus on collaboration
- Respect differing viewpoints

### Unacceptable Behavior

- Harassment or discrimination
- Trolling or insulting comments
- Publishing private information
- Unprofessional conduct

## Getting Help

### Questions

- **Documentation:** Check [README.md](../README.md), [API.md](API.md), [ARCHITECTURE.md](ARCHITECTURE.md)
- **Issues:** Search [GitHub Issues](https://github.com/yourusername/hacknplan-obsidian-glue/issues)
- **Discussions:** Use [GitHub Discussions](https://github.com/yourusername/hacknplan-obsidian-glue/discussions)

### Reporting Bugs

Use the bug report template:

```markdown
## Bug Description

Clear description of the bug.

## Steps to Reproduce

1. Step 1
2. Step 2
3. ...

## Expected Behavior

What should happen.

## Actual Behavior

What actually happens.

## Environment

- OS: Windows/macOS/Linux
- Node.js version: `node --version`
- Package version: `npm list hacknplan-obsidian-glue`

## Logs

Relevant logs/error messages.
```

### Feature Requests

Use the feature request template:

```markdown
## Feature Description

Clear description of the proposed feature.

## Use Case

Why is this feature needed? Who would use it?

## Proposed Solution

How should this feature work?

## Alternatives Considered

Other approaches you've thought about.
```

## Development Tips

### Debugging

**Enable verbose logging:**

```bash
DEBUG=* npm start
```

**Use VS Code debugger:**

```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Tests",
      "program": "${workspaceFolder}/node_modules/.bin/jest",
      "args": ["--runInBand", "--no-cache"],
      "console": "integratedTerminal"
    }
  ]
}
```

### Performance Profiling

```bash
# Profile with clinic.js
npm install -g clinic
clinic doctor -- node dist/index.js
```

### Memory Leaks

```bash
# Heap snapshot
node --expose-gc --inspect dist/index.js

# Then in Chrome DevTools:
# chrome://inspect → Take heap snapshot
```

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

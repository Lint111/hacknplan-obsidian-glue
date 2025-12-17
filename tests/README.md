# Test Suite

Comprehensive test suite for HacknPlan-Obsidian Glue MCP.

## Structure

```
tests/
├── setup.ts                # Jest global setup
├── fixtures/               # Test data
│   ├── vaults/            # Mock vault structures
│   ├── configs/           # Mock pairing configs
│   └── sync-states/       # Mock sync state files
├── unit/                  # Unit tests (60%)
│   ├── lib/              # Core library tests
│   └── tools/            # MCP tool tests
├── integration/           # Integration tests (30%)
│   ├── file-watcher-queue.test.ts
│   ├── sync-state-persistence.test.ts
│   └── vault-scan-to-sync.test.ts
└── e2e/                   # End-to-end tests (10%)
    ├── full-sync-workflow.test.ts
    ├── real-time-sync.test.ts
    └── error-recovery.test.ts
```

## Running Tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# E2E tests only
npm run test:e2e

# Watch mode (for development)
npm run test:watch

# With coverage report
npm run test:coverage
```

## Coverage Goals

- Statements: 80%+
- Branches: 80%+
- Functions: 80%+
- Lines: 80%+

## Writing Tests

### Unit Test Example

```typescript
// tests/unit/lib/my-module.test.ts
import { myFunction } from '../../../src/lib/my-module';

describe('myFunction', () => {
  it('should do something', () => {
    const result = myFunction('input');
    expect(result).toBe('expected output');
  });

  it('should handle edge cases', () => {
    expect(() => myFunction(null)).toThrow('Invalid input');
  });
});
```

### Integration Test Example

```typescript
// tests/integration/module-interaction.test.ts
import { ModuleA } from '../../src/lib/module-a';
import { ModuleB } from '../../src/lib/module-b';

describe('ModuleA + ModuleB Integration', () => {
  it('should work together correctly', async () => {
    const a = new ModuleA();
    const b = new ModuleB(a);

    const result = await b.doSomething();
    expect(result).toBeDefined();
  });
});
```

### E2E Test Example

```typescript
// tests/e2e/workflow.test.ts
import { setupTestEnvironment, cleanupTestEnvironment } from '../helpers';

describe('E2E: Complete Workflow', () => {
  beforeAll(async () => {
    await setupTestEnvironment();
  });

  afterAll(async () => {
    await cleanupTestEnvironment();
  });

  it('should complete full sync workflow', async () => {
    // Create pairing
    // Add vault document
    // Verify sync to HacknPlan
    // Modify document
    // Verify update
    expect(true).toBe(true);  // Placeholder
  });
});
```

## Test Fixtures

Located in `tests/fixtures/`:

- **vaults/**: Mock Obsidian vault structures
- **configs/**: Mock pairing configurations
- **sync-states/**: Mock sync state files

Use fixtures to ensure consistent test data across tests.

## Debugging Tests

### Run specific test file

```bash
npm test -- cross-reference.test.ts
```

### Run specific test case

```bash
npm test -- -t "should generate vault link"
```

### Enable debug logging

```bash
DEBUG=* npm test
```

### Run with Node debugger

```bash
node --inspect-brk node_modules/.bin/jest tests/unit/my-test.test.ts
```

Then attach debugger (VS Code, Chrome DevTools).

## CI/CD

Tests run automatically on:
- Push to `main` or `develop`
- Pull requests to `main`

See `.github/workflows/test.yml` for CI configuration.

## TODO

- [ ] Implement unit tests for all `src/lib/` modules
- [ ] Implement unit tests for all `src/tools/` modules
- [ ] Implement integration tests for key workflows
- [ ] Implement E2E tests for complete sync scenarios
- [ ] Achieve 80%+ coverage across all metrics
- [ ] Set up CI/CD pipeline
- [ ] Add performance benchmarks
- [ ] Add load testing for high-frequency scenarios

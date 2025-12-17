/**
 * Jest global setup
 *
 * Runs before all test suites.
 */

// Extend Jest timeout for E2E tests
jest.setTimeout(30000);

// Suppress console logs during tests (comment out for debugging)
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  // Keep error for failures
  error: console.error,
};

// Global test utilities
export const delay = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

export const createMockPairing = (overrides = {}) => ({
  projectId: 230809,
  projectName: 'Test Project',
  vaultPath: '/tmp/test-vault',
  folderMappings: { 'Architecture': 9, 'Research': 10 },
  tagMappings: { 'test': 1, 'mock': 2 },
  defaultBoard: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides
});

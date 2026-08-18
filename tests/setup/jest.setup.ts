import '@testing-library/jest-dom';

// Mock global objects that might be expected in the Obsidian environment
Object.defineProperty(global, 'require', {
  value: jest.fn(),
  writable: true,
});

// Mock console methods to reduce noise in tests
global.console = {
  ...global.console,
  error: jest.fn(),
  warn: jest.fn(),
  log: jest.fn(),
};

// Setup fetch mock for requestUrl-like behavior
global.fetch = jest.fn();

// Mock DOM methods that might be used
global.document = {
  ...global.document,
  createElement: jest.fn().mockReturnValue({
    style: {},
    classList: {
      add: jest.fn(),
      remove: jest.fn(),
      contains: jest.fn(),
    },
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    setAttribute: jest.fn(),
    getAttribute: jest.fn(),
    appendChild: jest.fn(),
    removeChild: jest.fn(),
  }),
} as any;
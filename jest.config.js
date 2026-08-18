module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/tests/**/*.spec.ts'
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/main.ts', // Entry point, tested via integration
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup/jest.setup.ts'],
  moduleNameMapping: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^utils/(.*)$': '<rootDir>/src/utils/$1',
    '^services/(.*)$': '<rootDir>/src/services/$1',
    '^Assistants/(.*)$': '<rootDir>/src/Assistants/$1',
    '^History/(.*)$': '<rootDir>/src/History/$1',
    '^Plugin/(.*)$': '<rootDir>/src/Plugin/$1',
    '^Settings/(.*)$': '<rootDir>/src/Settings/$1',
    '^Types/(.*)$': '<rootDir>/src/Types/$1',
  },
  clearMocks: true,
  restoreMocks: true,
};
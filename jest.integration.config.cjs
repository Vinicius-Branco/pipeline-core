module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/integration/**/*.test.ts"],
  setupFilesAfterEnv: ["<rootDir>/src/__tests__/integration/setup.ts"],
  verbose: false,
  maxWorkers: 1,
  testTimeout: 30000,
  globals: {
    "ts-jest": {
      isolatedModules: true,
    },
  },
  collectCoverage: true,
  coverageDirectory: "coverage/integration",
  coverageReporters: ["text", "lcov", "html"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  modulePathIgnorePatterns: ["/dist/"],
  silent: true,
  setupFiles: ["<rootDir>/src/__tests__/integration/setup.ts"],
  testEnvironmentOptions: {
    env: {
      ESBUILD_LOG_LEVEL: "error",
    },
  },
};

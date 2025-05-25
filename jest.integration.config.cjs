module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/integration/**/*.test.ts"],
  setupFiles: ["<rootDir>/src/__tests__/integration/setup.ts"],
  testEnvironmentOptions: {
    ESBUILD_LOG_LEVEL: "error",
  },
  verbose: false,
  silent: true,
  testTimeout: 30000,
  globals: {
    "ts-jest": {
      isolatedModules: true,
    },
  },
  setupFilesAfterEnv: ["<rootDir>/src/__tests__/integration/setup.ts"],
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        isolatedModules: true,
      },
    ],
  },
  collectCoverage: true,
  coverageDirectory: "coverage/integration",
  coverageReporters: ["text", "lcov", "html"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  modulePathIgnorePatterns: ["/dist/"],
  maxWorkers: 1,
};

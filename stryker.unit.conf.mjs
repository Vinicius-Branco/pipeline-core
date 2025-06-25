/** @type {import('@stryker-mutator/api/core').StrykerOptions} */
export default {
  packageManager: "npm",
  reporters: ["html", "clear-text", "progress", "dashboard"],
  testRunner: "jest",
  testRunnerNodeArgs: ["--max_old_space_size=4096"],
  coverageAnalysis: "perTest",
  jest: {
    projectType: "custom",
    configFile: "jest.unit.config.cjs",
    enableFindRelatedTests: true,
  },
  mutate: [
    "src/**/*.ts",
    "!src/**/*.spec.ts",
    "!src/**/*.test.ts",
    "!src/__tests__/**/*",
    "!src/examples/**/*",
    "!src/types/**/*",
    "!src/index.ts"
  ],
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  buildCommand: "npm run build",
  timeoutMS: 30000,
  timeoutFactor: 2,
  concurrency: 4,
  thresholds: {
    high: 80,
    low: 70,
    break: 60
  },
  mutator: {
    excludedMutations: [
      "StringLiteral",
      "RegexLiteral"
    ]
  },
  dashboard: {
    reportType: "full"
  }
}; 
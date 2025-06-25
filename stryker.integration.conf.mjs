/** @type {import('@stryker-mutator/api/core').StrykerOptions} */
export default {
  packageManager: "npm",
  reporters: ["html", "clear-text", "progress", "dashboard"],
  testRunner: "jest",
  testRunnerNodeArgs: ["--max_old_space_size=4096"],
  coverageAnalysis: "perTest",
  jest: {
    projectType: "custom",
    configFile: "jest.integration.config.cjs",
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
  timeoutMS: 60000, // Timeout maior para testes de integração
  timeoutFactor: 3, // Fator de timeout maior para testes de integração
  concurrency: 2, // Concorrência menor para testes de integração
  thresholds: {
    high: 70, // Thresholds mais baixos para testes de integração
    low: 60,
    break: 50
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
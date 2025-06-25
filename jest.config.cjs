module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleFileExtensions: ["ts", "js"],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  testMatch: [
    "**/*.test.ts",
    "**/__tests__/**/*.test.ts"
  ],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  modulePathIgnorePatterns: ["/dist/"],
  testTimeout: 30000, // Timeout para todos os testes
  verbose: true,
  collectCoverage: true,
  coverageDirectory: "coverage/all",
  coverageReporters: ["text", "lcov", "html"],
};

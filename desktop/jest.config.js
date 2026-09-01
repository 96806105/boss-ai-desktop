module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.js"],
  collectCoverageFrom: [
    "src/utils/**/*.js",
    "src/skills/**/*.js",
    "src/agents/**/*.js",
    "!**/node_modules/**"
  ],
  coverageDirectory: "coverage",
  verbose: true
};

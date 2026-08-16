/**
 * The tests cover the worker's side of the house — GTFS parsing and the model
 * — so this is plain ts-jest against Node. The `@/` alias matches tsconfig.
 *
 * Plain JavaScript rather than TypeScript: a .ts config would pull in ts-node
 * purely so Jest can read ten lines of settings.
 */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};

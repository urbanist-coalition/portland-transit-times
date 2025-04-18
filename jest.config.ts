import nextJest from "next/jest";

const createJestConfig = nextJest({ dir: "./" });

export default createJestConfig({
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.test.(ts|tsx)"],
  moduleDirectories: ["node_modules", "<rootDir>/"],
});

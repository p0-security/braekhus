import * as fs from "fs";

/** @type {import('ts-jest').JestConfigWithTsJest} */

const srcDir = fs.readdirSync(
  "/Users/gergo/githome/main-repo/backend/braekhus",
  {
    withFileTypes: true,
  }
);
const srcPaths = [];
for (const entry of srcDir) {
  if (entry.isDirectory()) {
    srcPaths.push(entry.name);
  }
}

const pathPattern = `^((${srcPaths.join("|")})/.*)`;

export default {
  preset: "ts-jest",
  moduleNameMapper: {
    [pathPattern]: "<rootDir>/$1",
  },
  rootDir: ".",
  testEnvironment: "node",
  testPathIgnorePatterns: ["^dist/", "^node_modules/", ".*.input.snap.ts"],
  moduleDirectories: ["node_modules"],
  transform: {
    "^.+\\.(t|j)sx?$": "@swc/jest",
  },
};

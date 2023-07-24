/** @type {import('ts-jest').JestConfigWithTsJest} */

const fs = require("fs");
const path = require("node:path");

const srcDir = fs.readdirSync(__dirname, {
  withFileTypes: true,
});
const srcPaths = [];
for (const entry of srcDir) {
  if (entry.isDirectory()) {
    srcPaths.push(entry.name);
  }
}

const pathPattern = `^((${srcPaths.join("|")})/.*)`;

module.exports = {
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

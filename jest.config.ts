import fs from 'fs';
import path from 'node:path';
import { Config } from '@jest/types';

const rootDir = path.resolve('.');

const srcDir = fs.readdirSync(rootDir, { withFileTypes: true });
const srcPaths: string[] = [];

for (const entry of srcDir) {
  if (entry.isDirectory()) {
    srcPaths.push(entry.name);
  }
}

const pathPattern = `^((${srcPaths.join('|')})/.*)`;

const config: Config.InitialOptions = {
  rootDir,
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    "^client/(.*)": "<rootDir>/client/$1",
    "^((.github|.husky|cli|common|log|node_modules|server|types|util)/.*)": "<rootDir>/$1",
  },
  testPathIgnorePatterns: ['^dist/', '^node_modules/', '.*.input.snap.ts'],
  moduleDirectories: ['node_modules'],
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
  transform: {
    '^.+\\.(t|j)sx?$': ['ts-jest', { useESM: true }],
  },
};

export default config;

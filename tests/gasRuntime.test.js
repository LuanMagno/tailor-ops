import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/**
 * Simulates the Google Apps Script V8 runtime: every .gs file is evaluated as a
 * classic script inside ONE shared global realm (top-level const/let/function are
 * shared across files), in the order clasp pushes them. No `module` exists there,
 * so the conditional CommonJS exports must stay inert.
 */

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const GS_FILES = readdirSync(SRC_DIR).filter((f) => f.endsWith('.gs')).sort();

const PUBLIC_RPC_FUNCTIONS = [
  'doGet',
  'analyzeJob',
  'generateResume',
  'getBacklog',
  'updateApplication',
  'getTelemetryMetrics',
  'getConfigInfo',
  'testHealthCheck',
];

function readSource(file) {
  return readFileSync(join(SRC_DIR, file), 'utf8');
}

function loadIntoSharedRealm(files) {
  const context = vm.createContext({ console });
  files.forEach((file) => {
    vm.runInContext(readSource(file), context, { filename: file });
  });
  return context;
}

describe('Google Apps Script V8 runtime compatibility', () => {
  it('loads every .gs file in alphabetical (clasp) order without load-time ReferenceErrors', () => {
    expect(GS_FILES.length).toBeGreaterThanOrEqual(8);
    expect(() => loadIntoSharedRealm(GS_FILES)).not.toThrow();
  });

  it('is independent of file load order (reverse order also loads cleanly)', () => {
    expect(() => loadIntoSharedRealm([...GS_FILES].reverse())).not.toThrow();
  });

  it('exposes all public RPC endpoints as global functions', () => {
    const context = loadIntoSharedRealm(GS_FILES);
    PUBLIC_RPC_FUNCTIONS.forEach((name) => {
      expect(typeof context[name], `${name} deve ser uma função global`).toBe('function');
    });
    const [statusList, appStatuses] = JSON.parse(
      vm.runInContext('JSON.stringify([STATUS_LIST, APPLICATION_STATUSES])', context)
    );
    expect(statusList).toEqual(appStatuses);
  });

  it('contains no ES module syntax in .gs files', () => {
    GS_FILES.forEach((file) => {
      const source = readSource(file);
      expect(/^\s*import\s.+from\s/m.test(source), `${file} contém import`).toBe(false);
      expect(/^\s*export\s/m.test(source), `${file} contém export`).toBe(false);
      expect(/\brequire\s*\(/.test(source), `${file} contém require()`).toBe(false);
    });
  });

  it('declares no duplicate top-level identifiers across .gs files', () => {
    const owners = {};
    const duplicates = [];
    const declaration = /^(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;

    GS_FILES.forEach((file) => {
      const source = readSource(file);
      let match;
      while ((match = declaration.exec(source)) !== null) {
        const name = match[1];
        if (owners[name]) {
          duplicates.push(`${name} (${owners[name]} e ${file})`);
        } else {
          owners[name] = file;
        }
      }
    });

    expect(duplicates).toEqual([]);
  });
});

import { readdir } from 'node:fs/promises';
import path from 'node:path';

const skippedDirectories = new Set(['bin', 'obj', 'node_modules', '.git', '.vs', '.idea']);

/** True for efcpt-config.json, efcpt-config.*.json and *.efcpt.json, but not for the schema file. */
export function isConfigFileName(fileName: string): boolean {
  const name = fileName.toLowerCase();
  if (!name.endsWith('.json') || name.endsWith('.schema.json')) return false;
  return name === 'efcpt-config.json' || name.startsWith('efcpt-config.') || name.endsWith('.efcpt.json');
}

/** Finds efcpt config files below a folder, skipping build output and dependency folders. Paths are sorted. */
export async function findConfigFiles(root: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name.toLowerCase())) await walk(full);
      } else if (entry.isFile() && isConfigFileName(entry.name)) {
        found.push(full);
      }
    }
  }

  await walk(path.resolve(root));
  return found.sort();
}

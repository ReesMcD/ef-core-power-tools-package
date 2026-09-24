// End-to-end test against the real engine. Runs only when EFCPT_UI_E2E_ENGINE points at a built
// efcpt.10.dll (see .github/workflows/efcpt-ui.yml). Set EFCPT_UI_E2E_BUILD=1 to also compile the result.
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Output } from '../src/commands/common.js';
import { main } from '../src/main.js';

const engine = process.env['EFCPT_UI_E2E_ENGINE'];
const sampleProject = fileURLToPath(new URL('./fixtures/sample-project', import.meta.url));

function capture(): Output & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (line = '') => stdout.push(line), err: (line = '') => stderr.push(line) };
}

describe.runIf(engine)('end to end with the real engine', () => {
  it('lists, generates exactly the listed objects, and keeps the efcpt-ui section', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'efcpt-ui-e2e-'));
    await cp(sampleProject, dir, { recursive: true });
    const env = { ...process.env, SAMPLE_SHOP_DB: `Data Source=${path.join(dir, 'shop.db')}` };

    const list = capture();
    expect(await main(['--list', '--engine', engine!], env, list, dir)).toBe(0);
    const marks = list.stdout.filter((l) => /^\s+\[[x ]\]/.test(l)).map((l) => l.trim().split('  ')[0]);
    expect(marks).toEqual(['[ ] AuditLog', '[x] Customers', '[x] Orders', '[x] BigOrders']);

    const gen = capture();
    const code = await main(['--generate', '--engine', engine!], env, gen, dir);
    expect(code, gen.stderr.join('\n')).toBe(0);

    // What --list predicted (refresh-object-lists on, AuditLog excluded) is what was generated
    const models = (await readdir(path.join(dir, 'Models'))).sort();
    expect(models).toEqual(['BigOrder.cs', 'Customer.cs', 'Order.cs', 'ShopContext.cs']);

    const config = JSON.parse(
      (await readFile(path.join(dir, 'efcpt-config.json'), 'utf8')).replace(/^\uFEFF/, ''),
    );
    expect(config['efcpt-ui']).toEqual({ provider: 'sqlite', connection: { env: 'SAMPLE_SHOP_DB' } });
    expect(JSON.stringify(config)).not.toContain(dir); // the connection string never ends up in the config

    if (process.env['EFCPT_UI_E2E_BUILD'] === '1') {
      const build = spawnSync('dotnet', ['build', path.join(dir, 'Sample.csproj'), '-nologo', '-v', 'q'], {
        encoding: 'utf8',
        timeout: 600_000,
      });
      expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0);
    }
  }, 900_000);
});

// Browser tests of the built web UI (dist/web, run `npm run build` first) against the fake engine.
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { parseCliArgs } from '../../src/args.js';
import { UiController } from '../../src/server/controller.js';
import { startUiServer, type UiServer } from '../../src/server/server.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fakeEngine = path.join(root, 'test/fixtures/fake-engine.mjs');
const sampleProject = path.join(root, 'test/fixtures/sample-project');
const webRoot = path.join(root, 'dist/web');

let server: UiServer | undefined;

test.afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function startUi(
  options: { env?: Record<string, string>; setup?: (dir: string) => Promise<void> } = {},
) {
  const dir = await mkdtemp(path.join(tmpdir(), 'efcpt-ui-browser-'));
  await cp(sampleProject, dir, { recursive: true });
  await options.setup?.(dir);
  const controller = new UiController({
    args: parseCliArgs(['--engine', fakeEngine]),
    env: options.env ?? { SAMPLE_SHOP_DB: 'Data Source=shop.db' },
    cwd: dir,
    io: { out: () => {}, err: () => {} },
  });
  await controller.init();
  server = await startUiServer({ controller, webRoot });
  const config = async () =>
    JSON.parse((await readFile(path.join(dir, 'efcpt-config.json'), 'utf8')).replace(/^\uFEFF/, ''));
  return { url: server.launchUrl, dir, config };
}

test('shows the project and database objects, and saves selection changes', async ({ page }) => {
  const ui = await startUi();
  await page.goto(ui.url);

  await expect(page.getByText('Sample · EF Core 10')).toBeVisible();
  await expect(page.getByText('environment variable SAMPLE_SHOP_DB · sqlite')).toBeVisible();

  const customers = page.getByRole('checkbox', { name: 'Customers', exact: true });
  await expect(customers).toBeChecked(); // refresh-object-lists is on: new objects are generated
  await expect(page.getByText('3 of 3 selected')).toBeVisible();

  await customers.uncheck();
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await expect(page.getByText('2 of 3 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Unsaved changes')).toBeHidden();

  const saved = await ui.config();
  expect(saved.tables).toContainEqual({ name: 'Customers', exclude: true });
  expect(saved['efcpt-ui'].connection).toEqual({ env: 'SAMPLE_SHOP_DB' });
});

test('group checkbox, filter, column exclusion and wildcard rules', async ({ page }) => {
  const ui = await startUi();
  await page.goto(ui.url);

  // Tables group: untick all, tri-state after ticking one
  const tablesGroup = page.getByRole('checkbox', { name: 'Select all in Tables' });
  await tablesGroup.uncheck();
  await expect(page.getByText('1 of 3 selected')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Orders', exact: true }).check();
  expect(
    await tablesGroup.evaluate((el) => (el as unknown as { indeterminate: boolean }).indeterminate),
  ).toBe(true);

  // Exclude a column of Orders; primary keys can't be excluded
  await page.getByRole('button', { name: 'Show columns' }).nth(1).click();
  await expect(page.getByRole('checkbox', { name: /^Id INTEGER/ })).toBeDisabled();
  await page.getByRole('checkbox', { name: /^Notes TEXT/ }).uncheck();
  await expect(page.getByText('(1 columns excluded)')).toBeVisible();

  // Filter
  await page.getByLabel('Filter objects').fill('big');
  await expect(page.getByRole('checkbox', { name: 'Orders', exact: true })).toBeHidden();
  await expect(page.getByRole('checkbox', { name: 'BigOrders', exact: true })).toBeVisible();
  await page.getByLabel('Filter objects').fill('');

  // Wildcard rule on views
  await page.getByLabel('New exclusion rule').nth(1).fill('Big*');
  await page.getByRole('button', { name: 'Add rule' }).nth(1).click();
  await expect(page.getByRole('checkbox', { name: 'BigOrders', exact: true })).not.toBeChecked();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Unsaved changes')).toBeHidden();
  const saved = await ui.config();
  expect(saved.tables).toEqual(
    expect.arrayContaining([
      { name: 'Customers', exclude: true },
      { name: 'Orders', excludedColumns: ['Notes'] },
    ]),
  );
  expect(saved.views).toEqual([{ exclusionWildcard: 'Big*' }]);
});

test('settings form writes only changed options, and generation shows the result', async ({ page }) => {
  const ui = await startUi();
  await page.goto(ui.url);
  await page.getByRole('tab', { name: 'Settings' }).click();

  const annotations = page.getByLabel(/Use DataAnnotation attributes/);
  await expect(annotations).not.toBeChecked();
  await annotations.check();
  await expect(page.getByLabel(/Use nullable reference types/)).toBeChecked(); // engine default
  await expect(page.getByLabel('Global path to T4 templates')).toBeDisabled();
  await page.getByLabel('Name of DbContext class').fill('StoreContext');

  await page.getByRole('button', { name: 'Save & Generate' }).click();
  await expect(page.getByRole('heading', { name: 'Generated 1 files' })).toBeVisible();

  const saved = await ui.config();
  expect(saved['code-generation']).toEqual({ 'refresh-object-lists': true, 'use-data-annotations': true });
  expect(saved.names['dbcontext-name']).toBe('StoreContext');
});

test('asks for a connection when none is configured, without saving it', async ({ page }) => {
  const ui = await startUi({ env: {} });
  await page.goto(ui.url);

  await expect(page.getByRole('heading', { name: 'Database connection' })).toBeVisible();
  await expect(page.getByText('SAMPLE_SHOP_DB (from efcpt-ui.connection.env) is not set')).toBeVisible();
  await page
    .getByLabel('Connection string, or path to a .dacpac')
    .fill('Data Source=typed.db;Password=hunter2');
  await page.getByRole('button', { name: 'Connect' }).click();

  await expect(page.getByRole('checkbox', { name: 'Customers', exact: true })).toBeVisible();
  await expect(page.getByText('entered in the UI')).toBeVisible();
  expect(await page.content()).not.toContain('hunter2');
  expect(JSON.stringify(await ui.config())).not.toContain('hunter2');
});

test('lets you pick one of several configs, or create a new one', async ({ page }) => {
  const ui = await startUi({ setup: (dir) => writeFile(path.join(dir, 'billing.efcpt.json'), '{}') });
  await page.goto(ui.url);

  await expect(page.getByRole('heading', { name: 'Choose a config' })).toBeVisible();
  await page.getByRole('button', { name: 'billing.efcpt.json' }).click();
  await expect(page.getByLabel('Config file')).toHaveValue('billing.efcpt.json');

  await page.getByLabel('Config file').selectOption('__new');
  await page.getByLabel(/Create a new config/).fill('Data/Sales/efcpt-config.json');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByLabel('Config file')).toHaveValue(path.join('Data', 'Sales', 'efcpt-config.json'));

  const created = JSON.parse(await readFile(path.join(ui.dir, 'Data/Sales/efcpt-config.json'), 'utf8'));
  // billing.efcpt.json has no connection, so the DbContext is named after the project
  expect(created.names).toEqual({ 'dbcontext-name': 'SampleContext', 'root-namespace': 'Sample.Shop' });
});

test('refuses access without the token', async ({ page }) => {
  await startUi();
  const response = await page.goto(server!.url);
  expect(response?.status()).toBe(403);
});

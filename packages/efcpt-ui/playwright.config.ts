import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Use a pre-installed Chromium when one is provided (for example in sandboxes without browser downloads)
const executablePath =
  process.env['PW_CHROMIUM_PATH'] ??
  (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: 'test/ui',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
  },
});

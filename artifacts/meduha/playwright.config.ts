import { defineConfig } from '@playwright/test';

// Replit exposes its Nix runtime loader through REPLIT_LD_AUDIT; Chromium child
// processes need the standard loader variable to resolve those system libraries.
if (process.env.REPLIT_LD_AUDIT && !process.env.LD_AUDIT) {
  process.env.LD_AUDIT = process.env.REPLIT_LD_AUDIT;
}

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:20269',
    browserName: 'chromium',
    headless: true,
    launchOptions: {
      ...(process.env.REPLIT_LD_AUDIT ? { executablePath: '/repl/tools/bin/chromium' } : {}),
    },
  },
  webServer: {
    command: 'pnpm run dev',
    cwd: '.',
    url: 'http://127.0.0.1:20269',
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
    env: {
      PORT: '20269',
      BASE_PATH: '/',
    },
  },
});

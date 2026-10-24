import { defineConfig } from '@playwright/test';

// Replit exposes its Nix runtime loader through REPLIT_LD_AUDIT; Chromium child
// processes need the standard loader variable to resolve those system libraries.
if (process.env.REPLIT_LD_AUDIT && !process.env.LD_AUDIT) {
  process.env.LD_AUDIT = process.env.REPLIT_LD_AUDIT;
}

const useArtifactRouter = process.env.MEDUHA_ADMIN_BROWSER_E2E === '1';
const artifactBaseURL = process.env.MEDUHA_E2E_BASE_URL
  ?? (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : 'http://127.0.0.1/');

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: useArtifactRouter ? artifactBaseURL : 'http://127.0.0.1:20269',
    browserName: 'chromium',
    headless: true,
    launchOptions: {
      ...(process.env.REPLIT_LD_AUDIT ? { executablePath: '/repl/tools/bin/chromium' } : {}),
    },
  },
  ...(!useArtifactRouter ? {
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
  } : {}),
});

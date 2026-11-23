import { defineConfig } from '@playwright/test'
import { b2Account, b2BrowserSetup, b2BrowserSpecCounts, loadB2Endpoints } from './e2e/b2-browser-env'
import { dispatchAccount, loadDispatchFixture } from './e2e/b2-risk-dispatch-fixture'
import { verifyRestartDirectory } from './e2e/b2-risk-dispatch-restart'
import { loadRemediationFixture } from './e2e/b2-risk-remediation-fixture'

const listOnly = process.argv.includes('--list')
let baseURL: string | undefined
if (!listOnly || process.env.B2_BROWSER_PREFLIGHT === '1') {
  baseURL = loadB2Endpoints().ui
  b2Account('B2_RISK_REGISTRATION_ADMIN', { allowSeed: true })
  dispatchAccount()
  loadRemediationFixture()
  loadDispatchFixture()
  if (listOnly) await verifyRestartDirectory()
}

export default defineConfig({
  testDir: './e2e',
  testMatch: Object.keys(b2BrowserSpecCounts),
  outputDir: '.codex/b2-browser-results',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  forbidOnly: true,
  globalSetup: b2BrowserSetup,
  reporter: [
    ['list'],
    ['./e2e/required-browser-results.ts', { expected: b2BrowserSpecCounts, listOnly }],
  ],
  use: {
    baseURL,
    serviceWorkers: 'block',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
})

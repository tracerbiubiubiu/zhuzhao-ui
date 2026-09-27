import { defineConfig } from '@playwright/test'

/**
 * E2E（03 号 §2：Playwright 打标准三栈，不用 stub）
 *
 * 运行前提（AGENTS.md「前端门禁」）：
 *   1. 后端栈：主仓 `bash scripts/dev-stack.sh up`（PG/Redis）+ `INTERNAL_JOBS_SK=xxx make dev`（app @33333）
 *   2. 前端 dev server 由 webServer 自动拉起（vite @4000，代理 /api、/al → 33333）
 *   3. 幂等建号/角色预设/凭据闭环在 globalSetup 完成（e2e/global-setup.ts）
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  // 共享 dev 栈 DB：串行执行防互踩（S1 会改密码、预设会写绑定）
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm dev',
    // vite 绑 0.0.0.0（仅 IPv4）——port 探测走 localhost 会解析 ::1 致假超时，用显式 IPv4 url 轮询
    url: 'http://127.0.0.1:4000/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})

import { defineConfig } from '@playwright/test'
import { assertStandardBrowserDatabase, b2BrowserSpecCounts, loadIsolatedBrowserEndpoints } from './e2e/b2-browser-env'

const listOnly = process.argv.includes('--list')
const prestarted = process.env.E2E_USE_PRESTARTED_UI === '1' && !listOnly
const baseURL = prestarted ? loadIsolatedBrowserEndpoints().ui : process.env.E2E_BASE_URL ?? 'http://localhost:4000'
const requireComplete = process.env.E2E_REQUIRE_COMPLETE === '1'
const jsonReport = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE
if (requireComplete && !listOnly) {
  if (!prestarted) throw new Error('完整标准浏览器门禁需要预启动的独占 UI 和 Core')
  assertStandardBrowserDatabase()
}

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
  testIgnore: Object.keys(b2BrowserSpecCounts),
  timeout: 90_000,
  // 共享 dev 栈 DB：串行执行防互踩（S1 会改密码、预设会写绑定）
  workers: 1,
  // 9 spec 串行打同一 dev 栈，尾部重 spec（S7 六账号 setup）偶发环境抖动——
  // 重试 1 次兜底（单跑可复现的功能失败重试同样会挂，不掩盖缺陷）
  retries: 1,
  reporter: [
    ['list'],
    ...(requireComplete ? [['./e2e/required-browser-results.ts', {
      expected: 55, listOnly, allowRetries: true,
    }] as const] : []),
    ...(jsonReport ? [['json', { outputFile: jsonReport }] as const] : []),
  ],
  globalSetup: './e2e/global-setup.ts',
  // 9 spec 串行打同一 dev 栈，长负载下偶发慢——默认 5s 断言窗口过紧致偶发假失败
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: prestarted ? undefined : {
    command: 'pnpm dev',
    // vite 绑 0.0.0.0（仅 IPv4）——port 探测走 localhost 会解析 ::1 致假超时，用显式 IPv4 url 轮询
    url: 'http://127.0.0.1:4000/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { BrowserContext, Page, TestInfo } from '@playwright/test'
import { uiLogin } from './ui'

const item9Spec = 'b2-risk-lifecycle.spec.ts'

export const b2BrowserSpecCounts = {
  'b2-risk-registration.spec.ts': 2,
  'b2-risk-dispatch.spec.ts': 3,
  'b2-risk-remediation.spec.ts': 3,
  [item9Spec]: 1,
}

export const item9Only = process.env.B2_BROWSER_ITEM9_ONLY === '1'
export const selectedB2BrowserSpecCounts = item9Only ? { [item9Spec]: 1 } : b2BrowserSpecCounts
export const b2BrowserSetup = fileURLToPath(new URL('./b2-risk-dispatch-restart.ts', import.meta.url))

const sharedDevPorts = new Set(['4000', '33333', '18080', '18081'])

export function requiredB2Env(key: string): string {
  const value = process.env[key]
  if (!value?.trim()) throw new Error(`缺少本轮独占夹具的环境变量 ${key}`)
  return value
}

function loopbackOrigin(key: string, allowHttps = false): URL {
  const value = requiredB2Env(key)
  const url = URL.parse(value)
  if (!url || url.origin !== value || !['127.0.0.1', '[::1]'].includes(url.hostname)
    || !url.port || sharedDevPorts.has(url.port)
    || (url.protocol !== 'http:' && !(allowHttps && url.protocol === 'https:'))) {
    throw new Error(`${key} 须为显式带独占端口的回环 ${allowHttps ? 'HTTP(S)' : 'HTTP'} origin`)
  }
  return url
}

export function loadIsolatedBrowserEndpoints(): { ui: string; core: string } {
  const ui = loopbackOrigin('E2E_BASE_URL')
  const core = loopbackOrigin('E2E_API_BASE')
  if (ui.port === core.port) throw new Error('本轮 UI 与 Core 须使用不同独占端口')
  return { ui: ui.origin, core: core.origin }
}

export function assertStandardBrowserDatabase(): void {
  const container = requiredB2Env('E2E_PG_CONTAINER')
  const owner = requiredB2Env('E2E_MAINTENANCE_STACK_OWNER')
  const user = requiredB2Env('E2E_PG_USER')
  const database = requiredB2Env('E2E_PG_DB')
  if (![owner, container, user, database].every(value => /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(value))) {
    throw new Error('完整标准浏览器门禁需要显式独占数据库标识')
  }
  const docker = (args: string[]) => execFileSync('docker', args, {
    encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  try {
    const labels = docker(['inspect', '--type', 'container', '--format',
      '{{index .Config.Labels "audit.owner"}} {{index .Config.Labels "com.docker.compose.project"}}', container])
    if (labels !== `${owner} ${owner}`) throw new Error('归属不匹配')
    const current = docker(['exec', container, 'psql', '-XAtq', '-U', user, '-d', database, '-c', 'SELECT current_database()'])
    if (current !== database) throw new Error('数据库不匹配')
  } catch {
    throw new Error('标准浏览器门禁的独占 PostgreSQL 归属或连接校验失败')
  }
}

export function loadB2Endpoints(): { ui: string; core: string; storage?: string } {
  const { ui, core } = loadIsolatedBrowserEndpoints()
  const storage = process.env.B2_RISK_STORAGE_ORIGIN === undefined
    ? undefined : loopbackOrigin('B2_RISK_STORAGE_ORIGIN', true)
  if (storage && [new URL(ui).port, new URL(core).port].includes(storage.port)) {
    throw new Error('本轮存储须使用单独的独占端口')
  }
  return { ui, core, storage: storage?.origin }
}

export function b2Account(prefix: string, options?: { allowSeed?: boolean }): { employeeNo: string; password: string } {
  const employeeNo = requiredB2Env(`${prefix}_NO`).trim()
  const password = requiredB2Env(`${prefix}_PASSWORD`)
  if (employeeNo.toUpperCase() === 'E000001' && !options?.allowSeed) {
    throw new Error(`${prefix}_NO 须使用本轮合成非种子账号`)
  }
  return { employeeNo, password }
}

export function assertB2Config({ config, project }: TestInfo): void {
  if (config.globalSetup !== b2BrowserSetup || config.webServer || config.workers !== 1
    || project.retries !== 0 || project.use.baseURL !== loadB2Endpoints().ui
    || project.use.serviceWorkers !== 'block' || project.use.trace !== 'off'
    || project.use.screenshot !== 'off' || project.use.video !== 'off') {
    throw new Error('B2 须使用专用入口，单 worker、零重试、无自动服务启动与全局建号')
  }
}

export async function loginB2Browser(page: Page, { employeeNo, password }: ReturnType<typeof b2Account>): Promise<void> {
  try {
    await uiLogin(page, employeeNo, password)
  } catch {
    throw new Error('专项浏览器登录交互失败')
  }
}

export async function restrictB2Browser(context: BrowserContext, origins: readonly string[]): Promise<void> {
  await context.route('**/*', route => origins.includes(new URL(route.request().url()).origin)
    ? route.continue()
    : route.abort('blockedbyclient'))
}

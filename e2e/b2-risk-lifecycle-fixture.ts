import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { b2Account, loadB2Endpoints, loginB2Browser, requiredB2Env, restrictB2Browser } from './b2-browser-env'
import { assertB2RiskResponse } from './b2-risk-assertions'
import { coreClient, coreRead } from './b2-risk-remediation-fixture'
import type { TokenPair } from './helpers'

function positiveInt64(key: string): string {
  const value = requiredB2Env(key)
  if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) {
    throw new Error(`${key} 须为正 int64 十进制字符串`)
  }
  return value
}

export function loadLifecycleFixture() {
  const { ui: origin, core, storage } = loadB2Endpoints()
  if (!storage) throw new Error('第 9 项须提供 B2_RISK_STORAGE_ORIGIN 以验证新工单的真实附件')
  const accounts = {
    M: b2Account('B2_RISK_LIFECYCLE_M'),
    U: b2Account('B2_RISK_LIFECYCLE_U'),
    P: b2Account('B2_RISK_LIFECYCLE_P'),
    X: b2Account('B2_RISK_LIFECYCLE_X'),
  }
  if (new Set(Object.values(accounts).map(account => account.employeeNo.toUpperCase())).size !== 4) {
    throw new Error('第 9 项须使用四个不同的合成账号')
  }
  const target = {
    org_id: positiveInt64('B2_RISK_LIFECYCLE_ORG_ID'),
    type_code: requiredB2Env('B2_RISK_LIFECYCLE_TYPE_CODE').trim(),
    definition_version: positiveInt64('B2_RISK_LIFECYCLE_DEFINITION_VERSION'),
  }
  return { origin, core, storage, accounts, target }
}

type Fixture = ReturnType<typeof loadLifecycleFixture>
type Role = keyof Fixture['accounts']
type Actor = {
  page: Page
  userId: string
  employeeNo: string
  client: ReturnType<typeof coreClient>
  read: <T>(path: string) => Promise<T>
  storage?: string
}

export async function withLifecycleActors<T>(browser: Browser, fixture: Fixture, run: (actors: Record<Role, Actor>) => Promise<T>) {
  const { origin, core } = fixture
  const contexts: BrowserContext[] = []

  async function signIn(role: Role): Promise<Actor> {
    const account = fixture.accounts[role]
    const storage = role === 'P' ? fixture.storage : undefined
    const context = await browser.newContext({
      baseURL: origin, serviceWorkers: 'block', viewport: { width: 1440, height: 900 }, locale: 'zh-CN',
    })
    contexts.push(context)
    context.setDefaultTimeout(10_000)
    context.setDefaultNavigationTimeout(15_000)
    await restrictB2Browser(context, storage ? [origin, storage] : [origin])
    const page = await context.newPage()
    const [login] = await Promise.all([
      page.waitForResponse(response => response.request().method() === 'POST' && response.url() === `${origin}/api/v1/auth/login`),
      loginB2Browser(page, account),
    ])
    await page.waitForURL(/#\/home(?:[/?]|$)/)
    const session = await assertB2RiskResponse(login.request(), 200, 0) as TokenPair
    if (!session?.access_token || session.must_change_password !== false) {
      throw new Error(`第 9 项 ${role} 账号须能直接登录`)
    }
    const client = coreClient(core, session.access_token)
    const read = <T>(path: string) => coreRead(client, path, `第 9 项 ${role} 独立 GET ${path}`, data => data as T)
    const profile = await read<{ id: string; employee_no: string }>('/api/v1/user/profile')
    if (profile.employee_no?.toUpperCase() !== account.employeeNo.toUpperCase()) {
      throw new Error(`第 9 项 ${role} 的 UI 登录与 Core 回读身份不一致`)
    }
    expect(profile.id).toMatch(/^[1-9]\d*$/)
    return { page, userId: profile.id, employeeNo: account.employeeNo, client, read, storage }
  }

  try {
    const actors = { M: await signIn('M'), U: await signIn('U'), P: await signIn('P'), X: await signIn('X') }
    expect(new Set(Object.values(actors).map(actor => actor.userId)).size).toBe(4)
    return await run(actors)
  } finally {
    await Promise.all(contexts.map(context => context.close()))
  }
}

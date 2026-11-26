import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { loginB2Browser, restrictB2Browser } from './b2-browser-env'

// M 主锚派单人，U 资产责任人及当前复测人，P 当前办理人，X 有入口和目标读权但无当前复测职责。
type Role = 'M' | 'U' | 'P' | 'X'
type Account = { employeeNo: string; password: string; userId: string }

/** 权限由独占候选预置。登录后以当前会话读取操作者身份，再开始业务操作。 */
export async function withB2RiskRolePages<T>(
  browser: Browser,
  baseURL: string,
  accounts: Record<Role, Account>,
  readActorId: (page: Page) => Promise<string>,
  run: (pages: Record<Role, Page>) => Promise<T>,
): Promise<T> {
  const roles: Role[] = ['M', 'U', 'P', 'X']
  assert.equal(new Set(roles.map(role => accounts[role].employeeNo)).size, roles.length, '四个角色需要不同合成账号')
  assert.equal(new Set(roles.map(role => accounts[role].userId)).size, roles.length, '四个角色需要不同用户 ID')
  const contexts: BrowserContext[] = []
  async function signIn(role: Role): Promise<Page> {
    const context = await browser.newContext({ baseURL, serviceWorkers: 'block', storageState: { cookies: [], origins: [] } })
    contexts.push(context)
    await restrictB2Browser(context, [baseURL])
    const page = await context.newPage()
    const account = accounts[role]
    await loginB2Browser(page, account)
    await page.waitForURL(/#\/home(?:[/?]|$)/)
    assert.ok(await readActorId(page) === account.userId, `${role} 会话回读的用户与夹具不符`)
    return page
  }
  try {
    return await run({ M: await signIn('M'), U: await signIn('U'), P: await signIn('P'), X: await signIn('X') })
  } finally {
    await Promise.all(contexts.map(context => context.close()))
  }
}

/** 夹具逻辑标识，每次调用使用独立漏洞和资产。候选接线负责映射登记字段及已核实的责任人。 */
export function b2RiskCardSample(businessDay: string) {
  const firstDue = new Date(`${businessDay}T17:00:00.000Z`)
  assert.ok(Number.isFinite(firstDue.getTime()) && firstDue.toISOString().slice(0, 10) === businessDay, '业务日须为有效 UTC 日期 YYYY-MM-DD')
  const nextDue = new Date(firstDue)
  nextDue.setUTCDate(nextDue.getUTCDate() + 1)
  const seed = `b2-e2e-${randomUUID()}`
  return {
    findingKey: `${seed}-finding`,
    risks: {
      R1: { assetKey: `${seed}-asset-a`, level: 'high', dueAt: firstDue.toISOString() },
      R2: { assetKey: `${seed}-asset-b`, level: 'medium', dueAt: nextDue.toISOString() },
    },
    thirdAssetKey: `${seed}-asset-c`,
    differentFindingKey: `${seed}-different-finding`,
  } as const
}

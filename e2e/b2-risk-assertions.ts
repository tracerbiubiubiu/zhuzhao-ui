import assert from 'node:assert/strict'
import type { Page, Request } from '@playwright/test'
import type { Envelope } from './helpers'

type Command = { method: string; url: string }

/** 先监听，再触发操作。act 应等到可辨认的界面终态或候选故障注入点。 */
export async function observeB2RiskRequests(page: Page, command: Command, act: () => Promise<void>): Promise<Request[]> {
  const url = new URL(command.url).href
  const requests: Request[] = []
  const record = (request: Request) => {
    if (request.method() === command.method && request.url() === url) requests.push(request)
  }
  page.on('request', record)
  try {
    await act()
    return requests
  } finally {
    page.off('request', record)
  }
}

/** 使用该次浏览器请求的响应。真实栈用例须直通上游，并关闭 Service Worker 和响应替换。 */
export async function assertB2RiskResponse(request: Request, expectedStatus: number, expectedCode: number): Promise<unknown> {
  const response = await request.response()
  assert.ok(response, '该浏览器请求未取得响应')
  assert.equal(response.fromServiceWorker(), false, 'Service Worker 响应不能作上游证据')
  const address = await response.serverAddr()
  assert.ok(address?.ipAddress && address.port > 0, '响应缺少服务端地址')
  assert.equal(response.status(), expectedStatus, '浏览器请求的 HTTP 状态')
  const envelope = await response.json() as Envelope | null
  assert.equal(envelope?.code, expectedCode, '浏览器请求的业务码')
  return envelope?.data
}

const countKeys = ['tickets', 'activeLinks', 'ticketHistory', 'riskHistory', 'dispatchRecords', 'operationReceipts', 'requiredIntents'] as const
type CountKey = typeof countKeys[number]

export type B2RiskCounts = Record<CountKey, number>
export type B2RiskSnapshot<Facts extends object> = { counts: B2RiskCounts; facts: Facts }

/** 前后用相同的合成对象和操作范围独立读回。缺失计数直接失败，预期差量省略项为零。 */
export function assertB2RiskCountDelta(before: B2RiskCounts, after: B2RiskCounts, delta: Partial<B2RiskCounts>): void {
  for (const key of countKeys) {
    assert.ok(Number.isSafeInteger(before[key]) && before[key] >= 0, `缺少有效的 ${key} 前置计数`)
    assert.ok(Number.isSafeInteger(after[key]) && after[key] >= 0, `缺少有效的 ${key} 后置计数`)
    assert.equal(after[key] - before[key], delta[key] ?? 0, `${key} 的读回差量`)
  }
}

/** 在旧页面保留操作后确认现势授权条件，再采快照。拒绝审计按合同单独核对。 */
export async function assertB2RiskCurrentDenial<Facts extends object>(options: {
  page: Page
  command: Command
  act: () => Promise<void>
  assertAuthorizationContext: (page: Page) => Promise<void>
  assertCommand: (request: Request) => void | Promise<void>
  expectedStatus: 403 | 404
  expectedCode: number
  // 由仍获权的观察者读取票、风险、关联，以及当前版本、证据和状态。
  readBack: () => Promise<B2RiskSnapshot<Facts>>
}): Promise<void> {
  const { page, command, act, assertAuthorizationContext, assertCommand, expectedStatus, expectedCode, readBack } = options
  assert.ok((expectedStatus === 403 || expectedStatus === 404) && Number.isInteger(expectedCode) && expectedCode > 0, '需要明确的授权拒绝状态和业务码')
  await assertAuthorizationContext(page)
  const before = structuredClone(await readBack())
  const requests = await observeB2RiskRequests(page, command, act)
  assert.equal(requests.length, 1, '服务端拒绝场景必须发出一次目标命令')
  const [request] = requests
  await assertCommand(request)
  await assertB2RiskResponse(request, expectedStatus, expectedCode)
  assertUnchanged(before, await readBack())
}

function assertUnchanged<Facts extends object>(before: B2RiskSnapshot<Facts>, after: B2RiskSnapshot<Facts>): void {
  assertB2RiskCountDelta(before.counts, after.counts, {})
  assert.deepEqual(after.facts, before.facts, '独立读回的业务事实应保持一致')
}

/** 从候选实际请求取操作号。查询和重投都须使用首次发出的操作号。 */
export async function assertB2RiskSameOperation(options: {
  first: Request
  lookup: Request
  lookupCommand: Command
  retry: Request
  operationIdOf: (request: Request) => string | null | Promise<string | null>
}): Promise<string> {
  const { first, lookup, lookupCommand, retry, operationIdOf } = options
  assert.equal(new Set([first, lookup, retry]).size, 3, '首次命令、查回执、重投须分别观察到请求')
  const lookupURL = new URL(lookupCommand.url).href
  assert.ok(lookup.method() === lookupCommand.method && lookup.url() === lookupURL, '回执查询请求应匹配实际查询入口')
  assert.ok(first.method() !== lookupCommand.method || first.url() !== lookupURL, '回执查询请求应与重投入口区分')
  const operationId = await operationIdOf(first)
  assert.ok(typeof operationId === 'string' && operationId.trim().length > 0, '首次请求缺少操作号')
  assert.equal(await operationIdOf(lookup), operationId, '回执查询的操作号')
  assert.equal(await operationIdOf(retry), operationId, '重投的操作号')
  assert.equal(retry.method(), first.method(), '重投的请求方法')
  assert.equal(retry.url(), first.url(), '重投的请求地址')
  const firstInput: unknown = first.postDataJSON()
  assert.ok(firstInput && typeof firstInput === 'object', '首次命令缺少业务输入')
  assert.deepEqual(retry.postDataJSON(), firstInput, '同号重投的原始业务输入')
  return operationId
}

type Receipt<Result extends object> = { operationId: string; result: Result }
type Committed<Facts extends object, Result extends object> = { snapshot: B2RiskSnapshot<Facts>; receipt: Receipt<Result> }

/** committed 和 afterRetry 来自独立持久读回，result 投影稳定业务结果。 */
export function assertB2RiskRecoveryReadback<Facts extends object, Result extends object>(options: {
  operationId: string
  beforeCounts: B2RiskCounts
  committed: Committed<Facts, Result>
  expectedDelta: Partial<B2RiskCounts> & { operationReceipts: number }
  lookupReceipt: Receipt<Result>
  retryReceipt: Receipt<Result>
  afterRetry: Committed<Facts, Result>
}): void {
  const { operationId, beforeCounts, committed, expectedDelta, lookupReceipt, retryReceipt, afterRetry } = options
  assert.ok(expectedDelta.operationReceipts > 0, '首次提交应新增持久回执')
  assertB2RiskCountDelta(beforeCounts, committed.snapshot.counts, expectedDelta)
  assert.equal(committed.receipt.operationId, operationId, '首次持久化回执的操作号')
  assert.deepEqual(lookupReceipt, committed.receipt, '查回执返回同一业务结果')
  assert.deepEqual(retryReceipt, committed.receipt, '重投返回同一业务结果')
  assert.deepEqual(afterRetry.receipt, committed.receipt, '重投后的持久回执保持一致')
  assertUnchanged(committed.snapshot, afterRetry.snapshot)
}

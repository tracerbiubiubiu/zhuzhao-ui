import { describe, expect, it, vi } from 'vitest'
import { preparePage, setupPage, deferred, httpError, settle } from '@/test/sfcHarness'
import source from './index.vue?raw'
preparePage(source)
function setup() {
  const api = { listMessageTemplatesApi: vi.fn(), listMessageRulesApi: vi.fn(), listMessageLogsApi: vi.fn() }
  const { page, lifecycle } = setupPage(source, { '@/api/message': api, 'element-plus': {} })
  return { page, api, lifecycle }
}
describe('通知管理读取状态与筛选世代', () => {
  it.each([
    ['fetchTemplates', 'listMessageTemplatesApi', 'templates', 'tplError', 'tplLoading', { list: [] }],
    ['fetchRules', 'listMessageRulesApi', 'rules', 'ruleError', 'ruleLoading', []],
    ['fetchLogs', 'listMessageLogsApi', 'logs', 'logError', 'logLoading', { list: [], total: 0 }],
  ] as const)('%s 区分失败、无权与成功空集，并隔离旧响应', async (fetch, call, rows, error, loading, empty) => {
    const { page, api } = setup()
    api[call].mockRejectedValueOnce(httpError(503, '合成读取故障')).mockRejectedValueOnce(httpError(403)).mockResolvedValueOnce(empty)
    await page[fetch]()
    expect((page[error]?.value ?? '')).toContain('合成读取故障')
    await page[fetch]()
    expect((page[error]?.value ?? '')).toContain('无权')
    await page[fetch]()
    expect((page[error]?.value ?? '')).toBe('')
    expect(page[rows].value).toEqual([])
    const old = deferred(), next = deferred()
    api[call].mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    const p = page[fetch](), q = page[fetch]()
    old.reject(httpError(403))
    await p
    expect((page[error]?.value ?? '')).toBe('')
    expect(page[loading].value).toBe(true)
    next.resolve(empty)
    await q
    expect(page[loading].value).toBe(false)
  })
  it('筛选输入即失效，防抖窗口旧回包不能混入新业务 ID', async () => {
    vi.useFakeTimers()
    const { page, api } = setup()
    const old = deferred()
    api.listMessageLogsApi.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ list: [{ biz_id: '902' }], total: 1 })
    const p = page.fetchLogs()
    page.logFilter.biz_id = ' 902 '
    page.onLogFilterChange()
    old.resolve({ list: [{ biz_id: '901' }], total: 50 })
    await p
    expect(page.logs.value).toEqual([])
    expect(page.logLoading.value).toBe(true)
    await vi.advanceTimersByTimeAsync(300)
    await settle()
    expect(api.listMessageLogsApi.mock.lastCall?.[0]).toEqual({ page: 1, page_size: 20, biz_id: '902' })
    expect(page.logs.value).toEqual([{ biz_id: '902' }])
    expect(page.logTotal.value).toBe(1)
  })
})

it.each([
  ['fetchTemplates', 'listMessageTemplatesApi', 'templates', { list: [{ code: 'old' }] }, { list: [{ code: 'new' }] }, [{ code: 'new' }]],
  ['fetchRules', 'listMessageRulesApi', 'rules', [{ id: 'old' }], [{ id: 'new' }], [{ id: 'new' }]],
  ['fetchLogs', 'listMessageLogsApi', 'logs', { list: [{ biz_id: 'old' }], total: 99 }, { list: [{ biz_id: 'new' }], total: 1 }, [{ biz_id: 'new' }]],
])('%s 最新先结束后旧成功不覆盖', async (fetch: any, call: any, rows: any, before: any, after: any, expected: any) => {
  const { page, api } = setup()
  const old = deferred(), next = deferred()
  ;(api as any)[call].mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
  const p = page[fetch](), q = page[fetch]()
  next.resolve(after)
  await q
  old.resolve(before)
  await p
  expect(page[rows].value).toEqual(expected)
})
it('离开期间响应失效，返回时重读而非显示空成功', async () => {
  const { page, api, lifecycle } = setup()
  const pending = deferred()
  api.listMessageTemplatesApi.mockReturnValueOnce(pending.promise).mockResolvedValue({ list: [{ code: 'current' }] })
  api.listMessageRulesApi.mockResolvedValue([])
  api.listMessageLogsApi.mockResolvedValue({ list: [], total: 0 })
  const p = page.fetchTemplates()
  lifecycle.deactivate()
  pending.resolve({ list: [{ code: 'old' }] })
  await p
  lifecycle.activate()
  await settle()
  expect(page.templates.value).toEqual([{ code: 'current' }])
})
it('筛选防抖期间离开，返回仍按新筛选从首页读取', async () => {
  vi.useFakeTimers()
  const { page, api, lifecycle } = setup()
  api.listMessageTemplatesApi.mockResolvedValue({ list: [] })
  api.listMessageRulesApi.mockResolvedValue([])
  api.listMessageLogsApi.mockResolvedValue({ list: [], total: 0 })
  page.logPage.value = 3
  page.logFilter.biz_id = '42'
  page.onLogFilterChange()
  lifecycle.deactivate()
  lifecycle.activate()
  await settle()
  expect(api.listMessageLogsApi.mock.lastCall?.[0]).toEqual({ page: 1, page_size: 20, biz_id: '42' })
})

it('发送记录翻页失败清除上一请求总数，并保留本页供重试', async () => {
  const { page, api } = setup()
  api.listMessageLogsApi.mockResolvedValueOnce({ list: [{ biz_id: '901' }], total: 55 })
    .mockRejectedValueOnce(httpError(503, '合成分页故障'))
    .mockResolvedValueOnce({ list: [{ biz_id: '902' }], total: 53 })
  await page.fetchLogs()
  page.logPage.value = 2
  await page.fetchLogs()
  expect(page.logs.value).toEqual([])
  expect(page.logTotal.value).toBe(0)
  expect(page.logError.value).toContain('合成分页故障')
  expect(page.logPage.value).toBe(2)
  await page.fetchLogs()
  expect(api.listMessageLogsApi.mock.lastCall?.[0]).toEqual({ page: 2, page_size: 20 })
  expect(page.logs.value).toEqual([{ biz_id: '902' }])
  expect(page.logTotal.value).toBe(53)
})

it.each(['storage', '9223372036854775806'])('发送记录业务标识 %s 按字符串精确查询', async bizID => {
  const { page, api } = setup()
  api.listMessageLogsApi.mockResolvedValue({ list: [{ biz_id: bizID }], total: 1 })
  page.logFilter.biz_id = ` ${bizID} `
  await page.fetchLogs()
  expect(api.listMessageLogsApi.mock.lastCall?.[0]).toEqual({ page: 1, page_size: 20, biz_id: bizID })
  expect(page.logs.value).toEqual([{ biz_id: bizID }])
})

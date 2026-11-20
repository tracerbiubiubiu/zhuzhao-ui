import { describe, expect, it, vi } from 'vitest'
import { preparePage, setupPage, deferred, httpError, settle } from '@/test/sfcHarness'
import source from './index.vue?raw'
preparePage(source)
function setup() {
  const api = { listPanicsApi: vi.fn() }
  const { page, lifecycle } = setupPage(source, { '@/api/audit': api, 'element-plus': {}, '@/components/ProTable/index.vue': {}, '@/components/UserNameText/index.vue': {}, '@/components/FilterBar/index.vue': {} })
  return { page, api, lifecycle }
}
describe('Panic 分页读取', () => {
  it('首次失败的总数未知，成功空集后才有零总数', async () => {
    const { page, api } = setup()
    api.listPanicsApi.mockRejectedValueOnce(httpError(503, '读取失败')).mockResolvedValueOnce({ list: [], total: 0, page: 1 })
    await page.fetchPanics()
    expect(page.panicsTotal.value).toBeNull()
    expect(page.panicsError.value).toContain('读取失败')
    await page.fetchPanics()
    expect(page.panicsTotal.value).toBe(0)
    expect(page.panicsError.value).toBe('')
  })
  it('快速翻页只接受最新页且旧 finally 不清 loading', async () => {
    const { page, api } = setup()
    const old = deferred(), next = deferred()
    api.listPanicsApi.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    const p = page.fetchPanics(1), q = page.fetchPanics(2)
    old.resolve({ list: [{ id: 'old' }], total: 25, page: 1 })
    await p
    expect(page.panics.value).toEqual([])
    expect(page.panicsLoading.value).toBe(true)
    next.resolve({ list: [{ id: 'new' }], total: 25, page: 2 })
    await q
    expect(page.panicsPage.value).toBe(2)
    expect(page.panics.value).toEqual([{ id: 'new' }])
  })
  it('次页失败保留请求页与总数，清旧数据并可原页重试', async () => {
    const { page, api } = setup()
    api.listPanicsApi.mockResolvedValueOnce({ list: [{ id: 'old' }], total: 25, page: 1 }).mockRejectedValueOnce(httpError(503, '读取失败')).mockResolvedValueOnce({ list: [], total: 25, page: 2 })
    await page.fetchPanics(1)
    await page.fetchPanics(2).catch(() => {})
    expect(page.panics.value).toEqual([])
    expect(page.panicsPage.value).toBe(2)
    expect(page.panicsTotal.value).toBe(25)
    expect(page.panicsError.value).toContain('读取失败')
    await page.fetchPanics()
    expect(api.listPanicsApi.mock.lastCall).toEqual([2, 20])
    expect(page.panicsError.value).toBe('')
  })
})
it('当前次页先结束后旧失败不能覆盖，403 保持无权状态', async () => {
  const { page, api } = setup()
  const old = deferred()
  api.listPanicsApi.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ list: [{ id: 'page-2' }], total: 21, page: 2 }).mockRejectedValueOnce(httpError(403))
  const p = page.fetchPanics(1)
  await page.fetchPanics(2)
  old.reject(httpError(503))
  await p
  expect(page.panics.value).toEqual([{ id: 'page-2' }])
  expect(page.panicsError.value).toBe('')
  await page.fetchPanics(2)
  expect(page.panicsError.value).toContain('无权')
})

it('离开时中止旧页归属，返回当前签重读原页', async () => {
  const { page, api, lifecycle } = setup()
  const pending = deferred()
  api.listPanicsApi.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ list: [{ id: 'fresh' }], total: 1, page: 1 })
  page.activeTab.value = 'panics'
  await Promise.resolve()
  lifecycle.deactivate()
  pending.resolve({ list: [{ id: 'old' }], total: 1, page: 1 })
  await Promise.resolve()
  lifecycle.activate()
  await settle()
  expect(page.panics.value).toEqual([{ id: 'fresh' }])
})

import { describe, expect, it, vi } from 'vitest'
import { preparePage, setupPage, deferred, httpError } from '@/test/sfcHarness'
import * as guidance from './maintenanceGuidance'
import source from './index.vue?raw'
preparePage(source)
function setup() {
  const api = { getTaskApi: vi.fn(), RUN_STATUS: {} }
  const { page, lifecycle } = setupPage(source, {
    '@/api/task': api, 'element-plus': {}, '@/common/auth': { usePermission: () => ({ hasPerm: () => false }) },
    './maintenanceGuidance': guidance,
    '@/components/FilterBar/index.vue': {}, '@/components/ProTable/index.vue': {}, '@/components/CronBuilder/index.vue': {},
  })
  return { page, api, lifecycle }
}
describe('任务详情目标世代', () => {
  it.each([true, false])('旧请求 success=%s 不覆盖新详情/错误/loading', async success => {
    const { page, api } = setup()
    const old = deferred(), next = deferred()
    api.getTaskApi.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    const p = page.openDetail({ task_id: 'a' }), q = page.openDetail({ task_id: 'b' })
    if (success) old.resolve({ task_id: 'a' })
    else old.reject(httpError(403))
    await p
    expect(page.detail.value).toBe(null)
    expect(page.detailLoading.value).toBe(true)
    next.resolve({ task_id: 'b' })
    await q
    expect(page.detail.value.task_id).toBe('b')
  })
  it.each([[404, '未查到'], [403, '无权'], [503, '加载失败'], [0, '加载失败']])('错误 %s 单独分类', async (status, text) => {
    const { page, api } = setup()
    api.getTaskApi.mockRejectedValueOnce(status ? httpError(status as number) : new Error('network'))
    await page.openDetail({ task_id: 'a' })
    expect((page.detailError?.value ?? '')).toContain(text)
  })
})
it('同目标重开后当前先结束，旧错误不覆盖；关闭后不应用结果', async () => {
  const { page, api } = setup()
  const old = deferred(), late = deferred()
  api.getTaskApi.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ task_id: 'a', status: 'done' }).mockReturnValueOnce(late.promise)
  const p = page.openDetail({ task_id: 'a' })
  page.detailVisible.value = false
  await page.openDetail({ task_id: 'a' })
  old.reject(httpError(403))
  await p
  expect(page.detail.value.status).toBe('done')
  expect(page.detailError.value).toBe('')
  const q = page.openDetail({ task_id: 'b' })
  page.detailVisible.value = false
  late.resolve({ task_id: 'b' })
  await q
  expect(page.detail.value).toBe(null)
})

import { beforeEach, expect, it, vi } from 'vitest'
import { listAlTypesApi, listAlTypeHistoryApi, listAlDataApi } from './al'
import { listMessageTemplatesApi, listMessageRulesApi, listMessageLogsApi } from './message'
import { listPanicsApi } from './audit'
import { getTaskApi } from './task'
import { queryIntelApi } from './intel'
import { getMyOrgsApi } from './org/selfService'
import { getDictItemsByCodeApi } from './system/dict'
const { get } = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@vea/request', () => ({ default: { get } }))
beforeEach(() => { get.mockReset(); get.mockResolvedValue({ list: [], items: [] }) })
it.each([
  ['类型清单', () => listAlTypesApi()],
  ['类型历史', () => listAlTypeHistoryApi('synthetic')],
  ['活动数据', () => listAlDataApi('synthetic', {})],
  ['通知模板', () => listMessageTemplatesApi({ page: 1, page_size: 20 })],
  ['通知规则', () => listMessageRulesApi()],
  ['发送记录', () => listMessageLogsApi({ page: 1, page_size: 20 })],
  ['Panic', () => listPanicsApi(2, 20)],
  ['任务详情', () => getTaskApi('synthetic')],
  ['情报', () => queryIntelApi('ip', '192.0.2.1')],
  ['组织', () => getMyOrgsApi()],
] as const)('%s 由当前页面呈现错误，迟到请求不产生全局 toast', async (_name, read) => {
  await read()
  expect(get.mock.lastCall?.[1]?._silentError).toBe(true)
  const error = new Error('合成网络故障')
  get.mockRejectedValueOnce(error)
  await expect(read()).rejects.toBe(error)
})
it('字典可选静默配置不改变含停用项语义及默认调用者', async () => {
  await getDictItemsByCodeApi('synthetic', true, { _silentError: true })
  expect(get).toHaveBeenLastCalledWith('/api/v1/user/dicts/synthetic/items?include_disabled=true', { _silentError: true })
  await getDictItemsByCodeApi('synthetic')
  expect(get.mock.lastCall?.[1]?._silentError).not.toBe(true)
})

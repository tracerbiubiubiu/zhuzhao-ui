import { QueryClient, useQuery } from '@tanstack/vue-query'
import * as elementPlus from 'element-plus'
import { createRenderer, defineComponent, h, nextTick, type VNode } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compareInt64Desc } from '@/utils/int64'
import { deferred, httpError, preparePage, renderPage, setupPage } from '@/test/sfcHarness'
import source from './index.vue?raw'

preparePage(source)
const clients: QueryClient[] = []
const unmounts: Array<() => void> = []
afterEach(() => {
  unmounts.splice(0).forEach(unmount => unmount())
  clients.splice(0).forEach(client => client.clear())
})

function nodes(node: any): any[] {
  if (!node || typeof node !== 'object') return []
  const children = Array.isArray(node.children)
    ? node.children
    : Object.values(node.children ?? {}).filter(value => typeof value === 'function').flatMap(slot => (slot as () => VNode[])())
  return [node, ...children.flatMap(nodes)]
}

// 无 DOM 的真实分页组件：保留 Element Plus 页数监听和事件，而不仿写其回页逻辑。
function mountInboxPager(page: any) {
  type HostNode = { children: HostNode[]; parent?: HostNode }
  const renderer = createRenderer<HostNode, HostNode>({
    createElement: () => ({ children: [] }), createText: () => ({ children: [] }), createComment: () => ({ children: [] }),
    insert: (child, parent) => { child.parent = parent; parent.children.push(child) },
    remove: child => { if (child.parent) child.parent.children = child.parent.children.filter(node => node !== child) },
    parentNode: node => node.parent ?? null, nextSibling: () => null,
    setText() {}, setElementText() {}, patchProp() {},
  })
  const app = renderer.createApp(defineComponent({ setup: () => () => {
    const pager = nodes(renderPage(source, page)).find(node => node.type === elementPlus.ElPagination)
    return pager ? h(elementPlus.ElPagination, pager.props) : null
  } }))
  app.directive('loading', {})
  app.mount({ children: [] })
  unmounts.push(() => app.unmount())
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(client)
  const api = {
    listNotificationsApi: vi.fn().mockResolvedValue({ list: [{ id: 'first' }], total: 45 }),
    getNotificationDeliveryApi: vi.fn(),
    markNotificationReadApi: vi.fn(),
    listNotificationOptoutsApi: vi.fn().mockResolvedValue([]),
    setNotificationOptoutApi: vi.fn(),
  }
  const { page } = setupPage(source, {
    'element-plus': elementPlus, 'vue-router': { useRouter: () => ({}) },
    '@/api/message': api, '@/api/ticket': {}, '@/utils/int64': { compareInt64Desc },
    '@tanstack/vue-query': { useQuery: (options: any) => useQuery(options, client), useQueryClient: () => client },
  })
  return { page, api }
}

describe('消息中心非首页读取', () => {
  it.each([true, false])('换页等待和 success=%s 后均保留请求页，不被暂缺总数归一', async success => {
    const { page, api } = setup()
    await vi.waitFor(() => expect(page.inboxRows.value).toEqual([{ id: 'first' }]))
    const pending = deferred()
    api.listNotificationsApi.mockReturnValueOnce(pending.promise)
    mountInboxPager(page)
    page.page.current = 2
    await nextTick()
    await nextTick()
    expect(page.page.current).toBe(2)
    expect(page.inboxQuery.isLoading.value).toBe(true)
    expect(api.listNotificationsApi.mock.lastCall).toEqual([{ page: 2, page_size: 20, unread: undefined }])
    if (success) pending.resolve({ list: [{ id: 'second' }], total: 45 })
    else pending.reject(httpError(503, '通知暂不可用'))
    await vi.waitFor(() => expect(page.inboxQuery.isLoading.value).toBe(false))
    expect(page.page.current).toBe(2)
    if (success) expect(page.inboxRows.value).toEqual([{ id: 'second' }])
    else {
      expect(page.inboxError.value).toContain('通知暂不可用')
      expect(page.inboxRows.value).toEqual([])
      api.listNotificationsApi.mockResolvedValueOnce({ list: [], total: 45 })
      await page.inboxQuery.refetch()
      expect(api.listNotificationsApi.mock.lastCall).toEqual([{ page: 2, page_size: 20, unread: undefined }])
      expect(page.inboxError.value).toBe('')
    }
  })
})

describe('工单复核通知', () => {
  const notification = { id: '271', title: '工单待复核', delivery_id: 'delivery-synthetic-271', link: '/tickets/542' }
  const receipt = { delivery_id: notification.delivery_id, updated_at: '2026-11-27T08:00:00Z' }

  it('查原投递区分受理、未知和送达，查询不会标记站内消息已读', async () => {
    const { page, api } = setup()
    api.getNotificationDeliveryApi
      .mockResolvedValueOnce({ ...receipt, state: 'accepted' })
      .mockResolvedValueOnce({ ...receipt, state: 'unknown' })
      .mockResolvedValueOnce({ ...receipt, state: 'delivered' })
    await page.openDelivery(notification.delivery_id)
    expect(page.deliveryLabel.value).toBe('已受理')
    await page.loadDelivery()
    expect(page.deliveryLabel.value).toBe('结果未知')
    await page.loadDelivery()
    expect(page.deliveryLabel.value).toBe('已送达')
    expect(api.getNotificationDeliveryApi.mock.calls).toEqual(Array.from({ length: 3 }, () => [notification.delivery_id]))
    expect(api.markNotificationReadApi).not.toHaveBeenCalled()
  })

  it('切换投递后旧响应不能替换当前状态，也不能显示不匹配的回执', async () => {
    const { page, api } = setup()
    const old = deferred()
    api.getNotificationDeliveryApi
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ ...receipt, state: 'delivered' })
    const previous = page.openDelivery(notification.delivery_id)
    await page.openDelivery('delivery-synthetic-272')
    expect(page.delivery.result).toBeNull()
    expect(page.delivery.error).toBe('投递记录与查询编号不一致')
    old.resolve({ ...receipt, state: 'accepted' })
    await previous
    expect(page.delivery.id).toBe('delivery-synthetic-272')
    expect(page.delivery.result).toBeNull()
  })

  it('复核单事件偏好写入本人入口，更新失败保留原状态并展示原因', async () => {
    const { page, api } = setup()
    api.setNotificationOptoutApi
      .mockRejectedValueOnce(httpError(503, '偏好暂不可用'))
      .mockResolvedValueOnce(undefined)
    await page.loadReviewPreference()
    await page.setReviewPreference(true)
    expect(page.reviewPreference.optedOut).toBe(false)
    expect(page.reviewPreference.error).toBe('偏好暂不可用')
    await page.setReviewPreference(true)
    expect(page.reviewPreference.optedOut).toBe(true)
    expect(api.setNotificationOptoutApi).toHaveBeenLastCalledWith({ biz_type: 'ticket', event_action: 'ticket.review_requested', opt_out: true })
  })

  it('现有全域退订覆盖复核偏好，单事件控件不能覆盖它', async () => {
    const { page, api } = setup()
    api.listNotificationOptoutsApi.mockResolvedValueOnce([{ biz_type: 'ticket', event_action: '*' }])
    await page.loadReviewPreference()
    expect(page.reviewPreference.allOptedOut).toBe(true)
    await page.setReviewPreference(false)
    expect(api.setNotificationOptoutApi).not.toHaveBeenCalled()
  })
})

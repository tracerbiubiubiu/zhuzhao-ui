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
  const api = { listNotificationsApi: vi.fn().mockResolvedValue({ list: [{ id: 'first' }], total: 45 }) }
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

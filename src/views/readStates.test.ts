import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { preparePage, setupPage, httpError, deferred, settle } from '@/test/sfcHarness'
import homeSource from './Home/index.vue?raw'
import orgSource from './MyOrg/index.vue?raw'
import alSource from './al/data/index.vue?raw'
import messageSource from './message/center/index.vue?raw'
import * as roster from './MyOrg/rosterSession'
import * as cursor from './al/data/cursorPager'
import { compareInt64Desc } from '@/utils/int64'

[homeSource, orgSource, alSource, messageSource].forEach(preparePage)

const query = () => ({ data: ref<any>(undefined), error: ref<any>(null), isError: ref(false), isLoading: ref(false), refetch: vi.fn() })
describe('窄范围失败与成功空态', () => {
  it('首页分来源失败不显示为零，成功空集仍显示零', async () => {
    const api = { listTicketsApi: vi.fn().mockRejectedValue(httpError(503, '工单暂不可用')) }
    const { page, lifecycle } = setupPage(homeSource, {
      '@/api/ticket': api, 'element-plus': {}, 'vue-router': { useRouter: () => ({}) },
      '@/common/auth': { usePermission: () => ({ hasPerm: () => true, hasRoute: () => true }) },
    })
    await lifecycle.mount()
    expect(page.stats.value.open).toBeNull()
    expect(page.myTodo.value).toBeNull()
    expect(page.recentError?.value ?? '').toContain('工单暂不可用')
    api.listTicketsApi.mockResolvedValue({ list: [], total: 0 })
    await page.loadHome()
    expect(page.stats.value.open).toBe(0)
    expect(page.myTodo.value).toBe(0)
    expect(page.recentError.value).toBe('')
  })
  it('首页没有工单列表页面访问权限不发请求，各卡显示无权状态', async () => {
    const api = { listTicketsApi: vi.fn() }
    const { page, lifecycle } = setupPage(homeSource, { '@/api/ticket': api, 'element-plus': {}, 'vue-router': { useRouter: () => ({}) }, '@/common/auth': { usePermission: () => ({ hasPerm: () => false, hasRoute: () => false }) } })
    await lifecycle.mount()
    expect(api.listTicketsApi).not.toHaveBeenCalled()
    expect(page.recentError?.value ?? '').toContain('无权')
    expect(page.statErrors.value.open).toContain('无权')
    expect(page.todoError.value).toContain('无权')
    expect(page.doneError.value).toContain('无权')
  })
  it('MyOrg 首次读取失败不会落未入组，可重试', async () => {
    const api = { getMyOrgsApi: vi.fn().mockRejectedValueOnce(httpError(503, '组织故障')).mockResolvedValueOnce([]) }
    const { page } = setupPage(orgSource, { '@/api/org/selfService': api, './rosterSession': roster, 'element-plus': {} })
    await settle()
    expect(page.orgsError?.value ?? '').toContain('组织故障')
    await page.loadOrgs()
    expect(page.orgsError.value).toBe('')
    expect(page.orgs.value).toEqual([])
  })
  it('活动数据失败保留持续错误，重试空集清错误', async () => {
    const api = { listAlDataApi: vi.fn().mockRejectedValueOnce(httpError(403)).mockResolvedValueOnce({ list: [], page_size: 20, next_cursor: null }) }
    const { page } = setupPage(alSource, { '@/api/al': api, './cursorPager': cursor, 'element-plus': {}, 'vue-router': { useRouter: () => ({}) }, '@tanstack/vue-query': { useQuery: () => query() } })
    page.selectedType.value = 'synthetic'
    await settle()
    expect(page.listError?.value ?? '').toContain('无权')
    await page.fetchPage(null)
    expect(page.listError.value).toBe('')
    expect(page.list.value).toEqual([])
  })
  it('消息和待办错误不显示缓存旧行或成功空态', () => {
    const inbox = query(), todos = query()
    const queries = [inbox, todos]
    const { page } = setupPage(messageSource, {
      'element-plus': {}, 'vue-router': { useRouter: () => ({}) }, '@/api/message': {}, '@/api/ticket': {}, '@/utils/int64': { compareInt64Desc },
      '@tanstack/vue-query': { useQuery: () => queries.shift(), useQueryClient: () => ({}) },
    })
    inbox.data.value = { list: [{ id: 'a' }], total: 1 }
    inbox.error.value = httpError(403)
    inbox.isError.value = true
    todos.error.value = httpError(503, '待办故障')
    todos.isError.value = true
    expect(page.inboxError?.value ?? '').toContain('无权')
    expect(page.inboxRows?.value).toEqual([])
    expect(page.todoError?.value ?? '').toContain('待办故障')
    inbox.error.value = null
    inbox.isError.value = false
    inbox.data.value = { list: [], total: 0 }
    expect(page.inboxError.value).toBe('')
    expect(page.inboxRows.value).toEqual([])
  })
  it('待办读取固定请求页，不使用 await 后的新页切片', async () => {
    const options: any[] = []
    const pending = deferred()
    const listTicketsApi = vi.fn().mockImplementation(async ({ status }: { status: string }) => { await pending.promise; return { list: [{ id: status === 'assigned' ? '9' : '8' }], total: 1 } })
    const { page } = setupPage(messageSource, {
      'element-plus': {}, 'vue-router': { useRouter: () => ({}) }, '@/api/message': {}, '@/api/ticket': { listTicketsApi }, '@/utils/int64': { compareInt64Desc },
      '@tanstack/vue-query': { useQuery: (opts: unknown) => { options.push(opts); return query() }, useQueryClient: () => ({}) },
    })
    const loading = options[1].queryFn()
    page.todoPage.value = 2
    pending.resolve({ list: [{ id: '9' }, { id: '8' }], total: 2 })
    const data = await loading
    expect(data.list).toHaveLength(2)
    expect(data.list.map((r: { id: string }) => r.id)).toEqual(['9', '8'])
  })
})

it('活动类型读取失败保留最近定义，与成功无匹配分开', async () => {
  const types = query()
  types.data.value = { list: [{ type_name: 'stale', status: 'active', fields: [], created_at: '' }] }
  const { page } = setupPage(alSource, { '@/api/al': {}, './cursorPager': cursor, 'element-plus': {}, 'vue-router': { useRouter: () => ({}) }, '@tanstack/vue-query': { useQuery: () => types } })
  expect(page.allTypes.value).toHaveLength(1)
  types.isError.value = true
  types.error.value = httpError(403)
  await settle()
  expect(page.allTypes.value).toHaveLength(1)
  expect(page.typesError?.value ?? '').toContain('无权')
  types.isError.value = false
  types.error.value = null
  types.data.value = { list: [] }
  await settle()
  expect(page.allTypes.value).toEqual([])
  expect(page.typesError.value).toBe('')
})

it('MyOrg 离开后旧组织回包不恢复名册，返回重读当前列表', async () => {
  const old = deferred()
  const api = { getMyOrgsApi: vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce([]) }
  const { page, lifecycle } = setupPage(orgSource, { '@/api/org/selfService': api, './rosterSession': roster, 'element-plus': {} })
  lifecycle.deactivate()
  old.resolve([{ org_id: '42', org_name: '旧组织' }])
  await settle()
  expect(page.orgs.value).toEqual([])
  lifecycle.activate()
  await settle()
  expect(api.getMyOrgsApi).toHaveBeenCalledTimes(2)
  expect(page.orgs.value).toEqual([])
})


it('首页按工单列表入口访问读取八组数据，不要求详情按钮权限', async () => {
  const api = { listTicketsApi: vi.fn().mockResolvedValue({ list: [], total: 0 }) }
  const hasRoute = vi.fn((path: string) => path === '/tickets')
  const { page, lifecycle } = setupPage(homeSource, {
    '@/api/ticket': api, 'element-plus': {}, 'vue-router': { useRouter: () => ({}) },
    '@/common/auth': { usePermission: () => ({ hasPerm: () => false, hasRoute }) },
  })
  await lifecycle.mount()
  expect(hasRoute).toHaveBeenCalledWith('/tickets')
  expect(api.listTicketsApi).toHaveBeenCalledTimes(8)
  expect(page.stats.value).toEqual({ open: 0, assigned: 0, in_progress: 0, closed: 0 })
  expect(page.myTodo.value).toBe(0)
  expect(page.myDone.value).toBe(0)
  expect(page.recentError.value).toBe('')
})

it('首页服务端真实403只标记失败来源，其余成功空集仍显示零', async () => {
  const listTicketsApi = vi.fn().mockImplementation(async (params: { status?: string, assignee?: string, page_size: number }) => {
    if ((!params.assignee && params.status === 'open') || params.page_size === 10) throw httpError(403)
    return { list: [], total: 0 }
  })
  const { page, lifecycle } = setupPage(homeSource, {
    '@/api/ticket': { listTicketsApi }, 'element-plus': {}, 'vue-router': { useRouter: () => ({}) },
    '@/common/auth': { usePermission: () => ({ hasPerm: () => false, hasRoute: () => true }) },
  })
  await lifecycle.mount()
  expect(page.stats.value.open).toBeNull()
  expect(page.statErrors.value.open).toContain('无权')
  expect(page.stats.value.assigned).toBe(0)
  expect(page.statErrors.value.assigned).toBeUndefined()
  expect(page.myTodo.value).toBe(0)
  expect(page.myDone.value).toBe(0)
  expect(page.recentError.value).toContain('无权')
})

it('MyOrg 返回或重试仍在相同组织和页码，组织消失时才回退首页', async () => {
  const memberships = [{ org_id: '11', org_name: '合成甲组' }, { org_id: '12', org_name: '合成乙组' }]
  const api = {
    getMyOrgsApi: vi.fn().mockResolvedValue(memberships),
    getOrgRosterApi: vi.fn().mockResolvedValue({ list: [], total: 80 }),
  }
  const { page, lifecycle } = setupPage(orgSource, {
    '@/api/org/selfService': api, './rosterSession': roster, 'element-plus': {},
  })
  await settle()
  await page.roster.selectOrg('12')
  await page.roster.selectPage(3)
  lifecycle.deactivate()
  lifecycle.activate()
  await settle()
  expect(page.state).toMatchObject({ orgId: '12', page: 3, status: 'ready' })
  expect(api.getOrgRosterApi).toHaveBeenLastCalledWith('12', 3, 20)

  api.getMyOrgsApi.mockRejectedValueOnce(httpError(503))
  await page.loadOrgs()
  expect(page.orgsError.value).not.toBe('')
  await page.loadOrgs()
  await settle()
  expect(page.state).toMatchObject({ orgId: '12', page: 3, status: 'ready' })

  api.getMyOrgsApi.mockResolvedValue([memberships[0]])
  await page.loadOrgs()
  await settle()
  expect(page.state).toMatchObject({ orgId: '11', page: 1, status: 'ready' })
  expect(api.getOrgRosterApi).toHaveBeenLastCalledWith('11', 1, 20)
})

/**
 * 请求层刷新分流 + 401 会话拆除单测（01 §3.3 / P1-4）
 *
 * 覆盖：
 *  - 单飞刷新（并发 401 只发一次）
 *  - 刷新终态语义（终态码族 / 网络 / 5xx）
 *  - **401 终态 → 彻底拆除会话（token + 权限动态路由 + isAddRouters + tagsView + rawMenus）**
 *  - **非终态（5xx / 网络）→ 会话与路由状态全保留、不跳登录**
 *  - **拆除后 ensureDynamicRoutes 会再次执行（钉死跨用户不重注册缺陷）**
 *  - 401+20003 直接清会话（不刷新）；403+20007 跳改密页且不清会话
 *
 * 用真 store（setActivePinia）+ 打桩 @/router（避免真实 router 的 DOM 依赖），
 * vi.mock('axios') 造响应。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { store } from '@/store'
import { useUserStoreWithOut } from '@/store/modules/user'
import { usePermissionStore } from '@/store/modules/permission'
import { useTagsViewStore, type TagView } from '@/store/modules/tagsView'
import { ensureDynamicRoutes } from '@/permission'
import { singleFlightRefresh, refreshAccessToken } from '@/common/request/src'
import { setTokens, getAccessToken, clearTokens } from '@/common/auth/tokenStorage'
import { notifyError } from '@/common/request/errorToast'

// 打桩 errorToast（node 环境其内部 typeof document 短路——不打桩则拦截器接线零断言可抓，
// 删掉接线处 75/75 仍绿是检视 P2-1 实锤的静默回归洞）
vi.mock('@/common/request/errorToast', () => ({ notifyError: vi.fn() }))

const h = vi.hoisted(() => {
  const post = vi.fn()
  const service: any = vi.fn(() => Promise.resolve('replayed'))
  const handlers: { err?: (error: any) => Promise<any> } = {}
  return { post, service, handlers }
})

const routerMock = vi.hoisted(() => ({
  addRoute: vi.fn(),
  resetRouter: vi.fn(),
  getRoutes: vi.fn(() => [] as unknown[]),
}))

vi.mock('axios', () => ({
  default: {
    create: () => {
      h.service.interceptors = {
        request: { use: () => {} },
        response: {
          use: (_onFulfilled: any, onRejected: any) => {
            h.handlers.err = onRejected
          },
        },
      }
      return h.service
    },
    post: h.post,
  },
}))

// 打桩 vue-router 实例（避免 createWebHashHistory 的 DOM 依赖）；导出面与真实 '@/router' 对齐
vi.mock('@/router', () => ({
  __esModule: true,
  default: {
    addRoute: routerMock.addRoute,
    getRoutes: routerMock.getRoutes,
    hasRoute: () => false,
    beforeEach: () => {},
    afterEach: () => {},
  },
  resetRouter: routerMock.resetRouter,
  constantRouterMap: [],
}))

/** 伪 window：让 _redirectToLogin 可被观测（node 环境默认无 window） */
const fakeWindow = { location: { hash: '#/home' } }

const makeError = (status: number, code?: number) => ({
  config: { headers: {} as Record<string, string>, url: '/api/v1/x' },
  response: { status, data: code === undefined ? {} : { code } },
})

const homeMenu = { code: 'home', name: '首页', menu_type: 1, path: '/home', component: 'home', icon: 'home', sort_order: 0, visible: true }

/** 造「上一个用户」的残留会话（token + 用户态 + 已注册的动态路由 + 标签页 + 菜单缓存） */
const seedSession = () => {
  const userStore = useUserStoreWithOut()
  setTokens({ access_token: 'old', refresh_token: 'RT' })
  userStore.rawMenus = [homeMenu]
  userStore.permissions = ['route:/home']
  userStore.profile = { id: '1' } as any
  userStore.mustChangePassword = false
  userStore.sessionLoaded = true

  const permStore = usePermissionStore()
  permStore.isAddRouters = true
  permStore.routers = [{ path: '/home' } as any]
  permStore.addRouters = [{ path: '/home' } as any]

  useTagsViewStore().visitedViews = [
    { path: '/home', fullPath: '/home', query: {}, hash: '', affix: false, noCache: false } satisfies TagView,
  ]
}

beforeEach(() => {
  setActivePinia(store)
  vi.stubGlobal('window', fakeWindow)
  fakeWindow.location.hash = '#/home'
  localStorage.clear()
  clearTokens()
  useUserStoreWithOut().resetState() // 彻底拆除（含 permission/tagsView），保证用例隔离
  h.post.mockReset()
  h.service.mockClear()
  routerMock.addRoute.mockClear()
  routerMock.resetRouter.mockClear()
  vi.mocked(notifyError).mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('refreshAccessToken —— 终态语义', () => {
  it('成功刷新：写入新 TokenPair，terminal=false', async () => {
    setTokens({ access_token: 'old', refresh_token: 'RT' })
    h.post.mockResolvedValue({ data: { code: 0, data: { access_token: 'new', refresh_token: 'RT2' } } })
    expect(await refreshAccessToken()).toEqual({ token: 'new', terminal: false })
    expect(getAccessToken()).toBe('new')
  })

  it('终态：刷新失败码族（20004/20014/20015）', async () => {
    setTokens({ access_token: 'old', refresh_token: 'RT' })
    for (const code of [20004, 20014, 20015]) {
      h.post.mockRejectedValueOnce({ response: { status: 401, data: { code } } })
      expect(await refreshAccessToken()).toEqual({ token: null, terminal: true })
    }
  })

  it('非终态：网络断开（无 HTTP 响应）', async () => {
    setTokens({ access_token: 'old', refresh_token: 'RT' })
    h.post.mockRejectedValue(new Error('network down'))
    expect(await refreshAccessToken()).toEqual({ token: null, terminal: false })
  })

  it('非终态：5xx（Redis 抖动 503+10008）', async () => {
    setTokens({ access_token: 'old', refresh_token: 'RT' })
    h.post.mockRejectedValue({ response: { status: 503, data: { code: 10008 } } })
    expect(await refreshAccessToken()).toEqual({ token: null, terminal: false })
  })

  it('无 RT → 终态', async () => {
    clearTokens()
    expect(await refreshAccessToken()).toEqual({ token: null, terminal: true })
  })
})

describe('singleFlightRefresh —— 单飞', () => {
  it('并发 401 只发一次 refresh', async () => {
    setTokens({ access_token: 'old', refresh_token: 'RT' })
    let resolvePost: (v: unknown) => void = () => {}
    h.post.mockImplementation(() => new Promise((resolve) => { resolvePost = resolve }))

    const first = singleFlightRefresh()
    const second = singleFlightRefresh()
    resolvePost({ data: { code: 0, data: { access_token: 'new', refresh_token: 'RT2' } } })

    const [a, b] = await Promise.all([first, second])
    expect(h.post).toHaveBeenCalledTimes(1)
    expect(a).toEqual({ token: 'new', terminal: false })
    expect(b).toEqual({ token: 'new', terminal: false })
    expect(a).toBe(b) // 同一 Promise 引用
  })
})

describe('响应拦截器 401 分支', () => {
  it('终态刷新失败 → 彻底拆除会话（token + 权限路由 + tagsView + rawMenus）+ 跳登录', async () => {
    seedSession()
    h.post.mockRejectedValue({ response: { status: 401, data: { code: 20004 } } })
    const error = makeError(401, 20002)
    await expect(h.handlers.err?.(error)).rejects.toBe(error)
    // 终态失败**不得**打 transient 标记（否则下游 classifier 会误判保留会话）
    expect((error as { __sessionTransient?: boolean }).__sessionTransient).toBeUndefined()

    expect(getAccessToken()).toBeNull()
    expect(usePermissionStore().isAddRouters).toBe(false)
    expect(usePermissionStore().routers).toEqual([])
    expect(usePermissionStore().addRouters).toEqual([])
    expect(useTagsViewStore().visitedViews).toEqual([])
    expect(useUserStoreWithOut().rawMenus).toEqual([])
    expect(useUserStoreWithOut().sessionLoaded).toBe(false)
    expect(routerMock.resetRouter).toHaveBeenCalled()
    expect(fakeWindow.location.hash).toContain('/login')
  })

  it('非终态（503+10008）→ 会话与路由状态全保留，不跳登录', async () => {
    seedSession()
    h.post.mockRejectedValue({ response: { status: 503, data: { code: 10008 } } })
    const error = makeError(401, 20002)
    await expect(h.handlers.err?.(error)).rejects.toBe(error)
    // 请求层给原始 401 打标：refresh 端点非终态失败 → 下游 classifier 保留会话（§3.3 红线）
    expect((error as { __sessionTransient?: boolean }).__sessionTransient).toBe(true)

    expect(getAccessToken()).toBe('old')
    expect(usePermissionStore().isAddRouters).toBe(true)
    expect(useUserStoreWithOut().rawMenus).toHaveLength(1)
    expect(useTagsViewStore().visitedViews).toHaveLength(1)
    expect(routerMock.resetRouter).not.toHaveBeenCalled()
    expect(fakeWindow.location.hash).toBe('#/home') // 未跳登录
  })

  it('非终态（网络错误）→ 会话与路由状态全保留，不跳登录', async () => {
    seedSession()
    h.post.mockRejectedValue(new Error('down'))
    const error = makeError(401, 20002)
    await expect(h.handlers.err?.(error)).rejects.toBe(error)
    expect((error as { __sessionTransient?: boolean }).__sessionTransient).toBe(true)

    expect(getAccessToken()).toBe('old')
    expect(usePermissionStore().isAddRouters).toBe(true)
    expect(routerMock.resetRouter).not.toHaveBeenCalled()
    expect(fakeWindow.location.hash).toBe('#/home')
  })

  it('拆除后 ensureDynamicRoutes 会再次执行（isAddRouters 归 false → 重新 addRoute）', async () => {
    const permStore = usePermissionStore()
    const userStore = useUserStoreWithOut()
    // 模拟上一会话已注册
    permStore.isAddRouters = true
    permStore.routers = [{ path: '/stale' } as any]

    // 会话拆除
    userStore.resetState()
    expect(permStore.isAddRouters).toBe(false)
    expect(permStore.routers).toEqual([])

    // 新用户菜单 → 应重新注册（不再因 isAddRouters 提前 return）
    userStore.rawMenus = [homeMenu]
    routerMock.addRoute.mockClear()
    const executed = await ensureDynamicRoutes()
    expect(executed).toBe(true)
    expect(routerMock.addRoute).toHaveBeenCalled()
    expect(permStore.isAddRouters).toBe(true)
  })

  it('刷新成功后重放一次；重放仍 401 → 不再刷新（上限 1 次）', async () => {
    setTokens({ access_token: 'old', refresh_token: 'RT' })
    h.post.mockResolvedValue({ data: { code: 0, data: { access_token: 'new', refresh_token: 'RT2' } } })
    const error = makeError(401, 20002)

    const result = await h.handlers.err?.(error)
    expect(result).toBe('replayed')
    expect(h.post).toHaveBeenCalledTimes(1)
    expect((error.config as any)._retry).toBe(true)
    expect(h.service).toHaveBeenCalledWith(error.config)

    h.post.mockClear()
    h.service.mockClear()
    await expect(h.handlers.err?.(error)).rejects.toBe(error)
    expect(h.post).not.toHaveBeenCalled()
    expect(h.service).not.toHaveBeenCalled()
    // 重放仍 401 → _retry 终态路径，同样不得打 transient 标记
    expect((error as { __sessionTransient?: boolean }).__sessionTransient).toBeUndefined()
  })

  it('401+20003 无效令牌 → 直接清会话（不刷新）', async () => {
    seedSession()
    await expect(h.handlers.err?.(makeError(401, 20003))).rejects.toBeTruthy()
    expect(h.post).not.toHaveBeenCalled()
    expect(getAccessToken()).toBeNull()
    expect(usePermissionStore().isAddRouters).toBe(false)
  })

  it('403+20007 强制改密 → 跳改密页且不清会话', async () => {
    seedSession()
    await expect(h.handlers.err?.(makeError(403, 20007))).rejects.toBeTruthy()
    expect(fakeWindow.location.hash).toContain('/change-password')
    expect(getAccessToken()).toBe('old')
    expect(usePermissionStore().isAddRouters).toBe(true)
    expect(useUserStoreWithOut().rawMenus).toHaveLength(1)
  })

  it('全局提示接线：generic 5xx → notifyError(error)', async () => {
    const error = makeError(500, 50000)
    await expect(h.handlers.err?.(error)).rejects.toBe(error)
    expect(notifyError).toHaveBeenCalledWith(error)
  })

  it('全局提示接线：401 终态（20003）→ 不走全局提示（会话链路处置）', async () => {
    seedSession()
    const error = makeError(401, 20003)
    await expect(h.handlers.err?.(error)).rejects.toBe(error)
    expect(notifyError).not.toHaveBeenCalled()
  })

  it('全局提示接线：refresh 非终态 → notifyError（transient 提示可重试）', async () => {
    seedSession()
    h.post.mockRejectedValue({ response: { status: 503, data: { code: 10008 } } })
    const error = makeError(401, 20002)
    await expect(h.handlers.err?.(error)).rejects.toBe(error)
    expect(notifyError).toHaveBeenCalledWith(error)
  })

  it('全局提示接线：403+20007 → 不走全局提示（跳改密页）', async () => {
    seedSession()
    const error = makeError(403, 20007)
    await expect(h.handlers.err?.(error)).rejects.toBe(error)
    expect(notifyError).not.toHaveBeenCalled()
  })
})

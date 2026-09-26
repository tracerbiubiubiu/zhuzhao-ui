/**
 * 请求层刷新分流单测（01 §3.3 / P1-4）
 *
 * 覆盖：单飞刷新（并发 401 只发一次）、终态清会话、网络/5xx 保会话、重放上限 1 次。
 * 用 vi.mock('axios') 造响应；user store 打桩避免拉起 router/DOM。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { singleFlightRefresh, refreshAccessToken } from '@/common/request/src'
import { setTokens, getAccessToken, clearTokens } from '@/common/auth/tokenStorage'

const h = vi.hoisted(() => {
  const post = vi.fn()
  const service: any = vi.fn(() => Promise.resolve('replayed'))
  const handlers: { err?: (error: any) => Promise<any> } = {}
  return { post, service, handlers }
})

vi.mock('@/store/modules/user', () => ({
  useUserStoreWithOut: () => ({ resetState: () => {} }),
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

const make401 = (bizCode = 20002) => ({
  config: { headers: {} as Record<string, string>, url: '/api/v1/x' },
  response: { status: 401, data: { code: bizCode } },
})

describe('refreshAccessToken —— 终态语义', () => {
  beforeEach(() => {
    localStorage.clear()
    clearTokens()
    h.post.mockReset()
  })

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
  beforeEach(() => {
    localStorage.clear()
    clearTokens()
    h.post.mockReset()
  })

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
  beforeEach(() => {
    localStorage.clear()
    clearTokens()
    h.post.mockReset()
    h.service.mockClear()
  })

  it('终态刷新失败 → 清会话', async () => {
    setTokens({ access_token: 'old', refresh_token: 'RT' })
    h.post.mockRejectedValue({ response: { status: 401, data: { code: 20015 } } })
    const error = make401()
    await expect(h.handlers.err?.(error)).rejects.toBe(error)
    expect(getAccessToken()).toBeNull()
  })

  it('非终态刷新失败（网络）→ 保留会话', async () => {
    setTokens({ access_token: 'old', refresh_token: 'RT' })
    h.post.mockRejectedValue(new Error('down'))
    const error = make401()
    await expect(h.handlers.err?.(error)).rejects.toBe(error)
    expect(getAccessToken()).toBe('old')
  })

  it('刷新成功后重放一次；重放仍 401 → 不再刷新（上限 1 次）', async () => {
    setTokens({ access_token: 'old', refresh_token: 'RT' })
    h.post.mockResolvedValue({ data: { code: 0, data: { access_token: 'new', refresh_token: 'RT2' } } })
    const error = make401()

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
  })
})

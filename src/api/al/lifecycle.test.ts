import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from '@vea/request'
import { deleteAlDataApi, restoreAlDataApi } from './index'

vi.mock('@vea/request', () => ({ default: { post: vi.fn() } }))

// 网络边界保持替身，执行真实 API 封装并检查发送的精确载荷。
describe('AL 生命周期请求版本合同', () => {
  beforeEach(() => vi.mocked(request.post).mockReset())

  it.each([
    ['delete', '/al/api/v1/data/synthetic%20type/9007199254740993/delete', { version: 7 }],
    ['restore', '/al/api/v1/data/restore', { type_name: 'synthetic type', id: '9007199254740993', version: 7 }],
  ] as const)('%s 发送 JSON number version 与精确字符串 ID', async (action, path, body) => {
    const call = action === 'delete' ? deleteAlDataApi : restoreAlDataApi
    await call('synthetic type', '9007199254740993', 7)
    expect(request.post).toHaveBeenCalledExactlyOnceWith(path, body, { _silentError: true })
  })

  it.each(['delete', 'restore'] as const)('%s 省略 version 保持旧请求兼容，409 原样抛出且只发一次', async (action) => {
    const call = action === 'delete' ? deleteAlDataApi : restoreAlDataApi
    const conflict = { response: { status: 409, data: { code: 100008, message: 'version mismatch' } } }
    vi.mocked(request.post).mockRejectedValueOnce(conflict)
    await expect(call('synthetic', '9007199254740993')).rejects.toBe(conflict)
    expect(request.post).toHaveBeenCalledTimes(1)
    expect(vi.mocked(request.post).mock.lastCall?.[1]).toEqual(action === 'delete' ? {} : { type_name: 'synthetic', id: '9007199254740993' })
  })
})

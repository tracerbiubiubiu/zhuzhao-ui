import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from '@vea/request'
import { getUserStatusResultApi, updateUserStatusApi } from './user'

vi.mock('@vea/request', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
const key = '00000000-0000-4000-8000-000000000001'
beforeEach(() => vi.clearAllMocks())

describe('C05 状态操作 wire 适配', () => {
  it('发送原K且保留旧成功null，传输不自行重试', async () => {
    vi.mocked(request.post).mockResolvedValue(null as never)
    expect(await updateUserStatusApi('12', 0, key)).toBeNull()
    expect(request.post).toHaveBeenCalledExactlyOnceWith('/api/v1/users/status', { user_id: '12', status: 0 }, {
      headers: { 'X-Operation-ID': key }, _silentError: true,
    })
  })
  it('GET只按原K查询，严格校验回执绑定并保留大整数epoch', async () => {
    vi.mocked(request.get).mockResolvedValue({ operation_id: key, status: 'completed', account_status: 0, session_epoch: '9007199254740993', projection_state: 'pending' } as never)
    expect(await getUserStatusResultApi(key)).toEqual({ operation_id: key, status: 0, epoch: '9007199254740993', projection_state: 'pending' })
    expect(request.get).toHaveBeenCalledWith('/api/v1/users/status/result', { params: { operation_id: key }, _silentError: true })
  })
  it('未知2xx正文不能冒充旧null提交成功', async () => {
    vi.mocked(request.post).mockResolvedValue({ code: 10008 } as never)
    await expect(updateUserStatusApi('12', 0, key)).rejects.toThrow('待核查')
  })
  it.each([
    null, {},
    { operation_id: 'other', status: 0, epoch: '1', projection_state: 'completed' },
    { operation_id: key, status: 2, epoch: '1', projection_state: 'completed' },
    { operation_id: key, status: 0, epoch: 9007199254740992, projection_state: 'completed' },
    { operation_id: key, status: 0, epoch: '0', projection_state: 'completed' },
    { operation_id: key, status: 0, epoch: '1', projection_state: 'unknown' },
  ])('坏回执不得冒充已提交：%j', async (data) => {
    vi.mocked(request.get).mockResolvedValue(data as never)
    await expect(getUserStatusResultApi(key)).rejects.toThrow('回执')
  })
})

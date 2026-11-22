import { describe, expect, it, vi } from 'vitest'
import { createStatusOperation } from './statusOperation'
import type { UserStatusResult } from '@/api/system/user'

const key = '00000000-0000-4000-8000-000000000001'
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture() {
  let generation = 1
  let permitted = true
  const values = new Map<string, string>()
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: vi.fn((k: string, v: string) => { values.set(k, v) }) }
  const deps = {
    principalId: '11', storage, generation: () => generation, hasPermission: () => permitted,
    newKey: vi.fn(() => key),
    write: vi.fn(async (_id: string, _status: 0 | 1, _key: string): Promise<null> => null),
    read: vi.fn(async (_key: string): Promise<UserStatusResult> => ({ operation_id: key, status: 0, epoch: '2', projection_state: 'pending' })),
  }
  return { deps, values, controller: createStatusOperation(deps), switchSession: () => { generation++ }, deny: () => { permitted = false } }
}

describe('C05 原K操作与结果核查', () => {
  it('发出前持久保留K，双击只写一次；null只证明提交，不伪造投影完成', async () => {
    const { controller: c, deps, values } = fixture()
    const pending = deferred<null>()
    deps.write.mockImplementation(() => {
      expect([...values.values()][0]).toContain(key)
      return pending.promise
    })
    const first = c.submit('12', 0)
    await c.submit('12', 0)
    expect(c.state.operation?.operationId).toBe(key)
    expect(c.blocked()).toBe(true)
    pending.resolve(null)
    await first
    expect(c.state.operation?.phase).toBe('submitted')
    expect(c.state.result).toBeNull()
    await c.submit('13', 1)
    expect(deps.write).toHaveBeenCalledExactlyOnceWith('12', 0, key)
    expect(deps.newKey).toHaveBeenCalledTimes(1)
  })
  it('丢响应保留待核查，重建控件仍不能换K；只GET原K，pending确认已提交待恢复', async () => {
    const { controller: c, deps } = fixture()
    deps.write.mockRejectedValueOnce(new Error('network'))
    await c.submit('12', 0)
    expect(c.state.operation?.phase).toBe('unknown')
    const reopened = createStatusOperation(deps)
    await reopened.submit('12', 0)
    expect(deps.write).toHaveBeenCalledTimes(1)
    await reopened.query(key)
    expect(deps.read).toHaveBeenCalledExactlyOnceWith(key)
    expect(reopened.state.operation?.phase).toBe('pending')
    expect(reopened.state.result?.epoch).toBe('2')
    expect(reopened.blocked()).toBe(true)
  })
  it.each([403, 404, 503])('查询失败HTTP %i不证明原操作未提交，继续原K待核查', async (status) => {
    const { controller: c, deps } = fixture()
    deps.write.mockRejectedValueOnce(new Error('lost'))
    await c.submit('12', 0)
    deps.read.mockRejectedValueOnce({ response: { status, data: { message: '合成拒绝' } } })
    await c.query(key)
    expect(c.state.operation?.phase).toBe('unknown')
    expect(c.state.operation?.operationId).toBe(key)
    expect(c.state.error).toBeTruthy()
    expect(c.blocked()).toBe(true)
    await c.query('different-key')
    expect(deps.read).toHaveBeenCalledTimes(1)
  })
  it('手工查无回执时保留此前记录，不把误输的键当成已发出的写入', async () => {
    const { controller: c, deps, values } = fixture()
    await c.submit('12', 0)
    deps.read.mockResolvedValueOnce({ operation_id: key, status: 0, epoch: '2', projection_state: 'completed' })
    await c.query(key)
    const prior = [...values.values()][0]
    deps.read.mockRejectedValueOnce({ response: { status: 404 } })
    await c.query('00000000-0000-4000-8000-000000000009')
    expect(c.state.operation?.operationId).toBe(key)
    expect(c.state.error).toBeTruthy()
    expect(c.blocked()).toBe(false)
    expect([...values.values()][0]).toBe(prior)
    expect(deps.write).toHaveBeenCalledTimes(1)
  })
  it('仅有效completed回执解除待恢复，反向动作要新意图和新K', async () => {
    const { controller: c, deps } = fixture()
    await c.submit('12', 0)
    deps.read.mockResolvedValueOnce({ operation_id: key, status: 0, epoch: '2', projection_state: 'completed' })
    await c.query(key)
    expect(c.blocked()).toBe(false)
    deps.newKey.mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
    await c.submit('12', 1)
    expect(deps.write).toHaveBeenLastCalledWith('12', 1, '00000000-0000-4000-8000-000000000002')
  })
  it('确定权限拒绝与普通503分开；503不宣称已提交或零提交', async () => {
    const { controller: c, deps } = fixture()
    deps.write.mockRejectedValueOnce({ response: { status: 403, data: { code: 30001 } } })
    await c.submit('12', 0)
    expect(c.state.operation?.phase).toBe('rejected')
    deps.write.mockRejectedValueOnce({ response: { status: 503, data: { code: 10008 } } })
    await c.submit('12', 0)
    expect(c.state.operation?.phase).toBe('unknown')
    expect(c.state.result).toBeNull()
  })
  it('丢失权限时零写零查询；K存储失败时零安全写', async () => {
    const f = fixture()
    f.deny()
    await f.controller.submit('12', 0)
    await f.controller.query(key)
    expect(f.deps.write).not.toHaveBeenCalled()
    expect(f.deps.read).not.toHaveBeenCalled()
    const g = fixture()
    g.deps.storage.setItem.mockImplementation(() => { throw new Error('quota') })
    await g.controller.submit('12', 0)
    expect(g.deps.write).not.toHaveBeenCalled()
    expect(g.controller.state.error).toContain('保存')
  })
  it('查询进行时失去权限，不能展示回执或解除待核查', async () => {
    const f = fixture()
    await f.controller.submit('12', 0)
    const read = deferred<UserStatusResult>()
    f.deps.read.mockReturnValueOnce(read.promise)
    const pending = f.controller.query(key)
    f.deny()
    read.resolve({ operation_id: key, status: 0, epoch: '2', projection_state: 'completed' })
    await pending
    expect(f.controller.state.result).toBeNull()
    expect(f.controller.blocked()).toBe(true)
  })
  it('旧写与旧查询晚到不得改变后来会话或覆盖回执', async () => {
    const f = fixture()
    const write = deferred<null>()
    f.deps.write.mockReturnValueOnce(write.promise)
    const pending = f.controller.submit('12', 0)
    f.switchSession()
    write.resolve(null)
    await pending
    expect(f.controller.state.operation?.phase).toBe('unknown')
    expect(f.controller.state.result).toBeNull()
    const g = fixture()
    await g.controller.submit('12', 0)
    const read = deferred<UserStatusResult>()
    g.deps.read.mockReturnValueOnce(read.promise)
    const query = g.controller.query(key)
    g.switchSession()
    read.resolve({ operation_id: key, status: 0, epoch: '2', projection_state: 'completed' })
    await query
    expect(g.controller.state.result).toBeNull()
    expect(g.controller.blocked()).toBe(true)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { createPasswordSubmission } from './passwordSubmission'

const key = '00000000-0000-4000-8000-000000000003'
function fixture() {
  let generation = 1
  const values = new Map<string, string>()
  const deps = {
    storage: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) } },
    generation: () => generation, newKey: () => key,
    change: vi.fn(async (_old: string, _next: string, _key: string) => {}),
  }
  return { deps, values, c: createPasswordSubmission(deps), switchSession: () => { generation++ } }
}

describe('C05 自助改密结果准备', () => {
  it('先保留K，不持久保存口令；丢响应禁止换号重发，重开仍提示待核查', async () => {
    const { c, deps, values } = fixture()
    deps.change.mockImplementationOnce(async () => {
      expect([...values.values()][0]).toContain(key)
      throw new Error('lost')
    })
    expect(await c.submit('synthetic-old', 'synthetic-new')).toBe(false)
    expect(c.state.phase).toBe('unknown')
    expect(c.state.message).toContain('待核查')
    expect([...values.values()].join()).not.toContain('synthetic')
    await c.submit('synthetic-old', 'synthetic-B')
    const reopened = createPasswordSubmission(deps)
    await reopened.submit('synthetic-old', 'synthetic-B')
    expect(deps.change).toHaveBeenCalledExactlyOnceWith('synthetic-old', 'synthetic-new', key)
    expect(reopened.blocked()).toBe(true)
  })
  it('普通503不伪造已提交事实，也不重置会话；确定拒绝允许用户重新确认', async () => {
    const { c, deps } = fixture()
    deps.change.mockRejectedValueOnce({ response: { status: 400, data: { code: 10001, message: '合成参数拒绝' } } })
    await c.submit('synthetic-old', 'synthetic-new')
    expect(c.state.phase).toBe('rejected')
    expect(c.blocked()).toBe(false)
    deps.change.mockRejectedValueOnce({ response: { status: 503, data: { code: 10008 } } })
    await c.submit('synthetic-old', 'synthetic-new')
    expect(c.state.phase).toBe('unknown')
    expect(c.state.message).not.toContain('已提交')
    expect(deps.generation()).toBe(1)
  })
  it('成功TokenPair完成由store负责；重复提交不重新签发或覆盖口令', async () => {
    const { c, deps } = fixture()
    expect(await c.submit('synthetic-old', 'synthetic-new')).toBe(true)
    expect(c.state.phase).toBe('completed')
    await c.submit('synthetic-old', 'synthetic-B')
    expect(deps.change).toHaveBeenCalledTimes(1)
  })
  it('迟到成功或终态错误不能改变后来会话和页面反馈', async () => {
    const f = fixture()
    let finish!: () => void
    f.deps.change.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = f.c.submit('synthetic-old', 'synthetic-new')
    f.switchSession()
    finish()
    expect(await pending).toBe(false)
    expect(f.c.state.phase).toBe('unknown')
    const g = fixture()
    g.deps.change.mockRejectedValueOnce({ response: { status: 403, data: { code: 30003 } } })
    await g.c.submit('synthetic-old', 'synthetic-new')
    expect(g.c.state.phase).toBe('terminal')
    expect(g.c.blocked()).toBe(true)
    expect(g.c.state.message).not.toContain('稍后重试')
  })
  it('存储不可用时零改密；K读取损坏时不得创建新写', async () => {
    const f = fixture()
    f.deps.storage.setItem = () => { throw new Error('quota') }
    await f.c.submit('synthetic-old', 'synthetic-new')
    expect(f.deps.change).not.toHaveBeenCalled()
    expect(f.c.state.message).toContain('保存')
  })
})

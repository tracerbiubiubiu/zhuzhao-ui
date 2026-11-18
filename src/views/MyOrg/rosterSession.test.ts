import { describe, expect, it, vi } from 'vitest'
import { createRosterSession, ownersWithMember } from './rosterSession'

const A = '11'
const B = '12'
const member = { user_id: '123', username: '合成成员', org_member_role: 'member' }
const owner = { user_id: '9223372036854775801', org_member_role: 'owner' }
const data = (username: string, total = 90) => ({ list: [{ ...member, username }], total })
const forbidden = { response: { status: 403 } }

function fixture() {
  const load = vi.fn(async (_org: string, _page: number, _size: number) => data('合成在册成员'))
  const success = vi.fn()
  const failure = vi.fn()
  return { load, success, failure, session: createRosterSession({ load, success, failure }) }
}

describe('我的组织名册世代', () => {
  it('A→B→A：同一组织的旧成功和另一组织的旧 403 均不能覆盖新名册', async () => {
    const { load, session } = fixture()
    const firstA = Promise.withResolvers<ReturnType<typeof data>>()
    const firstB = Promise.withResolvers<ReturnType<typeof data>>()
    load.mockReturnValueOnce(firstA.promise).mockReturnValueOnce(firstB.promise).mockResolvedValueOnce(data('甲组当前名册'))

    const staleA = session.selectOrg(A)
    const staleB = session.selectOrg(B)
    await session.selectOrg(A)

    firstA.resolve(data('甲组旧名册'))
    firstB.reject(forbidden)
    await Promise.all([staleA, staleB])
    expect(session.state).toMatchObject({ orgId: A, rows: [{ username: '甲组当前名册' }], status: 'ready' })
  })

  it('同组织快速翻页：丢弃旧失败，只允许操作当前页已成功读取的行', async () => {
    const { load, session } = fixture()
    await session.selectOrg(A)
    const oldRow = session.state.rows[0]!
    const second = Promise.withResolvers<ReturnType<typeof data>>()
    const third = Promise.withResolvers<ReturnType<typeof data>>()
    load.mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise)

    const stale = session.selectPage(2)
    const current = session.selectPage(3)
    const action = vi.fn()
    await session.write(oldRow, action)
    expect(action).not.toHaveBeenCalled()
    second.reject(new Error('旧请求失败'))
    await stale
    expect(session.state).toMatchObject({ page: 3, rows: [], total: 90, status: 'loading' })

    third.resolve(data('第三页成员'))
    await current
    expect(load.mock.calls).toEqual([[A, 1, 20], [A, 2, 20], [A, 3, 20]])
    expect(session.state).toMatchObject({ page: 3, rows: [{ username: '第三页成员' }], status: 'ready' })
    await session.write(oldRow, action)
    expect(action).not.toHaveBeenCalled()
  })

  it('当前 403 为只读，当前故障显示错误并可重读', async () => {
    const { load, session } = fixture()
    load.mockRejectedValueOnce(forbidden).mockRejectedValueOnce(new Error('网络中断'))
    await session.selectOrg(A)
    expect(session.state).toMatchObject({ status: 'readonly', rows: [], total: 0 })
    await session.selectOrg(B)
    expect(session.state).toMatchObject({ status: 'error', rows: [], error: '成员名册加载失败，请重试' })
    expect(session.canEdit.value).toBe(false)
    await session.load()
    expect(session.canEdit.value).toBe(true)
  })
})

describe('我的组织写入快照', () => {
  it('确认之前取得锁，A→B→A 后拒绝晚到确认，同目标的下一次操作可以继续', async () => {
    const { session, success } = fixture()
    await session.selectOrg(A)
    const confirmation = Promise.withResolvers<void>()
    const remove = vi.fn(async (_org: string, _user: string) => {})
    const first = session.write(session.state.rows[0]!, async ({ orgId, userId, send }) => {
      await confirmation.promise
      await send(() => remove(orgId, userId))
      return '已移除'
    })
    expect(session.canEdit.value).toBe(false)
    const duplicate = vi.fn()
    await session.write(session.state.rows[0]!, duplicate)
    expect(duplicate).not.toHaveBeenCalled()

    await session.selectOrg(B)
    expect(session.canEdit.value).toBe(true)
    await session.selectOrg(A)
    confirmation.resolve()
    await first
    expect(remove).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()

    await session.write(session.state.rows[0]!, async ({ orgId, userId, send }) => {
      await send(() => remove(orgId, userId))
      return '已移除'
    })
    expect(remove).toHaveBeenCalledExactlyOnceWith(A, member.user_id)
    expect(success).toHaveBeenCalledExactlyOnceWith('已移除')
  })

  it.each(['resolve', 'reject'] as const)('旧提交 %s 不刷新另一组织或释放它的写锁', async (settle) => {
    const { load, session, success, failure } = fixture()
    await session.selectOrg(A)
    const requestA = Promise.withResolvers<void>()
    const writeA = session.write(session.state.rows[0]!, async (target) => {
      await target.send(() => requestA.promise)
      return '甲组完成'
    })
    await session.selectOrg(B)
    const requestB = Promise.withResolvers<void>()
    const writeB = session.write(session.state.rows[0]!, async (target) => {
      await target.send(() => requestB.promise)
      return '乙组完成'
    })
    if (settle === 'resolve') requestA.resolve()
    else requestA.reject(new Error('甲组失败'))
    await writeA
    expect(load).toHaveBeenCalledTimes(2)
    expect(success).not.toHaveBeenCalled()
    expect(failure).not.toHaveBeenCalled()
    expect(session.canEdit.value).toBe(false)

    requestB.resolve()
    await writeB
    expect(success).toHaveBeenCalledExactlyOnceWith('乙组完成')
    expect(load).toHaveBeenLastCalledWith(B, 1, 20)
    expect(session.canEdit.value).toBe(true)
  })

  it('回到同一组织时在已发写入兑现后读取，旧回包不替新世代提示', async () => {
    const { load, session, success } = fixture()
    await session.selectOrg(A)
    const request = Promise.withResolvers<void>()
    const write = session.write(session.state.rows[0]!, async (target) => {
      await target.send(() => request.promise)
      return '甲组旧操作完成'
    })
    await session.selectOrg(B)
    const reenter = session.selectOrg(A)
    expect(load).toHaveBeenCalledTimes(2)
    expect(session.state.status).toBe('loading')
    expect(session.canEdit.value).toBe(false)

    request.resolve()
    await Promise.all([write, reenter])
    expect(success).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledTimes(3)
    expect(load).toHaveBeenLastCalledWith(A, 1, 20)
    expect(session.canEdit.value).toBe(true)
  })

  it('离开缓存页后旧负责人预取失效，回到同组织重新读名册', async () => {
    const { load, session, success } = fixture()
    await session.selectOrg(A)
    const owners = Promise.withResolvers<string[]>()
    const mutation = vi.fn(async (_org: string, _ids: string[]) => {})
    const pending = session.write(session.state.rows[0]!, async ({ orgId, userId, send }) => {
      const ids = await owners.promise
      await send(() => mutation(orgId, [...ids, userId]))
      return '已设置'
    })
    session.pause()
    expect(session.canEdit.value).toBe(false)
    await session.resume()
    owners.resolve([owner.user_id])
    await pending
    expect(mutation).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledTimes(2)
    expect(session.canEdit.value).toBe(true)
  })

  it('全量负责人预取必须完整，保留现任并检查目标仍在组织内', () => {
    expect(ownersWithMember({ list: [owner, member], total: 2 }, member.user_id))
      .toEqual([owner.user_id, member.user_id])
    expect(() => ownersWithMember({ list: [member], total: 101 }, member.user_id)).toThrow('超过 100')
    expect(() => ownersWithMember({ list: [member], total: 2 }, member.user_id)).toThrow('完整')
    expect(() => ownersWithMember({ list: [owner], total: 1 }, member.user_id)).toThrow('不在当前组织')
    expect(() => ownersWithMember({ list: [owner, member, owner], total: 3 }, member.user_id)).toThrow('重复')
  })
})

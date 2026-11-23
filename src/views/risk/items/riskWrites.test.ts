import { describe, expect, it, vi } from 'vitest'
import { createWriteSessions, isUnknownOutcome } from './riskWrites'

const httpError = (status: number, message = '合成故障') => ({ response: { status, data: { message } } })
const networkError = () => Object.assign(new Error('合成断网'), { code: 'ECONNABORTED' })

function setup<R>(run: (input: { v: string, w?: string }, operationId: string) => Promise<R>) {
  let seq = 0
  const sessions = createWriteSessions<{ v: string, w?: string }, R>({
    newId: () => `op-${String(++seq).padStart(2, '0')}`,
    run,
  })
  return { sessions }
}

it('无 HTTP response 或 5xx 的失败视为提交结果未知，4xx 视为 definitive', () => {
  expect(isUnknownOutcome(networkError())).toBe(true)
  expect(isUnknownOutcome(new DOMException('取消', 'AbortError'))).toBe(true)
  expect(isUnknownOutcome(httpError(409))).toBe(false)
  expect(isUnknownOutcome(httpError(503))).toBe(true)
  expect(isUnknownOutcome(httpError(502))).toBe(true)
  expect(isUnknownOutcome(new Error('端口不可用'))).toBe(true)
})

describe('写会话 operation_id 稳定性', () => {
  it('成功后销毁会话，下一次提交使用新号', async () => {
    const run = vi.fn<(input: { v: string }, id: string) => Promise<{ ok: number }>>()
      .mockResolvedValueOnce({ ok: 1 }).mockResolvedValueOnce({ ok: 2 })
    const { sessions } = setup(run)
    await expect(sessions.submit('slot', { v: '第一次' })).resolves.toEqual({ kind: 'done', result: { ok: 1 } })
    expect(run.mock.calls[0]).toEqual([{ v: '第一次' }, 'op-01'])
    expect(sessions.session('slot')).toBeUndefined()
    await sessions.submit('slot', { v: '第二次' })
    expect(run.mock.calls[1]).toEqual([{ v: '第二次' }, 'op-02'])
  })

  it('重复点击不产生第二次提交，也不更换原号', async () => {
    let release!: (value: { ok: number }) => void
    const run = vi.fn<(input: { v: string }, id: string) => Promise<{ ok: number }>>()
      .mockImplementation(() => new Promise(resolve => { release = resolve }))
    const { sessions } = setup(run)
    const first = sessions.submit('slot', { v: '内容' })
    const second = await sessions.submit('slot', { v: '内容' })
    expect(second).toEqual({ kind: 'definitive', error: '已有提交进行中，请等待结果', conflict: false })
    expect(run).toHaveBeenCalledTimes(1)
    expect(sessions.session('slot')).toMatchObject({ phase: 'pending', operationId: 'op-01' })
    release({ ok: 1 })
    await first
    expect(sessions.session('slot')).toBeUndefined()
  })

  it('响应未知保留原号：同参重投用原号原输入，改参被拒绝', async () => {
    const run = vi.fn<(input: { v: string }, id: string) => Promise<{ ok: number }>>()
      .mockRejectedValueOnce(networkError()).mockResolvedValueOnce({ ok: 1 })
    const { sessions } = setup(run)
    const first = await sessions.submit('slot', { v: '原参数' })
    expect(first).toMatchObject({ kind: 'unknown' })
    const session = sessions.session('slot')!
    expect(session).toMatchObject({ phase: 'unknown', operationId: 'op-01' })
    const refused = await sessions.submit('slot', { v: '改参数' })
    expect(refused).toMatchObject({ kind: 'definitive' })
    expect(run).toHaveBeenCalledTimes(1)
    await expect(sessions.submit('slot', { v: '原参数' })).resolves.toEqual({ kind: 'done', result: { ok: 1 } })
    expect(run.mock.calls[1]).toEqual([{ v: '原参数' }, 'op-01'])
  })

  it.each([403, 404, 409])('未知结果后同号重投返回 %i，保留首笔状态及原号', async status => {
    const run = vi.fn<(input: { v: string }, id: string) => Promise<{ ok: number }>>()
      .mockRejectedValueOnce(networkError()).mockRejectedValueOnce(httpError(status))
    const { sessions } = setup(run)
    await expect(sessions.submit('slot', { v: '原参数' })).resolves.toMatchObject({ kind: 'unknown' })
    await expect(sessions.submit('slot', { v: '原参数' })).resolves.toMatchObject({ kind: 'unknown' })
    expect(sessions.open('slot', { v: '改参数' })).toMatchObject({
      phase: 'unknown', operationId: 'op-01', input: { v: '原参数' },
    })
    await expect(sessions.submit('slot', { v: '改参数' })).resolves.toMatchObject({ kind: 'definitive' })
    expect(run.mock.calls).toEqual([[{ v: '原参数' }, 'op-01'], [{ v: '原参数' }, 'op-01']])
    expect(sessions.confirm('slot')).toBe(true)
  })

  it('definitive 失败回草稿：原参可原号重试，改参换新号', async () => {
    const run = vi.fn<(input: { v: string }, id: string) => Promise<{ ok: number }>>()
      .mockRejectedValueOnce(httpError(400, '字段不合法'))
      .mockRejectedValueOnce(httpError(400, '仍不合法'))
      .mockResolvedValueOnce({ ok: 3 })
    const { sessions } = setup(run)
    const first = await sessions.submit('slot', { v: '原参数' })
    expect(first).toEqual({ kind: 'definitive', error: '字段不合法', conflict: false })
    expect(sessions.session('slot')).toMatchObject({ phase: 'draft', operationId: 'op-01' })
    await sessions.submit('slot', { v: '原参数' })
    expect(run.mock.calls[1]).toEqual([{ v: '原参数' }, 'op-01'])
    await sessions.submit('slot', { v: '改参数' })
    expect(run.mock.calls[2]).toEqual([{ v: '改参数' }, 'op-02'])
    expect(sessions.session('slot')).toBeUndefined()
  })

  it('409 冲突在会话与结果上标记 conflict', async () => {
    const run = vi.fn<(input: { v: string }, id: string) => Promise<{ ok: number }>>()
      .mockRejectedValueOnce(httpError(409, '修订冲突'))
    const { sessions } = setup(run)
    await expect(sessions.submit('slot', { v: '旧修订' })).resolves.toEqual({
      kind: 'definitive', error: '修订冲突', conflict: true,
    })
    expect(sessions.session('slot')).toMatchObject({ phase: 'draft', conflict: true })
  })

  it('对话框槽位关闭重开保留会话；显式放弃后才换新号', async () => {
    const run = vi.fn<(input: { v: string }, id: string) => Promise<{ ok: number }>>()
      .mockImplementation(() => new Promise(() => {}))
    const { sessions } = setup(run)
    void sessions.submit('slot', { v: '在途' })
    expect(sessions.session('slot')!.operationId).toBe('op-01')
    sessions.discard('slot')
    expect(sessions.session('slot')).toBeUndefined()
    void sessions.submit('slot', { v: '重填' })
    expect(sessions.session('slot')!.operationId).toBe('op-02')
  })

  it('输入一致性按语义比较：键序与 undefined 缺省等价', async () => {
    const run = vi.fn<(input: { v: string; w?: string }, id: string) => Promise<{ ok: number }>>()
      .mockRejectedValueOnce(httpError(400))
      .mockResolvedValueOnce({ ok: 2 })
    const { sessions } = setup(run)
    await sessions.submit('slot', { v: 'a', w: 'b' })
    // {v,w} 与 {w,v} 键序不同，语义相同 → 原号重试
    await sessions.submit('slot', { w: 'b', v: 'a' })
    expect(run.mock.calls[1]).toEqual([{ w: 'b', v: 'a' }, 'op-01'])
    await sessions.submit('slot', { v: 'a' })
    expect(run.mock.calls[2]).toEqual([{ v: 'a' }, 'op-02'])
  })

  it('403/404 按 definitive 展示后端消息，5xx 与断网同属提交未知', async () => {
    const run = vi.fn<(input: { v: string }, id: string) => Promise<{ ok: number }>>()
      .mockRejectedValueOnce(httpError(403, '动作不允许'))
      .mockRejectedValueOnce(httpError(404, '不可见'))
      .mockRejectedValueOnce(httpError(503, '依赖不可用'))
    const { sessions } = setup(run)
    await expect(sessions.submit('a', { v: 'x' })).resolves.toMatchObject({ kind: 'definitive', error: '动作不允许' })
    await expect(sessions.submit('b', { v: 'x' })).resolves.toMatchObject({ kind: 'definitive', error: '不可见' })
    await expect(sessions.submit('c', { v: 'x' })).resolves.toMatchObject({ kind: 'unknown' })
    expect(sessions.session('c')).toMatchObject({ phase: 'unknown', operationId: 'op-03', submitted: true })
  })

  it('只读核查确认仅对未知态会话生效，确认后销毁会话', async () => {
    const run = vi.fn<(input: { v: string }, id: string) => Promise<{ ok: number }>>()
      .mockRejectedValueOnce(networkError())
    const { sessions } = setup(run)
    await sessions.submit('slot', { v: '原参数' })
    expect(sessions.session('slot')).toMatchObject({ phase: 'unknown' })
    expect(sessions.confirm('slot')).toBe(true)
    expect(sessions.session('slot')).toBeUndefined()
  })

  it('草稿态与不存在槽位不提供确认出口', async () => {
    const run = vi.fn<(input: { v: string }, id: string) => Promise<{ ok: number }>>()
      .mockRejectedValueOnce(httpError(400, '字段不合法'))
    const { sessions } = setup(run)
    await sessions.submit('slot', { v: 'x' })
    expect(sessions.session('slot')).toMatchObject({ phase: 'draft' })
    expect(sessions.confirm('slot')).toBe(false)
    expect(sessions.session('slot')).toMatchObject({ phase: 'draft', operationId: 'op-01' })
    expect(sessions.confirm('absent')).toBe(false)
  })
})

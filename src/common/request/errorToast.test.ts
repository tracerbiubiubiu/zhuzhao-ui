/**
 * resolveErrorToast 决策单测（01 §3.3 errorBehavior 白名单）
 *
 * 钉死：特殊行为码不 toast（401/20007/10006/silent/canceled/transient 除外）、
 * 10007 warning、20006 error、默认 toast 后端 message+request_id。
 */
import { describe, it, expect } from 'vitest'
import { resolveErrorToast } from './errorToast'

const makeError = (overrides: Record<string, unknown> = {}) =>
  ({
    config: { headers: {} },
    response: { status: 500, data: { code: 50000, message: '服务器错误', request_id: 'req-abc123' } },
    ...overrides,
  }) as never

describe('resolveErrorToast', () => {
  it('_silentError → null（调用方自管）', () => {
    expect(resolveErrorToast(makeError({ config: { headers: {}, _silentError: true } }))).toBeNull()
  })

  it('取消的请求（ERR_CANCELED）→ null', () => {
    expect(resolveErrorToast(makeError({ code: 'ERR_CANCELED' }))).toBeNull()
  })

  it('__sessionTransient（refresh 链 5xx/网络）→ warning 固定文案', () => {
    const decision = resolveErrorToast(makeError({ __sessionTransient: true }))
    expect(decision?.type).toBe('warning')
    expect(decision?.message).toContain('稍后重试')
  })

  it('401 → null（会话链路已有跳转/清会话处置）', () => {
    expect(
      resolveErrorToast(makeError({ response: { status: 401, data: { code: 20002 } } })),
    ).toBeNull()
  })

  it('403+20007 → null（跳改密页）', () => {
    expect(
      resolveErrorToast(makeError({ response: { status: 403, data: { code: 20007 } } })),
    ).toBeNull()
  })

  it('10006 乐观锁 → null（表单重拉详情，非 toast）', () => {
    expect(
      resolveErrorToast(makeError({ response: { status: 409, data: { code: 10006 } } })),
    ).toBeNull()
  })

  it('10007 限流 → warning（后端 message 优先）', () => {
    const decision = resolveErrorToast(
      makeError({ response: { status: 429, data: { code: 10007, message: '太频繁', request_id: 'req-x' } } }),
    )
    expect(decision).toEqual({ type: 'warning', message: '太频繁（request_id: req-x）' })
  })

  it('20006 锁定 → error（无 message 时用固定文案）', () => {
    const decision = resolveErrorToast(
      makeError({ response: { status: 429, data: { code: 20006 } } }),
    )
    expect(decision?.type).toBe('error')
    expect(decision?.message).toContain('锁定')
  })

  it('默认 → error toast 后端 message + request_id', () => {
    const decision = resolveErrorToast(makeError())
    expect(decision).toEqual({ type: 'error', message: '服务器错误（request_id: req-abc123）' })
  })

  it('无响应（网络断开）→ error 固定文案', () => {
    const decision = resolveErrorToast(makeError({ response: undefined }))
    expect(decision).toEqual({ type: 'error', message: '网络异常，请检查连接后重试' })
  })

  it('非对象错误 → null', () => {
    expect(resolveErrorToast('boom')).toBeNull()
    expect(resolveErrorToast(null)).toBeNull()
  })
})

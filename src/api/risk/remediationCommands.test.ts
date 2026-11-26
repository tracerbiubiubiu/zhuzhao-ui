import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from '@vea/request'
import {
  acceptRemediationAssignmentApi, assignRemediationHandlerApi,
  decideRemediationAcceptanceApi, newRemediationCommandId,
  requestRemediationAcceptanceApi, validateRemediationCommandOutcome,
  type AssignRemediationHandlerInput, type RemediationCommandCommon,
  type RequestRemediationAcceptanceInput,
} from './remediationCommands'

vi.mock('@vea/request', () => ({ default: { post: vi.fn() } }))

const operationId = '123e4567-e89b-42d3-a456-426614174000'
const common: RemediationCommandCommon = {
  operation_id: operationId, ticket_id: '9007199254740993',
  expected_ticket_revision: '12', definition_version: '8',
}
const outcome = {
  operation_id: operationId, ticket_id: '9007199254740993', ticket_revision: '13',
  definition_version: '8', assigned_to_user_id: '9007199254740994', assignment_generation: '2',
  status: 'assigned', items: [], terminal_allowed: false,
}
const acceptance: RequestRemediationAcceptanceInput = {
  ...common, risk_id: '21', expected_risk_revision: '3', link_id: '31',
  expected_link_revision: '4', reason: '合成测试接受理由', valid_until: '2099-12-30T12:00:00+08:00',
}
const decision = {
  ...common, acceptance_id: '41', expected_acceptance_revision: '1', expected_risk_revision: '3',
  decision: 'approve' as const, reason: '独立审核合成理由',
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(request.post).mockResolvedValue(outcome as never)
})
afterEach(() => vi.unstubAllGlobals())

describe('风险分派、接单与接受命令 HTTP 合同', () => {
  it('分派只向候选路由发送字符串修订与原 K，保留票级输入且静默错误', async () => {
    const input = {
      ...common, assigned_to_user_id: '9007199254740994',
      custom_data_patch: { proof: ['synthetic-key'], nested: { value: null } }, comment: '合成说明',
    }
    await expect(assignRemediationHandlerApi(input)).resolves.toEqual(outcome)
    expect(request.post).toHaveBeenCalledExactlyOnceWith('/api/v1/risk-items/remediation-assign-handler', {
      operation_id: operationId, ticket_id: '9007199254740993', expected_ticket_revision: '12', definition_version: '8',
      assigned_to_user_id: '9007199254740994',
      custom_data_patch: { proof: ['synthetic-key'], nested: { value: null } }, comment: '合成说明',
    }, { _silentError: true })
  })

  it('接单只发通用头，接受分派回执的空 items', async () => {
    await expect(acceptRemediationAssignmentApi(common)).resolves.toEqual(outcome)
    expect(request.post).toHaveBeenCalledExactlyOnceWith('/api/v1/risk-items/remediation-accept-assignment', common, { _silentError: true })
  })

  it('申请接受提交风险、关联、期限与理由', async () => {
    await requestRemediationAcceptanceApi(acceptance)
    expect(request.post).toHaveBeenCalledExactlyOnceWith('/api/v1/risk-items/remediation-accept-request', acceptance, { _silentError: true })
  })

  it('审批只提交接受申请和风险修订，不扩写风险或关联 ID', async () => {
    await decideRemediationAcceptanceApi(decision)
    expect(request.post).toHaveBeenCalledExactlyOnceWith('/api/v1/risk-items/remediation-accept-decision', decision, { _silentError: true })
  })

  it.each([
    { operation_id: 'original-operation' },
    { operation_id: '123e4567e89b42d3a456426614174000' },
    { operation_id: '123E4567-E89B-42D3-A456-426614174000' },
    { ticket_id: '0' }, { ticket_id: 12 }, { ticket_id: '9223372036854775808' },
    { expected_ticket_revision: '0' }, { expected_ticket_revision: '01' }, { definition_version: '0' },
    { assigned_to_user_id: '0' },
  ])('无效 K 或 int64 输入不触发写请求：%j', async invalid => {
    await expect(assignRemediationHandlerApi({
      ...common, assigned_to_user_id: '7', ...invalid,
    } as AssignRemediationHandlerInput)).rejects.toThrow()
    expect(request.post).not.toHaveBeenCalled()
  })

  it('严格隔离命令字段，审批混入 risk_id/link_id 时不静默吞掉也不发送', async () => {
    await expect(decideRemediationAcceptanceApi({ ...decision, risk_id: '21', link_id: '31' } as typeof decision)).rejects.toThrow()
    await expect(acceptRemediationAssignmentApi({ ...common, assigned_to_user_id: '7' } as RemediationCommandCommon)).rejects.toThrow()
    expect(request.post).not.toHaveBeenCalled()
  })

  it.each([
    { reason: '   ' }, { valid_until: '2099-12-30' }, { valid_until: '2099-02-30T12:00:00Z' },
    { valid_until: '2099-12-30T12:00:00' }, { valid_until: '2000-01-01T00:00:00Z' },
    { risk_id: '0' }, { expected_link_revision: '0' },
  ])('接受申请拒绝无效理由、期限或修订：%j', async invalid => {
    await expect(requestRemediationAcceptanceApi({ ...acceptance, ...invalid })).rejects.toThrow()
    expect(request.post).not.toHaveBeenCalled()
  })

  it('审批必须有决定、理由和正修订', async () => {
    await expect(decideRemediationAcceptanceApi({ ...decision, reason: '' })).rejects.toThrow()
    await expect(decideRemediationAcceptanceApi({ ...decision, expected_acceptance_revision: '0' })).rejects.toThrow()
    await expect(decideRemediationAcceptanceApi({ ...decision, decision: 'accept' } as unknown as typeof decision)).rejects.toThrow()
    expect(request.post).not.toHaveBeenCalled()
  })

  it('拒绝会被 JSON 静默改写的补丁和非字符串说明', async () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    for (const patch of [null, [], new Date(), { value: undefined }, { value: Number.NaN }, { value: 1n }, cyclic]) {
      await expect(acceptRemediationAssignmentApi({ ...common, custom_data_patch: patch } as RemediationCommandCommon)).rejects.toThrow()
    }
    await expect(acceptRemediationAssignmentApi({ ...common, comment: 7 } as unknown as RemediationCommandCommon)).rejects.toThrow()
    expect(request.post).not.toHaveBeenCalled()
  })

  it.each([
    { name: '分派', input: { ...common, assigned_to_user_id: '7' }, submit: assignRemediationHandlerApi },
    { name: '接单', input: { ...common }, submit: acceptRemediationAssignmentApi },
    { name: '接受申请', input: { ...acceptance }, submit: requestRemediationAcceptanceApi },
    { name: '接受审批', input: { ...decision }, submit: decideRemediationAcceptanceApi },
  ])('$name 回执绑定已发送 K 和票号，不受挂起期间原输入修改影响', async ({ input, submit }) => {
    let resolveResponse!: (value: never) => void
    vi.mocked(request.post).mockImplementationOnce(() => new Promise(resolve => { resolveResponse = resolve }))
    const pending = (submit as (value: any) => Promise<unknown>)(input)
    input.operation_id = '123e4567-e89b-42d3-a456-426614174001'
    input.ticket_id = '22'
    resolveResponse(outcome as never)
    await expect(pending).resolves.toEqual(outcome)
  })

  it.each([undefined, { response: { status: 403 } }, { response: { status: 409 } }, { response: { status: 503 } }])('传输失败原样交给调用方且只提交一次：%j', async failure => {
    const error = failure ?? new Error('synthetic network failure')
    vi.mocked(request.post).mockRejectedValue(error)
    await expect(acceptRemediationAssignmentApi(common)).rejects.toBe(error)
    expect(request.post).toHaveBeenCalledTimes(1)
  })
})

describe('原 K 与同票回执校验', () => {
  it('完整保留 handler 回执字段及零提案/生效版本', () => {
    const value = {
      ...outcome, items: [{ link_id: '31', risk_id: '21', link_revision: '4', risk_revision: '3', proposal_version: '0', resolution_version: '0', result: 'applied' }],
      acceptance_id: '41', acceptance_revision: '1', acceptance_status: 'approved',
    }
    expect(validateRemediationCommandOutcome(value, operationId, common.ticket_id)).toEqual(value)
  })

  it.each([
    { operation_id: '123e4567-e89b-42d3-a456-426614174001' }, { operation_id: undefined },
    { ticket_id: '22' }, { ticket_id: undefined }, { ticket_revision: undefined }, { ticket_revision: 13 },
    { ticket_revision: '9223372036854775808' }, { definition_version: '0' }, { assigned_to_user_id: '0' },
    { assignment_generation: '0' }, { status: 1 }, { items: null }, { terminal_allowed: undefined },
    { acceptance_revision: 1 }, { acceptance_status: 'unknown' },
    { items: [{ link_id: '31' }] },
  ])('拒绝缺字段、错 K、错票和不合法回执：%j', invalid => {
    expect(() => validateRemediationCommandOutcome({ ...outcome, ...invalid }, operationId, common.ticket_id)).toThrow()
  })

  it('POST 同样拒绝服务端返回另一票或另一 K', async () => {
    vi.mocked(request.post).mockResolvedValueOnce({ ...outcome, ticket_id: '22' } as never)
    await expect(acceptRemediationAssignmentApi(common)).rejects.toThrow()
    vi.mocked(request.post).mockResolvedValueOnce({ ...outcome, operation_id: '123e4567-e89b-42d3-a456-426614174001' } as never)
    await expect(acceptRemediationAssignmentApi(common)).rejects.toThrow()
  })
})

describe('canonical UUID 操作号', () => {
  it('优先使用 randomUUID 并生成可提交原号', async () => {
    const randomUUID = vi.fn(() => operationId)
    vi.stubGlobal('crypto', { randomUUID })
    expect(newRemediationCommandId()).toBe(operationId)
    expect(randomUUID).toHaveBeenCalledOnce()
    await acceptRemediationAssignmentApi({ ...common, operation_id: newRemediationCommandId() })
    expect(request.post).toHaveBeenCalledOnce()
  })

  it('非安全上下文使用密码学随机字节，设置 v4 与 variant 位并保留连字符', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => { bytes.fill(255); return bytes })
    vi.stubGlobal('crypto', { getRandomValues })
    expect(newRemediationCommandId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
    expect(getRandomValues).toHaveBeenCalledOnce()
  })

  it('没有密码学随机源时拒绝生成可误用的操作号', () => {
    vi.stubGlobal('crypto', undefined)
    expect(() => newRemediationCommandId()).toThrow()
  })
})

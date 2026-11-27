import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from '@vea/request'
import {
  getInstanceActionsApi, normalizeTicketDefinition, transitionInstanceApi,
} from './instanceActions'

vi.mock('@vea/request', () => ({ default: { get: vi.fn(), post: vi.fn() } }))

const definitionRef = {
  type_code: 'remediation', definition_version: '9007199254740993', definition_hash: 'synthetic-hash',
}
const detail = { type_code: 'remediation', revision: '12', definition_ref: definitionRef, definition_resolution: 'exact' }
const attachment = {
  field_key: 'proof', field_label: '凭证', field_type: 'file', required: false,
}
const action = {
  action_id: 'submit-for-retest', to: 'pending_verify', label: '送复测',
  expected_revision: '12', definition_ref: definitionRef, comment_required: false,
  collect_fields: [{ key: 'proof', required: true }],
}

beforeEach(() => vi.resetAllMocks())

describe('工单已绑定规则与可用动作', () => {
  it('区分带引用的精确详情、只读降级和兼容旧详情', () => {
    expect(normalizeTicketDefinition(detail)).toMatchObject({
      resolution: 'exact', revision: '12', reference: definitionRef,
    })
    expect(normalizeTicketDefinition({
      type_code: 'remediation', definition_resolution: 'degraded', definition_ref: null,
    })).toMatchObject({ resolution: 'degraded' })
    expect(normalizeTicketDefinition({ type_code: 'remediation' })).toMatchObject({ resolution: 'legacy' })
    expect(() => normalizeTicketDefinition({ ...detail, revision: 12 })).toThrow()
    expect(() => normalizeTicketDefinition({ ...detail, definition_resolution: undefined })).toThrow()
  })

  it('按稳定字段键绑定动作必填证据，并保留规则版本和预期修订', async () => {
    vi.mocked(request.get).mockResolvedValue({ actions: [action], field_definitions: [attachment] } as never)
    await expect(getInstanceActionsApi('1', normalizeTicketDefinition(detail))).resolves.toMatchObject({
      actions: [{
        id: action.action_id, to: 'pending_verify', title: '送复测',
        expectedRevision: '12', definitionVersion: '9007199254740993',
        fields: [{ definition: attachment, required: true }],
      }],
      fields: [attachment],
    })
    expect(request.get).toHaveBeenCalledExactlyOnceWith('/api/v1/tickets/1/actions', { _silentError: true })
  })

  it('明确失败时保留错误，不降级到旧动作或返回成功空集', async () => {
    const failure = { response: { status: 503 } }
    vi.mocked(request.get).mockRejectedValueOnce(failure)
    await expect(getInstanceActionsApi('1', normalizeTicketDefinition(detail))).rejects.toBe(failure)
    vi.mocked(request.get).mockResolvedValueOnce({ field_definitions: [] } as never)
    await expect(getInstanceActionsApi('1', normalizeTicketDefinition(detail))).rejects.toThrow()
    vi.mocked(request.get).mockResolvedValueOnce({ actions: [action] } as never)
    await expect(getInstanceActionsApi('1', normalizeTicketDefinition(detail))).rejects.toThrow()
    vi.mocked(request.get).mockResolvedValueOnce({ actions: [{ ...action, expected_revision: '13' }], field_definitions: [attachment] } as never)
    await expect(getInstanceActionsApi('1', normalizeTicketDefinition(detail))).rejects.toThrow()
    expect(vi.mocked(request.get).mock.calls.every(([path]) => path === '/api/v1/tickets/1/actions')).toBe(true)
  })

  it('兼容动作汇总的 available_actions，同时拒绝错票或错修订', async () => {
    const projection = {
      ticket_id: '1', revision: '12', available_actions: [action], field_definitions: [attachment],
    }
    vi.mocked(request.get).mockResolvedValueOnce(projection as never)
    await expect(getInstanceActionsApi('1', normalizeTicketDefinition(detail))).resolves.toMatchObject({
      actions: [{ id: action.action_id }],
    })
    vi.mocked(request.get).mockResolvedValueOnce({ ...projection, ticket_id: '2' } as never)
    await expect(getInstanceActionsApi('1', normalizeTicketDefinition(detail))).rejects.toThrow()
  })

  it('旧可用转换仍可工作，只读降级不请求动作', async () => {
    vi.mocked(request.get).mockResolvedValue({ transitions: ['assigned'] } as never)
    await expect(getInstanceActionsApi('1', normalizeTicketDefinition({ type_code: 'remediation' }))).resolves.toMatchObject({
      actions: [{ to: 'assigned', fields: [], commentRequired: false }],
    })
    expect(request.get).toHaveBeenCalledExactlyOnceWith('/api/v1/tickets/1/transitions/available', { _silentError: true })
    await expect(getInstanceActionsApi('1', normalizeTicketDefinition({ definition_resolution: 'degraded' }))).resolves.toEqual({ actions: [], fields: [] })
    expect(request.get).toHaveBeenCalledTimes(1)
  })

  it('旧接口的显式 null 为正常空集，缺少 transitions 保持错误', async () => {
    const legacy = normalizeTicketDefinition({ type_code: 'remediation' })
    vi.mocked(request.get).mockResolvedValueOnce({ transitions: null } as never)
    await expect(getInstanceActionsApi('1', legacy)).resolves.toEqual({ actions: [], fields: [] })
    vi.mocked(request.get).mockResolvedValueOnce({} as never)
    await expect(getInstanceActionsApi('1', legacy)).rejects.toThrow()
  })

  it('转换只提交一次包含附件稳定键的 patch，不另存工单字段', async () => {
    const payload = {
      id: '1', to: 'pending_verify', expected_revision: '12', definition_version: '9007199254740993',
      custom_data_patch: { proof: ['synthetic-object-key'] },
    }
    await transitionInstanceApi(payload, 'original-operation')
    expect(request.post).toHaveBeenCalledExactlyOnceWith('/api/v1/tickets/transition', payload, {
      _silentError: true, headers: { 'Idempotency-Key': 'original-operation' },
    })
  })
})

it('仅采用与当前工单和修订配对的服务端专项动作布尔值', async () => {
  const definition = normalizeTicketDefinition(detail)
  const body = { ticket_id: '1', revision: '12', actions: [], capabilities: { transfer: true, withdraw: false } }
  vi.mocked(request.get).mockResolvedValueOnce(body as never)
  expect((await getInstanceActionsApi('1', definition)).capabilities).toEqual({ transfer: true, withdraw: false })
  for (const incomplete of [
    { ...body, revision: undefined }, { ...body, ticket_id: undefined },
    { ...body, capabilities: { transfer: 'true', withdraw: false } }, { ...body, capabilities: undefined },
  ]) {
    vi.mocked(request.get).mockResolvedValueOnce(incomplete as never)
    expect((await getInstanceActionsApi('1', definition)).capabilities).toBeUndefined()
  }
})

it('保留已绑定撤回边的必填说明合同', async () => {
  const definition = normalizeTicketDefinition(detail)
  vi.mocked(request.get).mockResolvedValueOnce({
    ticket_id: '1', revision: '12', actions: [],
    capabilities: { transfer: false, withdraw: true, withdraw_comment_required: true },
  } as never)
  expect((await getInstanceActionsApi('1', definition)).capabilities).toMatchObject({ withdrawCommentRequired: true })
})

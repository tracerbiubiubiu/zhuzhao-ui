import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type AxiosAdapter } from 'axios'
import request from '@vea/request'
import { clearTokens, setTokens } from '@/common/auth/tokenStorage'
import {
  finishRemediationApi, getRemediationContextApi, getRemediationOperationApi, reviewRemediationApi,
  type RemediationFinishInput, type RemediationReviewInput,
} from './remediation'

// 请求封装保持真实；仅隔离浏览器路由依赖，网络在 Axios adapter 边界替换。
vi.mock('@/store/modules/user', () => ({ useUserStoreWithOut: () => ({ resetState: vi.fn() }) }))

const adapter = vi.fn<AxiosAdapter>()
const originalAdapter = request.defaults.adapter
const ticketId = '9007199254740993'
// 候选契约形状（handler/risk_workflow_handler.go + migrations/000092）：int64 全部十进制字符串。
const contextBody = () => ({
  ticket_id: ticketId, ticket_revision: '41', definition_version: '7', status: 'in_progress',
  items: [
    { link_id: '301', risk_id: '9007199254740995', risk_revision: '11', link_revision: '21', proposal_version: '0', remediation_state: 'open', title: '合成资产 A' },
    { link_id: '302', risk_id: '102', risk_revision: '12', link_revision: '22', proposal_version: '3', remediation_state: 'pending_verify', title: '合成资产 B' },
    { link_id: '303', risk_id: '103', risk_revision: '13', link_revision: '23', proposal_version: '4', remediation_state: 'rejected', title: '合成资产 C' },
    { link_id: '304', risk_id: '104', risk_revision: '14', link_revision: '24', proposal_version: '5', remediation_state: 'resolved', title: '合成资产 D' },
  ],
})
const finishInput: RemediationFinishInput = {
  operation_id: '552096bb-6a97-48ac-8bef-4eece55d004c', ticket_id: ticketId, expected_ticket_revision: '41', definition_version: '7',
  items: [{
    link_id: '301', expected_link_revision: '21', expected_risk_revision: '11', resolution: 'fixed',
    measures: '已完成合成整改', evidence: [{ kind: 'file', ref: 'ticket/2026/att-1.bin', version: '9007199254740997' }],
  }],
}
const reviewInput: RemediationReviewInput = {
  operation_id: '41d56108-a478-4b3c-9e83-658fd677fa95', ticket_id: ticketId, expected_ticket_revision: '41', definition_version: '7',
  comment: '合成复核意见',
  items: [{ link_id: '302', expected_link_revision: '22', expected_risk_revision: '12', expected_proposal_version: '3', decision: 'approve', note: '合成复核通过', evidence: [] }],
}
const outcomeBody = () => ({
  operation_id: finishInput.operation_id, ticket_id: ticketId, ticket_revision: '42',
  items: [{ link_id: '301', risk_id: '9007199254740995', link_revision: '22', risk_revision: '12', proposal_version: '1', resolution_version: '0', result: 'pending_confirmation' }],
  terminal_allowed: false,
})

function respond(data: unknown): void {
  adapter.mockImplementationOnce(async config => ({
    config, status: 200, statusText: 'OK', headers: {},
    data: { code: 0, message: 'ok', data, request_id: 'synthetic-response' },
  }))
}

function httpFailure(status: number, message: string): AxiosError {
  return new AxiosError(message, 'ERR_BAD_REQUEST', undefined, undefined, {
    status, statusText: 'Error', headers: {},
    data: { code: status === 404 ? 10003 : 10004, message, request_id: 'synthetic-failure' },
  } as never)
}

beforeEach(() => {
  adapter.mockReset()
  request.defaults.adapter = adapter
  clearTokens()
  setTokens({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' })
})

afterEach(() => {
  request.defaults.adapter = originalAdapter
  clearTokens()
})

describe('逐资产整改上下文读取', () => {
  it('经真实请求封装按工单号 GET，并精确保留大 ID 与全部版本字符串', async () => {
    respond(contextBody())
    await expect(getRemediationContextApi(ticketId)).resolves.toEqual(contextBody())
    const config = adapter.mock.calls[0]![0]
    expect(config.url).toBe(`/api/v1/risk-items/remediation-context/${ticketId}`)
    expect(config.method).toBe('get')
    expect(config.data).toBeUndefined()
    expect(config.params).toBeUndefined()
    expect(config._silentError).toBe(true)
    expect(config.headers.Authorization).toBe('Bearer synthetic-access')
    expect(config.headers['X-Request-ID']).toMatch(/^req-[0-9a-f]{32}$/)
  })

  it('接受 open/pending_verify/rejected/pending_acceptance/resolved 五态与零提案版本', async () => {
    respond({
      ticket_id: ticketId, ticket_revision: '41', definition_version: '7', status: 'in_progress',
      items: [{ link_id: '301', risk_id: '102', risk_revision: '1', link_revision: '1', proposal_version: '0', remediation_state: 'pending_acceptance', title: '合成资产' }],
    })
    await expect(getRemediationContextApi(ticketId)).resolves.toMatchObject({ items: [{ remediation_state: 'pending_acceptance', proposal_version: '0' }] })
  })

  it.each([
    ['missing items', { ...contextBody(), items: undefined }],
    ['non-array items', { ...contextBody(), items: {} }],
    ['mismatched ticket', { ...contextBody(), ticket_id: '302' }],
    ['numeric ticket', { ...contextBody(), ticket_id: Number(ticketId) }],
    ['overflow revision', { ...contextBody(), ticket_revision: '9223372036854775808' }],
    ['missing definition version', { ...contextBody(), definition_version: undefined }],
    ['empty status', { ...contextBody(), status: '' }],
    ['numeric link', { ...contextBody(), items: [{ ...contextBody().items[0], link_id: 301 }] }],
    ['zero risk id', { ...contextBody(), items: [{ ...contextBody().items[0], risk_id: '0' }] }],
    ['unknown state', { ...contextBody(), items: [{ ...contextBody().items[0], remediation_state: 'closed' }] }],
    ['missing title', { ...contextBody(), items: [{ ...contextBody().items[0], title: undefined }] }],
    ['fractional proposal', { ...contextBody(), items: [{ ...contextBody().items[0], proposal_version: '1.5' }] }],
  ])('成功信封内 %s 不得伪装成有效上下文', async (_label, body) => {
    respond(body)
    await expect(getRemediationContextApi(ticketId)).rejects.toThrow('逐资产办理数据格式异常')
    expect(adapter).toHaveBeenCalledTimes(1)
  })

  it('403 与 404 保持安全语义原样拒绝，不冒充成功空集', async () => {
    adapter.mockImplementationOnce(async () => { throw httpFailure(403, '合成无权') })
    await expect(getRemediationContextApi(ticketId)).rejects.toMatchObject({ response: { status: 403 } })
    adapter.mockImplementationOnce(async () => { throw httpFailure(404, '合成查无') })
    await expect(getRemediationContextApi(ticketId)).rejects.toMatchObject({ response: { status: 404 } })
    expect(adapter).toHaveBeenCalledTimes(2)
  })
})

describe('整改办理提交（remediation-finish）', () => {
  it('只序列化办理规范字段并原样携带同票带版本附件证据', async () => {
    respond(outcomeBody())
    await expect(finishRemediationApi(finishInput)).resolves.toEqual({ ...outcomeBody(), items: outcomeBody().items })
    const config = adapter.mock.calls[0]![0]
    expect(config.url).toBe('/api/v1/risk-items/remediation-finish')
    expect(config.method).toBe('post')
    expect(JSON.parse(config.data)).toEqual({
      operation_id: '552096bb-6a97-48ac-8bef-4eece55d004c', ticket_id: ticketId,
      expected_ticket_revision: '41', definition_version: '7',
      items: [{
        link_id: '301', expected_link_revision: '21', expected_risk_revision: '11', resolution: 'fixed',
        measures: '已完成合成整改', evidence: [{ kind: 'file', ref: 'ticket/2026/att-1.bin', version: '9007199254740997' }],
      }],
    })
    expect(config._silentError).toBe(true)
  })

  it('携带通用 custom_data_patch 与 comment 时原样透传，缺省时键不得出现', async () => {
    respond(outcomeBody())
    const patch = { synthetic_field: 3, nested: { key: '合成值' } }
    await finishRemediationApi({ ...finishInput, custom_data_patch: patch, comment: '合成办理说明' })
    const body = JSON.parse(adapter.mock.calls[0]![0].data)
    expect(body.custom_data_patch).toEqual(patch)
    expect(body.comment).toBe('合成办理说明')
    respond(outcomeBody())
    await finishRemediationApi({ ...finishInput, custom_data_patch: {}, comment: '' })
    const bare = JSON.parse(adapter.mock.calls.at(-1)![0].data)
    expect(bare).not.toHaveProperty('custom_data_patch')
    expect(bare).not.toHaveProperty('comment')
  })

  it('多资产原样成列，响应回执只按原号确认', async () => {
    respond({
      ...outcomeBody(), items: [
        { ...outcomeBody().items[0], result: 'applied' },
        { link_id: '303', risk_id: '103', link_revision: '24', risk_revision: '14', proposal_version: '5', resolution_version: '1', result: 'conflict' },
      ], terminal_allowed: true, acceptance_id: '9007199254740999', acceptance_revision: '2', acceptance_status: 'pending',
    })
    await expect(finishRemediationApi({ ...finishInput, items: [...finishInput.items, { ...finishInput.items[0], link_id: '303', expected_link_revision: '23', expected_risk_revision: '13' }] }))
      .resolves.toMatchObject({ terminal_allowed: true, acceptance_id: '9007199254740999', items: [{ result: 'applied' }, { result: 'conflict' }] })
    expect(JSON.parse(adapter.mock.calls[0]![0].data).items).toHaveLength(2)
  })

  it.each([
    ['empty operation', { ...finishInput, operation_id: '' }],
    ['overlong operation', { ...finishInput, operation_id: 'k'.repeat(129) }],
    ['zero ticket revision', { ...finishInput, expected_ticket_revision: '0' }],
    ['overflow definition', { ...finishInput, definition_version: '9223372036854775808' }],
    ['numeric ticket', { ...finishInput, ticket_id: Number(ticketId) }],
    ['empty items', { ...finishInput, items: [] }],
    ['zero link revision', { ...finishInput, items: [{ ...finishInput.items[0], expected_link_revision: '0' }] }],
    ['accept resolution', { ...finishInput, items: [{ ...finishInput.items[0], resolution: 'accept' }] }],
    ['blank measures', { ...finishInput, items: [{ ...finishInput.items[0], measures: '   ' }] }],
    ['overlong measures', { ...finishInput, items: [{ ...finishInput.items[0], measures: 'm'.repeat(16001) }] }],
    ['empty evidence', { ...finishInput, items: [{ ...finishInput.items[0], evidence: [] }] }],
    ['blank evidence version', { ...finishInput, items: [{ ...finishInput.items[0], evidence: [{ kind: 'file', ref: 'a', version: '' }] }] }],
    ['blank evidence ref', { ...finishInput, items: [{ ...finishInput.items[0], evidence: [{ kind: 'file', ref: ' ', version: '1' }] }] }],
    ['unknown evidence kind', { ...finishInput, items: [{ ...finishInput.items[0], evidence: [{ kind: 'link', ref: 'a', version: '1' }] }] }],
    ['review field in finish item', { ...finishInput, items: [{ ...finishInput.items[0], decision: 'approve' }] }],
    ['array patch', { ...finishInput, custom_data_patch: [] as never }],
  ])('网络前拒绝 %s', async (_label, input) => {
    await expect(finishRemediationApi(input as RemediationFinishInput)).rejects.toThrow()
    expect(adapter).not.toHaveBeenCalled()
  })

  it.each([
    ['missing operation', { ...outcomeBody(), operation_id: undefined }],
    ['different operation', { ...outcomeBody(), operation_id: 'another-k' }],
    ['numeric ticket', { ...outcomeBody(), ticket_id: Number(ticketId) }],
    ['unknown result', { ...outcomeBody(), items: [{ ...outcomeBody().items[0], result: 'success' }] }],
    ['numeric link', { ...outcomeBody(), items: [{ ...outcomeBody().items[0], link_id: 301 }] }],
    ['missing terminal flag', { ...outcomeBody(), terminal_allowed: undefined }],
    ['non-decimal acceptance', { ...outcomeBody(), acceptance_id: 'abc' }],
    ['non-array items', { ...outcomeBody(), items: {} }],
  ])('成功信封内 %s 仍拒绝且绝不续投', async (_label, body) => {
    respond(body)
    await expect(finishRemediationApi(finishInput)).rejects.toThrow('整改回执数据格式异常')
    expect(adapter).toHaveBeenCalledTimes(1)
  })
})

describe('逐项复测决定（remediation-review）', () => {
  it('只序列化复测规范字段，证据恒为空数组', async () => {
    respond({ ...outcomeBody(), operation_id: reviewInput.operation_id })
    await expect(reviewRemediationApi(reviewInput)).resolves.toMatchObject({ operation_id: '41d56108-a478-4b3c-9e83-658fd677fa95' })
    const config = adapter.mock.calls[0]![0]
    expect(config.url).toBe('/api/v1/risk-items/remediation-review')
    expect(JSON.parse(config.data)).toEqual({
      operation_id: '41d56108-a478-4b3c-9e83-658fd677fa95', ticket_id: ticketId,
      expected_ticket_revision: '41', definition_version: '7', comment: '合成复核意见',
      items: [{ link_id: '302', expected_link_revision: '22', expected_risk_revision: '12', expected_proposal_version: '3', decision: 'approve', note: '合成复核通过', evidence: [] }],
    })
    expect(config._silentError).toBe(true)
  })

  it('B 打回同样只携带决定与说明', async () => {
    respond({ ...outcomeBody(), operation_id: reviewInput.operation_id, items: [{ ...outcomeBody().items[0], result: 'rejected' }] })
    await reviewRemediationApi({ ...reviewInput, items: [{ ...reviewInput.items[0], decision: 'reject', note: '合成打回' }] })
    expect(JSON.parse(adapter.mock.calls[0]![0].data).items[0]).toEqual({
      link_id: '302', expected_link_revision: '22', expected_risk_revision: '12', expected_proposal_version: '3',
      decision: 'reject', note: '合成打回', evidence: [],
    })
  })

  it.each([
    ['unknown decision', { ...reviewInput, items: [{ ...reviewInput.items[0], decision: 'maybe' }] }],
    ['blank note', { ...reviewInput, items: [{ ...reviewInput.items[0], note: '' }] }],
    ['zero proposal version', { ...reviewInput, items: [{ ...reviewInput.items[0], expected_proposal_version: '0' }] }],
    ['finish field in review item', { ...reviewInput, items: [{ ...reviewInput.items[0], measures: 'x' }] }] as unknown as [label: string, input: RemediationReviewInput],
    ['non-empty evidence', { ...reviewInput, items: [{ ...reviewInput.items[0], evidence: [{ kind: 'file', ref: 'a', version: '1' }] }] }] as unknown as [label: string, input: RemediationReviewInput],
    ['empty items', { ...reviewInput, items: [] }],
  ])('网络前拒绝 %s', async (_label, input) => {
    await expect(reviewRemediationApi(input as RemediationReviewInput)).rejects.toThrow()
    expect(adapter).not.toHaveBeenCalled()
  })
})

describe('按原操作号只读核查（remediation-operations）', () => {
  it('按编码后的原号 GET 并校验回执同号，不发送任何业务输入', async () => {
    const operationId = 'original/k?#'
    respond({ ...outcomeBody(), operation_id: operationId })
    await expect(getRemediationOperationApi(operationId)).resolves.toEqual({ ...outcomeBody(), operation_id: operationId })
    const config = adapter.mock.calls[0]![0]
    expect(config.url).toBe('/api/v1/risk-items/remediation-operations/original%2Fk%3F%23')
    expect(config.method).toBe('get')
    expect(config.data).toBeUndefined()
    expect(config.params).toBeUndefined()
    expect(config._silentError).toBe(true)
  })

  it('响应异号拒绝确认，保持只读且不回退提交', async () => {
    respond({ ...outcomeBody(), operation_id: 'another-k' })
    await expect(getRemediationOperationApi('original-k')).rejects.toThrow('整改回执数据格式异常')
    expect(adapter.mock.calls.map(([config]) => config.method)).toEqual(['get'])
  })

  it.each([403, 404, 503])('GET %s 原样拒绝且不产生任何 POST', async status => {
    adapter.mockImplementationOnce(async () => { throw httpFailure(status, `合成 ${status}`) })
    await expect(getRemediationOperationApi('original-k')).rejects.toMatchObject({ response: { status } })
    expect(adapter.mock.calls.map(([config]) => config.method)).toEqual(['get'])
  })

  it('丢响应原样拒绝，不重试也不回退 POST；断网后按原号续读可取回回执', async () => {
    const lost = new Error('synthetic lost response')
    adapter.mockRejectedValueOnce(lost)
    await expect(getRemediationOperationApi('original-k')).rejects.toBe(lost)
    respond({ ...outcomeBody(), operation_id: 'original-k' })
    await expect(getRemediationOperationApi('original-k')).resolves.toEqual({ ...outcomeBody(), operation_id: 'original-k' })
    expect(adapter.mock.calls.map(([config]) => config.method)).toEqual(['get', 'get'])
  })

  it('提交丢响应后只以原号原参核查，不换号重做', async () => {
    const lost = new Error('synthetic lost finish response')
    adapter.mockRejectedValueOnce(lost)
    await expect(finishRemediationApi(finishInput)).rejects.toBe(lost)
    respond(outcomeBody())
    await expect(getRemediationOperationApi(finishInput.operation_id)).resolves.toEqual(outcomeBody())
    expect(adapter.mock.calls.map(([config]) => [config.method, config.url])).toEqual([
      ['post', '/api/v1/risk-items/remediation-finish'],
      ['get', `/api/v1/risk-items/remediation-operations/${finishInput.operation_id}`],
    ])
  })
})

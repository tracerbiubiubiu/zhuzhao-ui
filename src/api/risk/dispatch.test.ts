import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type AxiosAdapter } from 'axios'
import request from '@vea/request'
import { clearTokens, setTokens } from '@/common/auth/tokenStorage'
import { applyDispatch, getDispatchOperation, planDispatch, type DispatchInput, type DispatchPlanInput } from './dispatch'

// 请求封装保持真实；仅隔离浏览器路由依赖，网络在 Axios adapter 边界替换。
vi.mock('@/store/modules/user', () => ({ useUserStoreWithOut: () => ({ resetState: vi.fn() }) }))

const adapter = vi.fn<AxiosAdapter>()
const originalAdapter = request.defaults.adapter
const planInput: DispatchPlanInput = {
  items: [{ risk_id: '9007199254740993', expected_revision: '9007199254740995' }],
  target_org_id: '9223372036854775807',
  target_type_code: 'remediation',
}
const applyInput: DispatchInput = {
  operation_id: 'original-operation',
  plan_id: '88322620-0793-48aa-a705-2293feb951b6',
  plan_hash: 'synthetic-plan-hash',
}
const planBody = {
  plan_id: '88322620-0793-48aa-a705-2293feb951b6',
  plan_hash: 'synthetic-plan-hash',
  expires_at: '2026-11-22T04:00:00Z',
  groups: [{
    group_key: 'synthetic-group', owner_user_id: '9007199254740997',
    ticket: { id: '9007199254740999', ref: 'T-SYNTHETIC' },
    items: [{ risk_id: '9007199254740993', revision: '9007199254740995', human_key: 'R-SYNTHETIC', title: '合成风险' }],
  }],
}
const resultBody = {
  operation_id: applyInput.operation_id, plan_id: applyInput.plan_id, status: 'partial',
  groups: [{
    group_key: 'synthetic-group', group_operation_id: 'synthetic-group-operation', status: 'completed',
    owner_user_id: '9007199254740997', owner_org_at_dispatch: '9223372036854775807',
    ticket: { id: '9007199254740999', ref: 'T-SYNTHETIC' },
    items: [{
      risk_id: '9007199254740993', result: 'created',
      ticket: { id: '9007199254740999', ref: 'T-SYNTHETIC' },
    }, { risk_id: '9007199254740995', result: 'linked' }, { risk_id: '7', result: 'already_linked' }],
  }, {
    group_key: 'synthetic-other-group', status: 'failed',
    items: [{ risk_id: '9', result: 'denied', reason: 'dispatch_forbidden' },
      { risk_id: '11', result: 'invalid', reason: 'risk_invalid' },
      { risk_id: '13', result: 'conflict', reason: 'revision_conflict' }],
  }],
}

function respond(data: unknown): void {
  adapter.mockImplementationOnce(async config => ({
    config, status: 200, statusText: 'OK', headers: {},
    data: { code: 0, message: 'ok', data, request_id: 'synthetic-response' },
  }))
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

describe('风险派单 API', () => {
  it('经真实请求封装发送预览并精确保留大 ID、版本及工单引用', async () => {
    respond(planBody)
    await expect(planDispatch(planInput)).resolves.toEqual({ ...planBody, blocked: [] })
    const config = adapter.mock.calls[0]![0]
    expect(config.url).toBe('/api/v1/risk-items/dispatch-plan')
    expect(config.method).toBe('post')
    expect(JSON.parse(config.data)).toEqual({
      items: [{ risk_id: '9007199254740993', expected_revision: '9007199254740995' }],
      target_org_id: '9223372036854775807', target_type_code: 'remediation',
    })
    expect(config.headers.Authorization).toBe('Bearer synthetic-access')
    expect(config.headers['X-Request-ID']).toMatch(/^req-[0-9a-f]{32}$/)
    expect(config._silentError).toBe(true)
  })

  it.each([
    ['number', 12], ['zero', '0'], ['negative', '-1'], ['fraction', '1.2'],
    ['exponent', '1e3'], ['whitespace', ' 1'], ['leading zero', '01'],
    ['int64 overflow', '9223372036854775808'], ['empty', ''],
  ])('风险 ID 为 %s 时在网络前拒绝', async (_label, riskId) => {
    await expect(planDispatch({
      ...planInput, items: [{ risk_id: riskId, expected_revision: '1' }],
    } as DispatchPlanInput)).rejects.toThrow()
    expect(adapter).not.toHaveBeenCalled()
  })

  it.each([0, '0', '-1', '9223372036854775808'])('拒绝非法目标组织 %s', async orgId => {
    await expect(planDispatch({ ...planInput, target_org_id: orgId } as DispatchPlanInput)).rejects.toThrow()
    expect(adapter).not.toHaveBeenCalled()
  })

  it.each([1, '-1', '', '1.1', '9223372036854775808'])('拒绝非法预期版本 %s', async revision => {
    await expect(planDispatch({
      ...planInput, items: [{ risk_id: '1', expected_revision: revision }],
    } as DispatchPlanInput)).rejects.toThrow()
    expect(adapter).not.toHaveBeenCalled()
  })

  it('接受版本零且只序列化预览规范字段', async () => {
    respond({ ...planBody, groups: null })
    await expect(planDispatch({
      ...planInput,
      items: [{ risk_id: '1', expected_revision: '0', assigned_to: '2' }],
      owner_user_id: '2',
    } as unknown as DispatchPlanInput)).resolves.toEqual({ ...planBody, groups: [], blocked: [] })
    expect(JSON.parse(adapter.mock.calls[0]![0].data)).toEqual({
      items: [{ risk_id: '1', expected_revision: '0' }],
      target_org_id: '9223372036854775807', target_type_code: 'remediation',
    })
  })

  it('将预览组内 null items 归一为空数组并保留逐项阻断', async () => {
    respond({
      ...planBody, groups: [{ group_key: 'synthetic-group', owner_user_id: '2', items: null }],
      blocked: [{ risk_id: '9007199254740993', reason: 'view_stale' }],
    })
    await expect(planDispatch(planInput)).resolves.toMatchObject({
      groups: [{ group_key: 'synthetic-group', owner_user_id: '2', items: [] }],
      blocked: [{ risk_id: '9007199254740993', reason: 'view_stale' }],
    })
  })

  it.each([
    ['missing plan ID', { ...planBody, plan_id: undefined }],
    ['empty plan hash', { ...planBody, plan_hash: '' }],
    ['invalid expiry', { ...planBody, expires_at: 'not-a-date' }],
    ['non-ISO expiry', { ...planBody, expires_at: '1' }],
    ['missing groups', { ...planBody, groups: undefined }],
    ['missing group items', { ...planBody, groups: [{ group_key: 'g', owner_user_id: '1' }] }],
    ['numeric risk ID', { ...planBody, groups: [{ ...planBody.groups[0], items: [{ risk_id: 9007199254740992, revision: '1', human_key: 'R-SYNTHETIC', title: '合成风险' }] }] }],
    ['overflow revision', { ...planBody, groups: [{ ...planBody.groups[0], items: [{ risk_id: '1', revision: '9223372036854775808', human_key: 'R-SYNTHETIC', title: '合成风险' }] }] }],
    ['numeric ticket ID', { ...planBody, groups: [{ ...planBody.groups[0], ticket: { id: 12, ref: 'T-SYNTHETIC' } }] }],
  ])('成功预览信封内 %s 仍保持失败', async (_label, body) => {
    respond(body)
    await expect(planDispatch(planInput)).rejects.toThrow()
    expect(adapter).toHaveBeenCalledTimes(1)
  })

  it('apply 只提交原三元组并保留逐组、逐项恢复结果', async () => {
    const result = {
      operation_id: 'original-operation', plan_id: applyInput.plan_id, status: 'partial',
      groups: [{
        group_key: 'synthetic-group', group_operation_id: 'synthetic-group-operation', status: 'completed',
        owner_user_id: '9007199254740997', owner_org_at_dispatch: '9223372036854775807',
        ticket: { id: '9007199254740999', ref: 'T-SYNTHETIC' },
        items: [{ risk_id: '9007199254740993', result: 'created' }],
      }, {
        group_key: 'synthetic-other-group', status: 'failed',
        items: [{ risk_id: '9007199254740995', result: 'denied', reason: 'dispatch_forbidden' }],
      }],
    }
    respond(result)
    await expect(applyDispatch({ ...applyInput, target_org_id: '2', assigned_to: '3' } as DispatchInput))
      .resolves.toEqual(result)
    const config = adapter.mock.calls[0]![0]
    expect(config.url).toBe('/api/v1/risk-items/dispatch')
    expect(config.method).toBe('post')
    expect(JSON.parse(config.data)).toEqual({
      operation_id: 'original-operation', plan_id: '88322620-0793-48aa-a705-2293feb951b6',
      plan_hash: 'synthetic-plan-hash',
    })
    expect(config._silentError).toBe(true)
  })

  it('将 apply 的 null groups/items 归一为空数组，不捏造不可读工单引用', async () => {
    respond({ ...applyInput, status: 'pending', groups: null })
    await expect(applyDispatch(applyInput)).resolves.toMatchObject({ status: 'pending', groups: [] })
    respond({ operation_id: applyInput.operation_id, plan_id: applyInput.plan_id, status: 'pending', groups: [{ group_key: 'g', status: 'failed', items: null }] })
    const result = await applyDispatch(applyInput)
    expect(result.groups).toEqual([{ group_key: 'g', status: 'failed', items: [] }])
    expect(result.groups[0]).not.toHaveProperty('ticket')
  })

  it('apply 接受 parent failed 并逐组保留确定失败结果', async () => {
    respond({
      operation_id: applyInput.operation_id, plan_id: applyInput.plan_id, status: 'failed',
      groups: [
        { group_key: 'synthetic-group', status: 'completed', items: [{ risk_id: '9007199254740993', result: 'created' }] },
        { group_key: 'synthetic-other-group', status: 'failed', items: [{ risk_id: '9007199254740995', result: 'denied', reason: 'dispatch_forbidden' }] },
      ],
    })
    await expect(applyDispatch(applyInput)).resolves.toEqual({
      operation_id: applyInput.operation_id, plan_id: applyInput.plan_id, status: 'failed',
      groups: [
        { group_key: 'synthetic-group', status: 'completed', items: [{ risk_id: '9007199254740993', result: 'created' }] },
        { group_key: 'synthetic-other-group', status: 'failed', items: [{ risk_id: '9007199254740995', result: 'denied', reason: 'dispatch_forbidden' }] },
      ],
    })
    expect(adapter).toHaveBeenCalledTimes(1)
  })

  it('apply 拒绝未知 parent 状态，failed 之外仍不放宽', async () => {
    respond({ ...applyInput, status: 'success', groups: [] })
    await expect(applyDispatch(applyInput)).rejects.toThrow('派单结果状态无效')
    expect(adapter).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['missing operation ID', { operation_id: undefined, plan_id: applyInput.plan_id, status: 'completed', groups: [] }],
    ['missing plan ID', { operation_id: applyInput.operation_id, status: 'completed', groups: [] }],
    ['unknown batch status', { operation_id: applyInput.operation_id, plan_id: applyInput.plan_id, status: 'success', groups: [] }],
    ['missing groups', { operation_id: applyInput.operation_id, plan_id: applyInput.plan_id, status: 'completed' }],
    ['unknown group status', { operation_id: applyInput.operation_id, plan_id: applyInput.plan_id, status: 'completed', groups: [{ group_key: 'g', status: 'success', items: [] }] }],
    ['unknown item result', { operation_id: applyInput.operation_id, plan_id: applyInput.plan_id, status: 'completed', groups: [{ group_key: 'g', status: 'completed', items: [{ risk_id: '1', result: 'success' }] }] }],
    ['numeric owner ID', { operation_id: applyInput.operation_id, plan_id: applyInput.plan_id, status: 'completed', groups: [{ group_key: 'g', status: 'completed', owner_user_id: 12, items: [] }] }],
  ])('成功 apply 信封内 %s 不得成为完成结果', async (_label, body) => {
    respond(body)
    await expect(applyDispatch(applyInput)).rejects.toThrow()
    expect(adapter).toHaveBeenCalledTimes(1)
  })

  it('服务端失败和网络丢响应保持拒绝，且不自动重试派单', async () => {
    adapter.mockImplementationOnce(async config => {
      throw new AxiosError('conflict', 'ERR_BAD_REQUEST', config, undefined, {
        config, status: 409, statusText: 'Conflict', headers: {},
        data: { code: 10006, message: '合成冲突', request_id: 'synthetic-conflict' },
      })
    })
    await expect(applyDispatch(applyInput)).rejects.toMatchObject({ response: { status: 409, data: { code: 10006 } } })
    const lostResponse = new Error('synthetic lost response')
    adapter.mockRejectedValueOnce(lostResponse)
    await expect(applyDispatch(applyInput)).rejects.toBe(lostResponse)
    expect(adapter).toHaveBeenCalledTimes(2)
  })

  it('GET 按编码后的原操作号查询并保留全部已返回组及大 ID，不发送业务输入', async () => {
    const operationId = 'original/operation ?#'
    const body = { ...resultBody, operation_id: operationId }
    respond(body)
    await expect(getDispatchOperation(operationId)).resolves.toEqual(body)
    expect(adapter).toHaveBeenCalledTimes(1)
    const config = adapter.mock.calls[0]![0]
    expect(config.url).toBe('/api/v1/risk-items/dispatch-operations/original%2Foperation%20%3F%23')
    expect(config.method).toBe('get')
    expect(config.data).toBeUndefined()
    expect(config.params).toBeUndefined()
    expect(config._silentError).toBe(true)
    expect(config.headers.Authorization).toBe('Bearer synthetic-access')
    expect(config.headers['X-Request-ID']).toMatch(/^req-[0-9a-f]{32}$/)
  })

  it.each(['pending', 'partial', 'completed', 'failed'])('GET 接受 %s 且将 null groups 归一为空数组', async status => {
    respond({ operation_id: applyInput.operation_id, plan_id: applyInput.plan_id, status, groups: null })
    await expect(getDispatchOperation(applyInput.operation_id)).resolves.toEqual({
      operation_id: 'original-operation', plan_id: applyInput.plan_id, status, groups: [],
    })
    expect(adapter.mock.calls.map(([config]) => config.method)).toEqual(['get'])
  })

  it('GET 将组内 null items 归一为空数组，缺省引用仍保持缺省', async () => {
    respond({
      operation_id: applyInput.operation_id, plan_id: applyInput.plan_id, status: 'partial',
      groups: [{ group_key: 'committed-group', status: 'completed', items: null }],
    })
    const result = await getDispatchOperation(applyInput.operation_id)
    expect(result.groups).toEqual([{ group_key: 'committed-group', status: 'completed', items: [] }])
    expect(result.groups[0]).not.toHaveProperty('ticket')
    expect(result.groups[0]).not.toHaveProperty('owner_user_id')
    expect(adapter).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['null result', null],
    ['missing operation ID', { ...resultBody, operation_id: undefined }],
    ['different operation ID', { ...resultBody, operation_id: 'another-operation' }],
    ['missing plan ID', { ...resultBody, plan_id: undefined }],
    ['unknown status', { ...resultBody, status: 'success' }],
    ['missing groups', { ...resultBody, groups: undefined }],
    ['non-array groups', { ...resultBody, groups: {} }],
    ['missing group key', { ...resultBody, groups: [{ status: 'completed', items: [] }] }],
    ['unknown group status', { ...resultBody, groups: [{ group_key: 'g', status: 'pending', items: [] }] }],
    ['empty group operation ID', { ...resultBody, groups: [{ group_key: 'g', group_operation_id: '', status: 'completed', items: [] }] }],
    ['numeric owner ID', { ...resultBody, groups: [{ group_key: 'g', owner_user_id: 12, status: 'completed', items: [] }] }],
    ['overflow owner organization', { ...resultBody, groups: [{ group_key: 'g', owner_org_at_dispatch: '9223372036854775808', status: 'completed', items: [] }] }],
    ['numeric group ticket ID', { ...resultBody, groups: [{ group_key: 'g', ticket: { id: 12, ref: 'T-SYNTHETIC' }, status: 'completed', items: [] }] }],
    ['missing items', { ...resultBody, groups: [{ group_key: 'g', status: 'completed' }] }],
    ['numeric item risk ID', { ...resultBody, groups: [{ group_key: 'g', status: 'completed', items: [{ risk_id: 12, result: 'created' }] }] }],
    ['unknown item result', { ...resultBody, groups: [{ group_key: 'g', status: 'completed', items: [{ risk_id: '1', result: 'success' }] }] }],
    ['empty item reason', { ...resultBody, groups: [{ group_key: 'g', status: 'failed', items: [{ risk_id: '1', result: 'denied', reason: '' }] }] }],
    ['empty item ticket reference', { ...resultBody, groups: [{ group_key: 'g', status: 'completed', items: [{ risk_id: '1', result: 'created', ticket: { id: '2', ref: '' } }] }] }],
  ])('GET 成功信封内 %s 仍拒绝，且绝不回退 POST', async (_label, body) => {
    respond(body)
    await expect(getDispatchOperation(applyInput.operation_id)).rejects.toThrow()
    expect(adapter.mock.calls.map(([config]) => config.method)).toEqual(['get'])
  })

  it('apply 拒绝与请求不一致的响应操作号', async () => {
    respond({ ...resultBody, operation_id: 'another-operation' })
    await expect(applyDispatch(applyInput)).rejects.toThrow()
    expect(adapter).toHaveBeenCalledTimes(1)
  })

  it('GET 404 保持未知错误且只查询一次，绝不自动续建', async () => {
    adapter.mockImplementationOnce(async config => {
      throw new AxiosError('unknown operation', 'ERR_BAD_REQUEST', config, undefined, {
        config, status: 404, statusText: 'Not Found', headers: {},
        data: { code: 10003, message: '合成未知操作', request_id: 'synthetic-not-found' },
      })
    })
    await expect(getDispatchOperation(applyInput.operation_id))
      .rejects.toMatchObject({ response: { status: 404, data: { code: 10003 } } })
    expect(adapter.mock.calls.map(([config]) => config.method)).toEqual(['get'])
  })

  it('GET 丢响应原样拒绝，不重试也不回退 POST', async () => {
    const lostResponse = new Error('synthetic lost GET response')
    adapter.mockRejectedValueOnce(lostResponse)
    await expect(getDispatchOperation(applyInput.operation_id)).rejects.toBe(lostResponse)
    expect(adapter.mock.calls.map(([config]) => config.method)).toEqual(['get'])
  })

  it('apply 丢响应后仅 GET 原号读取已提交组，不重复 POST', async () => {
    const lostResponse = new Error('synthetic lost apply response')
    adapter.mockRejectedValueOnce(lostResponse)
    await expect(applyDispatch(applyInput)).rejects.toBe(lostResponse)
    respond(resultBody)
    await expect(getDispatchOperation(applyInput.operation_id)).resolves.toEqual(resultBody)
    expect(adapter.mock.calls.map(([config]) => [config.method, config.url])).toEqual([
      ['post', '/api/v1/risk-items/dispatch'],
      ['get', '/api/v1/risk-items/dispatch-operations/original-operation'],
    ])
  })
})

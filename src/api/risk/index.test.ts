import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import request from '@vea/request'
import {
  assignRiskItemApi, assessRiskItemApi, createRiskItemApi, getRiskItemApi, getRiskOperationApi,
  listRiskItemsApi, riskHttpReader, riskHttpWriter,
} from './index'
import type { RiskAssessCommand, RiskCreateCommand, RiskReceiptDto, RiskViewDto } from './contracts'

vi.mock('@vea/request', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
beforeEach(() => {
  vi.mocked(request.get).mockReset()
  vi.mocked(request.post).mockReset()
})

// 本轮候选 RiskView（交接清单 §3）：ID/Revision 均为十进制字符串。
const view: RiskViewDto = {
  risk: { id: '9007199254740993', human_key: 'RISK-20261122-0001', revision: '3' },
  title: '合成漏洞',
  status: 'new',
  closure_kind: null,
  level: null,
  owner_user_id: null,
  org_id: '91001',
  affected_org_id: '91002',
  deadline: null,
  init_deadline: null,
  treatment: null,
  source_severity: { scheme: 'provider-five-level', value: '4' },
  asset_ref: { provider: 'mock-cmdb', external_id: 'asset-01' },
  dispatch_blockers: ['owner_unconfirmed'],
}
// 候选写回执实势：receipt_ref 为 RiskReceipt 对象（risk_item.go RiskMutationResult）。
const createReceipt: RiskReceiptDto = {
  operation_id: 'op-01', command: 'create', status: 'new', risk_id: '9007199254740993',
  revision: '1', created_at: '2026-11-22T08:00:00Z', replayed: false,
}

describe('risk-items 读取（existing request 层，silentError）', () => {
  it('列表带分页筛选参数并经投影校验返回', async () => {
    vi.mocked(request.get).mockResolvedValue({ items: [view], total: 1, page: 1, page_size: 20 } as never)
    await expect(listRiskItemsApi({ page: 2, page_size: 20, level: 'high' }))
      .resolves.toEqual({ items: [view], total: 1 })
    expect(request.get).toHaveBeenCalledWith('/api/v1/risk-items', {
      params: { page: 2, page_size: 20, level: 'high' }, _silentError: true, signal: undefined,
    })
    expectTypeOf<RiskViewDto['risk']['revision']>().toEqualTypeOf<string>()
  })

  it('详情按 URL 传递字符串大 ID，读取 view 包裹的列表字段', async () => {
    vi.mocked(request.get).mockResolvedValue({
      view, description: '合成说明', system_ref: '', evidence_refs: null, attributes: {}, source_summary: null,
    } as never)
    const record = await getRiskItemApi('9007199254740993')
    expect(record.view.risk.id).toBe('9007199254740993')
    expect(record.view.dispatch_blockers).toEqual(['owner_unconfirmed'])
    expect(record.description).toBe('合成说明')
    expect(request.get).toHaveBeenCalledWith('/api/v1/risk-items/9007199254740993', { _silentError: true, signal: undefined })
  })

  it.each([
    { items: [Number('9007199254740993')], total: 1 },
    null,
    { items: [{ ...view, status: 'other' }], total: 1 },
  ])('列表/详情响应形状漂移显式报错 %#', async body => {
    vi.mocked(request.get).mockResolvedValue(body as never)
    await expect(listRiskItemsApi({ page: 1, page_size: 20 })).rejects.toThrow('风险列表数据格式异常')
    vi.mocked(request.get).mockResolvedValue({ ...body, description: '', attributes: {} } as never)
    await expect(getRiskItemApi('9007199254740993')).rejects.toThrow()
  })
})

describe('按原号查回操作收据（GET /risk-items/operations/:id）', () => {
  it('查回 RiskReceipt 经校验返回，绑定页面默认读取端口', async () => {
    const receipt = { ...createReceipt, replayed: true }
    vi.mocked(request.get).mockResolvedValue(receipt as never)
    await expect(getRiskOperationApi('op-01')).resolves.toEqual(receipt)
    expect(request.get).toHaveBeenCalledWith('/api/v1/risk-items/operations/op-01', { _silentError: true, signal: undefined })
    expect(riskHttpReader.operation).toBe(getRiskOperationApi)
  })

  it.each([
    'rcpt-string',
    null,
    { operation_id: 'op-01', command: 'create' },
    { ...createReceipt, command: 'unknown-command' },
  ])('回执查回形状漂移显式报错 %#', async body => {
    vi.mocked(request.get).mockResolvedValue(body as never)
    await expect(getRiskOperationApi('op-01')).rejects.toThrow('操作回执数据格式异常')
  })
})

describe('risk-items 写命令（Mutation：body 携带 operation_id + expected_revision）', () => {
  it('人工登记恒传 expected_revision "0" 与空 attributes，对象回执经同号校验返回', async () => {
    const command: RiskCreateCommand = {
      operation_id: 'op-01',
      title: '合成漏洞',
      description: '说明',
      org_id: '91001',
      affected_org_id: '91002',
      owner_user_id: '92002',
      expected_revision: '0',
      attributes: {},
    }
    vi.mocked(request.post).mockResolvedValue({ risk: view.risk, status: 'new', receipt_ref: createReceipt } as never)
    await expect(createRiskItemApi(command)).resolves.toEqual({ risk: view.risk, status: 'new', receipt_ref: createReceipt })
    expect(request.post).toHaveBeenCalledWith('/api/v1/risk-items/create', command, { _silentError: true })
  })

  it('核实命令透传级别/策略/期限，回执对象与 deadline 空值归一', async () => {
    const command: RiskAssessCommand = {
      operation_id: 'op-02',
      id: '9007199254740993',
      expected_revision: '3',
      level: 'high',
      assessment_note: '资产台账核实',
      treatment: 'mitigate',
      deadline: '2026-11-22T17:00:00.000Z',
    }
    const receipt: RiskReceiptDto = { ...createReceipt, operation_id: 'op-02', command: 'assess', status: 'assessed', revision: '4' }
    vi.mocked(request.post).mockResolvedValueOnce({
      risk: view.risk, status: 'assessed', level: 'high', deadline: null, receipt_ref: receipt,
    } as never)
    await expect(assessRiskItemApi(command)).resolves.toEqual({
      risk: view.risk, status: 'assessed', level: 'high', deadline: null, receipt_ref: receipt,
    })
    expect(request.post).toHaveBeenCalledWith('/api/v1/risk-items/assess', command, { _silentError: true })
    expectTypeOf<RiskAssessCommand['expected_revision']>().toEqualTypeOf<string>()
  })

  it('责任确认命令透传责任人 ID 与理由', async () => {
    const receipt: RiskReceiptDto = { ...createReceipt, operation_id: 'op-03', command: 'assign', status: 'remediating' }
    vi.mocked(request.post).mockResolvedValue({ risk: view.risk, receipt_ref: receipt } as never)
    await expect(assignRiskItemApi({
      operation_id: 'op-03', id: '9007199254740993', expected_revision: '4', owner_user_id: '92002', reason: '台账核实',
    })).resolves.toEqual({ risk: view.risk, receipt_ref: receipt })
    expect(request.post).toHaveBeenCalledWith('/api/v1/risk-items/assign', {
      operation_id: 'op-03', id: '9007199254740993', expected_revision: '4', owner_user_id: '92002', reason: '台账核实',
    }, { _silentError: true })
  })

  it.each([
    { risk: view.risk, status: 'new', receipt_ref: { ...createReceipt, operation_id: 'op-other' } },
    { risk: view.risk, status: 'new', receipt_ref: 'rcpt-string' },
    { risk: { ...view.risk, revision: 3 }, status: 'new', receipt_ref: createReceipt },
  ])('写回执缺对象回执、异号或版本漂移显式报错 %#', async body => {
    vi.mocked(request.post).mockResolvedValue(body as never)
    await expect(createRiskItemApi({
      operation_id: 'op-04', title: 't', description: '', org_id: '91001', expected_revision: '0', attributes: {},
    })).rejects.toThrow('登记回执数据格式异常')
  })
})

it('页面默认端口绑定同一适配实现', () => {
  expect(riskHttpReader.list).toBe(listRiskItemsApi)
  expect(riskHttpReader.detail).toBe(getRiskItemApi)
  expect(riskHttpReader.operation).toBe(getRiskOperationApi)
  expect(riskHttpWriter.create).toBe(createRiskItemApi)
  expect(riskHttpWriter.assess).toBe(assessRiskItemApi)
  expect(riskHttpWriter.assign).toBe(assignRiskItemApi)
})

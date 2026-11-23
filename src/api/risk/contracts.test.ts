import { expect, expectTypeOf, it } from 'vitest'
import {
  ownerUnconfirmed, riskListParams, riskReceiptMatches, toRiskTablePage, validateRiskDetail,
  validateRiskReceipt, validateRiskRegistration, validateAssignResult, validateAssessResult, validateCreateResult,
  type RiskDetailDto, type RiskReceiptDto, type RiskRegistrationDraft, type RiskViewDto,
} from './contracts'

const id = '9223372036854775807'
// 本轮候选 RiskView（交接清单 §3）——校验字段与后端 Response 对齐。
const row: RiskViewDto = {
  risk: { id, human_key: 'RISK-20261122-0001', revision: '2' },
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
  source_severity: null,
  asset_ref: null,
  dispatch_blockers: ['owner_unconfirmed'],
}
// 候选详情实势：RiskDetailView.view 包裹列表行，另带 description/system_ref/evidence_refs
// （migrations 000089 后端实态，risk_item.go RiskDetailView）。
const detail: RiskDetailDto = {
  view: row,
  description: '合成说明',
  system_ref: 'core-ledger',
  evidence_refs: [{ provider: 'mock-scanner', external_id: 'EV-1' }],
  attributes: {},
  source_summary: null,
}
// 候选写回执实势：receipt_ref 为 RiskReceipt 对象（risk_item.go RiskMutationResult.Receipt）。
const receipt: RiskReceiptDto = {
  operation_id: 'op-1',
  command: 'create',
  status: 'new',
  risk_id: id,
  revision: '1',
  created_at: '2026-11-22T08:00:00Z',
  replayed: false,
}

it('分页转接保留相邻大 ID 与版本的完整字符串', () => {
  const other = { ...row, risk: { ...row.risk, id: '9223372036854775806' } }
  const page = toRiskTablePage({ items: [row, other], total: 2 })
  expect(page.list.map(item => item.risk.id)).toEqual([id, '9223372036854775806'])
  expect(page.list[0].risk.revision).toBe('2')
  expectTypeOf<RiskViewDto['risk']['id']>().toEqualTypeOf<string>()
  expectTypeOf<RiskViewDto['risk']['revision']>().toEqualTypeOf<string>()
  expectTypeOf<RiskViewDto['owner_user_id']>().toEqualTypeOf<string | null>()
  expectTypeOf<RiskDetailDto['view']['owner_user_id']>().toEqualTypeOf<string | null>()
  expectTypeOf<RiskReceiptDto['risk_id']>().toEqualTypeOf<string | undefined>()
  expectTypeOf<RiskRegistrationDraft['org_id']>().toEqualTypeOf<string>()
})

it.each([
  null,
  {},
  { items: [], total: null },
  { items: [row], total: 0 },
  { items: [{ ...row, risk: { ...row.risk, id: Number(id) } }], total: 1 },
  { items: [{ ...row, risk: { ...row.risk, revision: '9223372036854775808' } }], total: 1 },
  { items: [{ ...row, status: 'unknown-state' }], total: 1 },
  { items: [{ ...row, level: 'critical' }], total: 1 },
  { items: [{ ...row, org_id: '' }], total: 1 },
  { items: [{ ...row, dispatch_blockers: 'owner_unconfirmed' }], total: 1 },
])('损坏分页不得伪装成空页或有效记录 %#', value => {
  expect(() => toRiskTablePage(value)).toThrow('风险列表数据格式异常')
})

it.each([
  [undefined, false],
  [null, false],
  [[], false],
  [['owner_unconfirmed'], true],
] as const)('dispatch_blockers 空集序列化宽容，责任待确认按现势标记判断 %#', (blockers, expected) => {
  const parsed = toRiskTablePage({ items: [{ ...row, dispatch_blockers: blockers }], total: 1 })
  expect(ownerUnconfirmed(parsed.list[0])).toBe(expected)
  expect(ownerUnconfirmed(row)).toBe(true)
})

it('详情按 view 包裹读取并绑定请求 ID，旧扁平形状不作无损转换', () => {
  expect(validateRiskDetail({ ...detail, attributes: null, evidence_refs: null }, id)).toEqual({
    view: row, description: '合成说明', system_ref: 'core-ledger', evidence_refs: null, attributes: {}, source_summary: null,
  })
  expect(validateRiskDetail(detail, id).view.owner_user_id).toBeNull()
  for (const attributes of [['synthetic-tag'], 'synthetic-import', 2, false]) {
    expect(validateRiskDetail({ ...detail, attributes }, id).attributes).toEqual(attributes)
  }
  // 旧首片把列表行铺在 data 顶层（无 view 包裹）——形状漂移显式报错
  expect(() => validateRiskDetail({ ...row, description: '合成说明', attributes: {} }, id))
    .toThrow('风险详情数据格式异常')
  expect(() => validateRiskDetail({ ...detail, view: { ...row, risk: { ...row.risk, id: '9223372036854775806' } } }, id))
    .toThrow('风险详情数据格式异常')
  expect(() => validateRiskDetail({ ...detail, view: { ...row, owner_user_id: 9007199254740992 } }, id))
    .toThrow('风险详情数据格式异常')
  expect(() => validateRiskDetail({ ...detail, description: null }, id)).toThrow('风险详情数据格式异常')
  expect(() => validateRiskDetail({ ...detail, system_ref: 7 }, id)).toThrow('风险详情数据格式异常')
})

it.each([
  ['缺失 provider', [{ external_id: 'EV-1' }]],
  ['元素非对象', ['EV-1']],
  ['非数组', { provider: 'p', external_id: 'e' }],
])('详情 evidence_refs 形状漂移显式报错：%s', (_name, evidence) => {
  expect(() => validateRiskDetail({ ...detail, evidence_refs: evidence }, id)).toThrow('风险详情数据格式异常')
})

it('写回执 receipt_ref 为 RiskReceipt 对象并绑定本次操作号', () => {
  expect(validateCreateResult({ risk: row.risk, status: 'new', receipt_ref: receipt }, 'op-1'))
    .toEqual({ risk: row.risk, status: 'new', receipt_ref: receipt })
  // 旧首片的字符串回执号不再被接受（真实候选恒为对象）
  expect(() => validateCreateResult({ risk: row.risk, status: 'new', receipt_ref: 'rcpt-create-1' }, 'op-1'))
    .toThrow('登记回执数据格式异常')
  // 回执操作号与本次命令号不一致=形状漂移
  expect(() => validateCreateResult({ risk: row.risk, status: 'new', receipt_ref: { ...receipt, operation_id: 'op-x' } }, 'op-1'))
    .toThrow('登记回执数据格式异常')
  expect(() => validateCreateResult({ risk: { ...row.risk, id: Number(id) }, status: 'new', receipt_ref: receipt }, 'op-1'))
    .toThrow('登记回执数据格式异常')
})

it('核实回执校验状态、级别、期限空值与同号命令', () => {
  const assessReceipt: RiskReceiptDto = { ...receipt, command: 'assess', status: 'assessed', revision: '3' }
  const value = { risk: row.risk, status: 'assessed', level: 'high', deadline: null, receipt_ref: assessReceipt }
  expect(validateAssessResult(value, 'op-1')).toEqual(value)
  const omitted = { risk: value.risk, status: value.status, level: value.level, receipt_ref: value.receipt_ref }
  expect(validateAssessResult(omitted, 'op-1')).toEqual(value)
  expect(() => validateAssessResult({ ...omitted, deadline: 123 }, 'op-1')).toThrow('核实回执数据格式异常')
  expect(validateAssessResult({ ...value, deadline: '2026-11-22T17:00:00Z' }, 'op-1')).toEqual({
    ...value, deadline: '2026-11-22T17:00:00Z',
  })
  expect(() => validateAssessResult({ ...value, level: 'critical' }, 'op-1')).toThrow('核实回执数据格式异常')
  expect(() => validateAssessResult({ ...value, receipt_ref: { ...assessReceipt, command: 'create' } }, 'op-1'))
    .toThrow('核实回执数据格式异常')
})

it('责任确认回执校验风险引用与同号命令', () => {
  const assignReceipt: RiskReceiptDto = { ...receipt, command: 'assign', status: 'remediating' }
  expect(validateAssignResult({ risk: row.risk, receipt_ref: assignReceipt }, 'op-1'))
    .toEqual({ risk: row.risk, receipt_ref: assignReceipt })
  expect(() => validateAssignResult({ risk: row.risk }, 'op-1')).toThrow('责任确认回执数据格式异常')
})

it.each([
  ['回执缺操作号', { ...receipt, operation_id: '' }],
  ['回执缺命令', { ...receipt, command: 'unknown-command' }],
  ['回执缺状态', { ...receipt, status: 'unknown-status' }],
  ['回执缺发生时间', { ...receipt, created_at: ' ' }],
  ['replayed 非布尔', { ...receipt, replayed: 'yes' }],
  ['risk_id 数字漂移', { ...receipt, risk_id: 1 }],
  ['revision 越界', { ...receipt, revision: '9223372036854775808' }],
])('RiskReceipt 对象形状漂移显式报错：%s', (_name, drifted) => {
  expect(() => validateRiskReceipt(drifted)).toThrow('操作回执数据格式异常')
  expect(() => validateCreateResult({ risk: row.risk, status: 'new', receipt_ref: drifted }, 'op-1'))
    .toThrow('登记回执数据格式异常')
})

it('按原号查回的收据经形状校验，可选字段缺省宽容（Go omitempty）', () => {
  const replayed = { ...receipt, replayed: true }
  expect(validateRiskReceipt(replayed)).toEqual(replayed)
  const withoutRefs = { operation_id: 'op-2', command: 'assign', status: 'remediating', created_at: '2026-11-22T08:00:00Z', replayed: true }
  expect(validateRiskReceipt(withoutRefs)).toEqual(withoutRefs)
  expect(() => validateRiskReceipt('rcpt-1')).toThrow('操作回执数据格式异常')
  expect(() => validateRiskReceipt(null)).toThrow('操作回执数据格式异常')
})

it('只读核查按同号同命令匹配，跨命令与异号不匹配', () => {
  expect(riskReceiptMatches(receipt, 'op-1', 'create')).toBe(true)
  expect(riskReceiptMatches({ ...receipt, command: 'assess' }, 'op-1', 'create')).toBe(false)
  expect(riskReceiptMatches(receipt, 'op-2', 'create')).toBe(false)
})

it('只将生效的筛选与页码交给读取端口', () => {
  expect(riskListParams({ page: 3, page_size: 20 }, { q: ' 合成 ', level: 'high' }))
    .toEqual({ page: 3, page_size: 20, q: '合成', level: 'high' })
  expect(riskListParams({ page: 1, page_size: 20 }, { q: ' ', level: '' }))
    .toEqual({ page: 1, page_size: 20 })
})

it('登记保留大组织 ID，空的受影响组织与责任人不进入候选草稿', () => {
  const result = validateRiskRegistration({
    title: ' 合成漏洞 ', description: '合成说明', org_id: ` ${id} `, affected_org_id: ' ', owner_user_id: ' ',
  })
  expect(result).toEqual({
    draft: { title: '合成漏洞', description: '合成说明', org_id: id },
    errors: {},
  })
})

it('登记带出可选责任人与受影响组织', () => {
  const result = validateRiskRegistration({
    title: '合成漏洞', description: '', org_id: '91001',
    affected_org_id: ' 91002 ', owner_user_id: ' 92002 ',
  })
  expect(result.draft).toEqual({
    title: '合成漏洞', description: '', org_id: '91001',
    affected_org_id: '91002', owner_user_id: '92002',
  })
})

it('登记拦截空标题、超出 int64 的组织 ID 和非法责任人', () => {
  const result = validateRiskRegistration({
    title: ' ', description: '', org_id: '9223372036854775808', affected_org_id: '0', owner_user_id: 'abc',
  })
  expect(result.draft).toBeNull()
  expect(Object.keys(result.errors)).toEqual(['title', 'org_id', 'affected_org_id', 'owner_user_id'])
})

it('登记成对提交 finding_key 与资产引用（provider+external_id，含 trim）', () => {
  const result = validateRiskRegistration({
    title: '合成漏洞', description: '', org_id: '91001', affected_org_id: '', owner_user_id: '',
    finding_key: ' SYN-FINDING-001 ', asset_ref_provider: ' synthetic-cmdb ', asset_ref_external_id: ' asset-9 ',
  })
  expect(result.errors).toEqual({})
  expect(result.draft).toEqual({
    title: '合成漏洞', description: '', org_id: '91001',
    finding_key: 'SYN-FINDING-001', asset_ref: { provider: 'synthetic-cmdb', external_id: 'asset-9' },
  })
})

it('旧模式兼容：finding_key 与资产引用缺省或全空时不进入候选草稿', () => {
  const absent = validateRiskRegistration({
    title: '合成漏洞', description: '', org_id: '91001', affected_org_id: '', owner_user_id: '',
  })
  expect(absent.errors).toEqual({})
  expect(absent.draft).toEqual({ title: '合成漏洞', description: '', org_id: '91001' })
  expect(absent.draft).not.toHaveProperty('finding_key')
  expect(absent.draft).not.toHaveProperty('asset_ref')

  const blank = validateRiskRegistration({
    title: '合成漏洞', description: '', org_id: '91001', affected_org_id: '', owner_user_id: '',
    finding_key: ' ', asset_ref_provider: '', asset_ref_external_id: ' ',
  })
  expect(blank.errors).toEqual({})
  expect(blank.draft).toEqual({ title: '合成漏洞', description: '', org_id: '91001' })
})

it('发现键与资产引用不成对即拦截：缺发现键、缺资产或半填资产', () => {
  const base = { title: '合成漏洞', description: '', org_id: '91001', affected_org_id: '', owner_user_id: '' }
  const onlyFinding = validateRiskRegistration({ ...base, finding_key: 'SYN-FINDING-001' })
  expect(onlyFinding.draft).toBeNull()
  expect(Object.keys(onlyFinding.errors)).toEqual(['finding_key'])

  const onlyAsset = validateRiskRegistration({
    ...base, asset_ref_provider: 'synthetic-cmdb', asset_ref_external_id: 'asset-9',
  })
  expect(onlyAsset.draft).toBeNull()
  expect(Object.keys(onlyAsset.errors)).toEqual(['finding_key'])

  const halfAsset = validateRiskRegistration({
    ...base, finding_key: 'SYN-FINDING-001', asset_ref_provider: 'synthetic-cmdb',
  })
  expect(halfAsset.draft).toBeNull()
  expect(Object.keys(halfAsset.errors)).toEqual(['finding_key', 'asset_ref'])

  const externalOnly = validateRiskRegistration({
    ...base, asset_ref_external_id: 'asset-9',
  })
  expect(externalOnly.draft).toBeNull()
  expect(Object.keys(externalOnly.errors)).toEqual(['finding_key', 'asset_ref'])
})

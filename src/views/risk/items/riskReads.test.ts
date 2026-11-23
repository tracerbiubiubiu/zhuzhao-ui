import { expect, it, vi } from 'vitest'
import { deferred, httpError } from '@/test/sfcHarness'
import type { RiskDetailDto, RiskPageDto, RiskReader, RiskViewDto } from '@/api/risk/contracts'
import { useRiskReads } from './riskReads'

const row: RiskViewDto = {
  risk: { id: '9007199254740993', human_key: 'RISK-20261122-0001', revision: '1' },
  title: '合成漏洞',
  status: 'new',
  closure_kind: null,
  level: 'high',
  owner_user_id: null,
  org_id: '91001',
  affected_org_id: '91002',
  deadline: '2026-11-23T09:00:00Z',
  init_deadline: null,
  treatment: null,
  source_severity: null,
  asset_ref: { provider: 'mock-cmdb', external_id: 'asset-01' },
  dispatch_blockers: ['owner_unconfirmed'],
}
// 候选详情实势：RiskDetailView.view 包裹列表行（risk_item.go）。
const detail: RiskDetailDto = {
  view: row,
  description: '合成说明',
  system_ref: '',
  evidence_refs: null,
  attributes: {},
  source_summary: null,
}
const query = { page: 1, page_size: 20, level: 'high' } as const
const firstPage = { items: [row], total: 1 }

it('缺读取权限或数据源时无请求，撤权后迟到列表和详情失效', async () => {
  const list = deferred<RiskPageDto>()
  const detailRequest = deferred<RiskDetailDto>()
  const reader = { list: vi.fn(() => list.promise), detail: vi.fn(() => detailRequest.promise), operation: vi.fn() }
  let granted = false
  const reads = useRiskReads(() => granted ? reader : undefined)
  await expect(reads.fetchList(query)).rejects.toMatchObject({ name: 'AbortError' })
  await reads.openDetail(row.risk.id)
  expect(reader.list).not.toHaveBeenCalled()
  expect(reader.detail).not.toHaveBeenCalled()

  granted = true
  const pendingList = expect(reads.fetchList(query)).rejects.toMatchObject({ name: 'AbortError' })
  const pendingDetail = reads.openDetail(row.risk.id)
  granted = false
  reads.clearList()
  reads.closeDetail()
  detailRequest.resolve(detail)
  list.resolve(firstPage)
  await Promise.all([pendingDetail, pendingList])
  expect(reads.list.value).toEqual({ kind: 'idle' })
  expect(reads.detail.value).toEqual({ kind: 'closed' })
})

it('列表成功零条、读故障和超出末页使用独立状态', async () => {
  const failure = httpError(503, '合成读取故障')
  const reader = {
    operation: vi.fn(),
    list: vi.fn<RiskReader['list']>()
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ items: [], total: 1 }),
    detail: vi.fn(),
  }
  const reads = useRiskReads(() => reader)
  await expect(reads.fetchList(query)).resolves.toEqual({ list: [], total: 0 })
  expect(reads.list.value).toEqual({ kind: 'empty', total: 0 })
  await expect(reads.fetchList(query)).rejects.toBe(failure)
  expect(reads.list.value).toEqual({ kind: 'error', message: '合成读取故障' })
  await reads.fetchList({ ...query, page: 2 })
  expect(reads.list.value).toEqual({ kind: 'empty', total: 1 })
})

it('403 读取失败不冒充成功空集，按无权提示', async () => {
  const reader = { list: vi.fn<RiskReader['list']>().mockRejectedValue(httpError(403)), detail: vi.fn(), operation: vi.fn() }
  const reads = useRiskReads(() => reader)
  await expect(reads.fetchList(query)).rejects.toMatchObject({ response: { status: 403 } })
  expect(reads.list.value).toEqual({ kind: 'error', message: '无权查看，请联系管理员' })
})

it('筛选一变即撤销旧列表的回写资格', async () => {
  const old = deferred<RiskPageDto>()
  const reader = {
    operation: vi.fn(),
    list: vi.fn<RiskReader['list']>().mockReturnValueOnce(old.promise).mockResolvedValueOnce(firstPage),
    detail: vi.fn(),
  }
  const reads = useRiskReads(() => reader)
  const pending = expect(reads.fetchList({ ...query, page: 3 })).rejects.toMatchObject({ name: 'AbortError' })
  const signal = reader.list.mock.calls[0][1]
  reads.clearList()
  expect(signal.aborted).toBe(true)
  expect(reads.list.value).toEqual({ kind: 'idle' })
  await reads.fetchList({ ...query, q: '新筛选' })
  old.reject(httpError(403))
  await pending
  expect(reads.list.value).toEqual({ kind: 'ready' })
})

it('关闭后重开同一个大 ID，旧详情错误不会覆盖新结果', async () => {
  const old = deferred<RiskDetailDto>()
  const reader = {
    list: vi.fn(),
    detail: vi.fn<RiskReader['detail']>().mockReturnValueOnce(old.promise).mockResolvedValueOnce(detail),
    operation: vi.fn(),
  }
  const reads = useRiskReads(() => reader)
  const first = reads.openDetail(row.risk.id)
  reads.closeDetail()
  await reads.openDetail(row.risk.id)
  expect(reader.detail.mock.calls.map(([id]) => id)).toEqual(['9007199254740993', '9007199254740993'])
  old.reject(httpError(404))
  await first
  expect(reads.detail.value).toEqual({ kind: 'ready', id: row.risk.id, record: detail })
})

it.each([[403, '无权查看'], [404, '未找到'], [503, '加载失败']])('详情异常 %s 保留当前目标及提示', async (status, text) => {
  const reader = { list: vi.fn(), detail: vi.fn().mockRejectedValue(httpError(status)), operation: vi.fn() }
  const reads = useRiskReads(() => reader)
  await reads.openDetail(row.risk.id)
  expect(reads.detail.value).toMatchObject({
    kind: 'error', id: row.risk.id, message: expect.stringContaining(text),
  })
})

it('详情响应形状与请求 ID 漂移按加载失败呈现', async () => {
  const reader = {
    list: vi.fn(),
    detail: vi.fn<RiskReader['detail']>().mockResolvedValue({ ...detail, view: { ...detail.view, risk: { ...detail.view.risk, id: '91002' } } }),
    operation: vi.fn(),
  }
  const reads = useRiskReads(() => reader)
  await reads.openDetail(row.risk.id)
  expect(reads.detail.value).toMatchObject({
    kind: 'error', id: row.risk.id, message: expect.stringContaining('详情加载失败'),
  })
})

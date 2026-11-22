import { describe, expect, it, vi } from 'vitest'
import {
  listPublicationDraftsApi, planDefinitionPublicationApi, publishDefinitionApi, readPublicationBaseline, type PublicationPlan, type PublicationTarget,
} from '@/api/ticket/definitionPublication'
import { createDefinitionPublication } from './definitionPublication'

const request = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@vea/request', () => ({ default: request }))

const target: PublicationTarget = { id: '11', code: 'sample', name: '合成工单', version: 2, draft_revision: '9007199254740993', current_published_version: null }
const baseline = { code: 'sample', expected_draft_revision: '9007199254740993', expected_published_version: null }
const plan: PublicationPlan = { plan_id: 'plan-1', plan_hash: 'hash-1', warnings: [], errors: [] }
const receipt = {
  changed: true,
  definition_ref: { type_code: 'sample', definition_version: '1', definition_hash: 'published-hash' },
}

function fixture() {
  const deps = {
    allowed: vi.fn(() => true),
    generation: vi.fn(() => 1),
    newKey: vi.fn(() => 'operation-1'),
    plan: vi.fn(async () => plan),
    publish: vi.fn(async () => receipt),
    refresh: vi.fn(async () => [target]),
    onPublished: vi.fn(),
  }
  return { deps, publication: createDefinitionPublication(deps) }
}

describe('工单草稿的显式发布', () => {
  it('首发空指针必须明确，旧版数值只兼容安全整数', () => {
    expect(readPublicationBaseline(target)).toEqual(baseline)
    expect(readPublicationBaseline({ code: 'sample', version: 2 })).toBeNull()
    expect(readPublicationBaseline({ code: 'sample', version: 2, current_published_version: '1' })).toEqual({
      code: 'sample', expected_draft_revision: '2', expected_published_version: '1',
    })
    expect(readPublicationBaseline({ code: 'sample', version: Number.MAX_SAFE_INTEGER + 1, current_published_version: '1' })).toBeNull()
  })

  it('预览只计划，显式确认才发布并记录回执', async () => {
    const { publication, deps } = fixture()
    await publication.open(target)
    expect(deps.plan).toHaveBeenCalledExactlyOnceWith(baseline)
    expect(deps.publish).not.toHaveBeenCalled()
    await publication.submit()
    expect(deps.publish).toHaveBeenCalledExactlyOnceWith({ ...baseline, plan_id: 'plan-1', plan_hash: 'hash-1' }, 'operation-1')
    expect(publication.state.receipt).toEqual(receipt)
    expect(deps.onPublished).toHaveBeenCalledExactlyOnceWith(receipt)
    await publication.submit()
    expect(deps.publish).toHaveBeenCalledTimes(1)
  })

  it('发送预览与发布的实际路由、字符串修订和幂等头，只接受目标类型的有效回执', async () => {
    const preview = { changed: true, current_definition_ref: null, reference_revisions: {} }
    request.post.mockResolvedValueOnce({ plan_id: plan.plan_id, canonical_hash: plan.plan_hash, warnings: [], ...preview }).mockResolvedValueOnce(receipt)
    expect(await planDefinitionPublicationApi(baseline)).toEqual({ ...plan, diff: preview })
    const confirm = { ...baseline, plan_id: plan.plan_id, plan_hash: plan.plan_hash }
    expect(await publishDefinitionApi(confirm, 'operation-1')).toEqual(receipt)
    expect(request.post).toHaveBeenNthCalledWith(1, '/api/v1/ticket-types/definitions/plan', baseline, { _silentError: true })
    expect(request.post).toHaveBeenNthCalledWith(2, '/api/v1/ticket-types/definitions/publish', { ...baseline, plan_id: plan.plan_id, canonical_hash: plan.plan_hash }, {
      _silentError: true, headers: { 'Idempotency-Key': 'operation-1' },
    })
    request.post.mockResolvedValueOnce({ ...receipt, definition_ref: { ...receipt.definition_ref, type_code: 'other' } })
    await expect(publishDefinitionApi(confirm, 'operation-1')).rejects.toThrow('未能核实规则发布回执')
  })

  it('请求结果未知后重开仍用原计划与原号，忽略新的草稿版本', async () => {
    const { publication, deps } = fixture()
    await publication.open(target)
    deps.publish.mockRejectedValueOnce(new Error('timeout'))
    await publication.submit()
    expect(publication.state.uncertain).toBe(true)
    publication.close()
    await publication.open({ ...target, draft_revision: '9007199254740994', current_published_version: '1' })
    expect(deps.plan).toHaveBeenCalledTimes(1)
    await publication.submit()
    expect(deps.publish.mock.calls[1]).toEqual(deps.publish.mock.calls[0])
    expect(deps.newKey).toHaveBeenCalledTimes(1)
  })

  it('原响应丢失后重试被撤权，保留待核实的原计划和操作号', async () => {
    const { publication, deps } = fixture()
    await publication.open(target)
    deps.publish.mockRejectedValueOnce(new Error('timeout'))
    deps.publish.mockRejectedValueOnce({ response: { status: 403, data: { code: 10003, message: '权限已撤销' } } })
    await publication.submit()
    await publication.submit()
    expect(publication.state.uncertain).toBe(true)
    expect(publication.state.operationId).toBe('operation-1')
    expect(publication.state.error).toContain('权限已撤销')
    await publication.submit()
    expect(deps.publish.mock.calls[2]).toEqual(deps.publish.mock.calls[0])
    expect(publication.state.receipt).toEqual(receipt)
  })

  it('草稿清单成功空集与响应缺失分别处理', async () => {
    request.get.mockResolvedValueOnce({ types: [] }).mockResolvedValueOnce({}).mockResolvedValueOnce({ types: [target] })
    expect(await listPublicationDraftsApi()).toEqual([])
    await expect(listPublicationDraftsApi()).rejects.toThrow('草稿清单')
    expect(await listPublicationDraftsApi()).toEqual([target])
  })

  it('明确版本冲突后刷新预览，撤去当前权限即停发', async () => {
    const { publication, deps } = fixture()
    await publication.open(target)
    deps.publish.mockRejectedValueOnce({ response: { status: 409, data: { code: 10006 } } })
    await publication.submit()
    expect(publication.state.plan).toBeNull()
    expect(publication.state.error).toContain('刷新')
    deps.refresh.mockResolvedValueOnce([{ ...target, draft_revision: '9007199254740994', current_published_version: '2' }])
    await publication.refresh()
    expect(deps.plan).toHaveBeenLastCalledWith({ ...baseline, expected_draft_revision: '9007199254740994', expected_published_version: '2' })
    deps.allowed.mockReturnValue(false)
    await publication.submit()
    expect(deps.publish).toHaveBeenCalledTimes(1)
  })

  it('对预览告警要求显式确认，并提交服务端告警 ID', async () => {
    const { publication, deps } = fixture()
    deps.plan.mockResolvedValueOnce({ ...plan, warnings: [{ id: 'warn-1', message: '合成告警' }] })
    await publication.open(target)
    await publication.submit()
    expect(deps.publish).not.toHaveBeenCalled()
    publication.state.warningsAccepted = true
    await publication.submit()
    expect(deps.publish).toHaveBeenCalledExactlyOnceWith({ ...baseline, plan_id: 'plan-1', plan_hash: 'hash-1', acknowledged_warning_ids: ['warn-1'] }, 'operation-1')
  })

  it('同码重建时，刷新后拒绝用新对象代替原目标', async () => {
    const { publication, deps } = fixture()
    deps.refresh.mockResolvedValueOnce([{ ...target, id: '12' }])
    await publication.open(target)
    expect(deps.plan).not.toHaveBeenCalled()
    expect(publication.state.error).toContain('已删除或替换')
  })
})

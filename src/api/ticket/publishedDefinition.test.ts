import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from '@vea/request'
import { createTicketFromDefinitionApi, getPublishedTicketDefinitionApi } from './publishedDefinition'

vi.mock('@vea/request', () => ({ default: { get: vi.fn(), post: vi.fn() } }))

const ref = { type_code: 'synthetic', definition_version: '9007199254740993', definition_hash: 'synthetic-hash' }
const published = { type: { code: 'synthetic', name: '合成类型' }, fields: [], definition_ref: ref }

describe('发起规则接口', () => {
  beforeEach(() => vi.resetAllMocks())

  it('读取已发布规则时保留空字段数组，创建时发送预览的精确版本与摘要', async () => {
    vi.mocked(request.get).mockResolvedValueOnce(published as never)
    const definition = await getPublishedTicketDefinitionApi('synthetic')
    expect(request.get).toHaveBeenCalledWith('/api/v1/ticket-types/synthetic/published', { _silentError: true })
    expect(definition).toEqual(published)
    vi.mocked(request.post).mockResolvedValueOnce({ id: '42' } as never)
    const input = { type_code: 'synthetic', title: '合成标题', org_id: '7' }
    await createTicketFromDefinitionApi(input, definition.definition_ref)
    expect(request.post).toHaveBeenCalledWith('/api/v1/tickets', {
      ...input, definition_version: ref.definition_version, definition_hash: ref.definition_hash,
    }, { _silentError: true })
  })

  it.each([
    { ...published, fields: undefined },
    { ...published, fields: [{ field_key: 'unusable', field_type: 'unrecognized' }] },
    { ...published, definition_ref: { ...ref, definition_version: 1 } },
    { ...published, definition_ref: { ...ref, type_code: 'different' } },
    { ...published, type: { ...published.type, is_active: false } },
  ])('拒绝不完整、错类型或不可用的已发布定义 %#', async payload => {
    vi.mocked(request.get).mockResolvedValueOnce(payload as never)
    await expect(getPublishedTicketDefinitionApi('synthetic')).rejects.toThrow()
  })
})

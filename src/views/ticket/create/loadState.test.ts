import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { deferred, preparePage, setupPage, httpError, settle } from '@/test/sfcHarness'
import { richtextDraftKey } from '@/components/useRichtextDraft'
import source from './index.vue?raw'
preparePage(source)
function setup(mine: Promise<unknown> = Promise.resolve([]), all: Promise<unknown> = Promise.resolve([])) {
  const api = {
    getMyOrgsApi: vi.fn().mockReturnValue(mine), getOrgTreeApi: vi.fn().mockReturnValue(all),
    getDictItemsByCodeApi: vi.fn(), getTicketTypeFieldsApi: vi.fn().mockResolvedValue([]),
    getPublishedTicketDefinitionApi: vi.fn(), createTicketFromDefinitionApi: vi.fn(),
  }
  const router = { push: vi.fn() }
  const { page, lifecycle } = setupPage(source, {
    '@/api/org/selfService': api, '@/api/system/org': api, '@/api/system/dict': api, '@/api/ticket': api,
    '@/api/ticket/publishedDefinition': api,
    '@/api/storage': {}, '@/components/UserPicker/index.vue': {}, '@/components/RichtextField.vue': {},
    '@/components/useRichtextDraft': { richtextDraftKey },
    '@/common/auth/tokenStorage': { getSessionGeneration: () => 1 },
    '@/store/modules/user': { useUserStore: () => ({ profile: { id: '7', employee_no: 'synthetic' } }) },
    'element-plus': { ElMessage: { success: vi.fn() } }, 'vue-router': { useRouter: () => router },
    '@tanstack/vue-query': { useQuery: () => ({ data: ref([]) }) },
  })
  return { page, api, router, lifecycle }
}
function definition(code: string, version: string, fields: unknown[] = []) {
  return {
    type: { code, name: '合成工单' },
    fields,
    definition_ref: { type_code: code, definition_version: version, definition_hash: `hash-${version}` },
  }
}
describe('建单的组织与字典读取状态', () => {
  it('自服务故障不能冒充未入组，也不继续请求管理列表', async () => {
    const { page, api } = setup(Promise.reject(httpError(503, '组织暂不可用')))
    await settle()
    expect(api.getOrgTreeApi).not.toHaveBeenCalled()
    expect(page.orgsError?.value ?? '').toContain('组织暂不可用')
    api.getMyOrgsApi.mockResolvedValueOnce([{ org_id: '42', org_name: '合成组织' }])
    await page.loadOrgs()
    expect(page.orgsError.value).toBe('')
    expect(page.orgOptions.value).toEqual([{ value: '42', label: '合成组织' }])
  })
  it('成功空组织与管理列表故障/无权分别呈现', async () => {
    const { page, api } = setup()
    await settle()
    expect(page.orgsError?.value ?? '').toBe('')
    expect(page.orgOptions.value).toEqual([])
    api.getOrgTreeApi.mockRejectedValueOnce(httpError(503, '组织树故障'))
    await page.loadOrgs?.()
    expect(page.orgsError?.value ?? '').toContain('组织树故障')
    api.getOrgTreeApi.mockRejectedValueOnce(httpError(403))
    await page.loadOrgs()
    expect(page.orgsError.value).toContain('无权')
  })
  it('字典失败不缓存为空，重新加载字段可恢复且清错误', async () => {
    const { page, api } = setup()
    api.getPublishedTicketDefinitionApi.mockResolvedValue(definition('a', '1', [
      { field_key: 'choice', field_type: 'select', field_options: ['dict:choices'] },
    ]))
    api.getDictItemsByCodeApi.mockRejectedValueOnce(httpError(503, '字典故障')).mockResolvedValueOnce([{ code: 'a', label: '合成选项' }])
    page.form.type_code = 'a'
    await settle()
    expect(page.dictCache.value.choices).toBeUndefined()
    expect(page.dictErrors?.value.choices ?? '').toContain('字典故障')
    await page.loadPublishedDefinition('a')
    await settle()
    expect(api.getDictItemsByCodeApi).toHaveBeenCalledTimes(2)
    expect(page.optionsOf(page.fields.value[0])).toEqual([{ value: 'a', label: '合成选项' }])
    expect(page.dictErrors.value.choices).toBeFalsy()
  })
})

describe('常规发起使用已发布规则', () => {
  it('只采纳当前类型的已发布回包，提交所预览的版本和字段', async () => {
    const { page, api, router } = setup()
    const stale = deferred()
    const selected = definition('new', '9007199254740993', [{ field_key: 'evidence', field_type: 'input' }])
    api.getPublishedTicketDefinitionApi.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(selected)
    api.createTicketFromDefinitionApi.mockResolvedValue({ id: '42' })
    page.form.type_code = 'old'
    page.form.type_code = 'new'
    await settle()
    stale.resolve(definition('old', '1'))
    await settle()
    expect(api.getPublishedTicketDefinitionApi.mock.calls).toEqual([['old'], ['new']])
    expect(api.getTicketTypeFieldsApi).not.toHaveBeenCalled()
    expect(page.definition.value).toEqual(selected)
    expect(page.visibleFields.value).toEqual(selected.fields)
    page.form.title = '合成标题'
    page.form.org_id = '4'
    page.form.custom = { evidence: '合成证据' }
    page.formRef.value = { validate: () => Promise.resolve(true), clearValidate: vi.fn() }
    await Promise.all([page.handleSubmit(), page.handleSubmit()])
    expect(api.createTicketFromDefinitionApi).toHaveBeenCalledOnce()
    expect(api.createTicketFromDefinitionApi).toHaveBeenCalledWith(expect.objectContaining({
      type_code: 'new', title: '合成标题', org_id: '4', custom_data: { evidence: '合成证据' },
    }), selected.definition_ref)
    expect(router.push).toHaveBeenCalledWith('/tickets/42')
    expect(page.form.type_code).toBe('')
  })

  it('已发布定义故障阻断提交，版本冲突后要求重新读取并保留表单', async () => {
    const { page, api } = setup()
    const current = definition('a', '1')
    api.getPublishedTicketDefinitionApi.mockRejectedValueOnce(httpError(503, '暂时无法读取规则'))
      .mockResolvedValueOnce(current)
    api.createTicketFromDefinitionApi.mockRejectedValueOnce(httpError(409, '规则已更新'))
    page.formRef.value = { validate: () => Promise.resolve(true) }
    page.form.type_code = 'a'
    page.form.title = '合成标题'
    await settle()
    expect(page.fieldsError.value).toContain('暂时无法读取规则')
    await page.handleSubmit()
    expect(api.createTicketFromDefinitionApi).not.toHaveBeenCalled()
    await page.loadPublishedDefinition('a')
    expect(page.fieldsReady.value).toBe(true)
    await page.handleSubmit()
    expect(page.form.title).toBe('合成标题')
    expect(page.definition.value).toEqual(current)
    expect(page.fieldsReady.value).toBe(false)
    expect(page.errorMsg.value).toContain('刷新已发布定义')
    await page.handleSubmit()
    expect(api.createTicketFromDefinitionApi).toHaveBeenCalledOnce()
  })

  it('再次进入缓存页后读取新版本，确认前保留原填值并停用提交', async () => {
    const { page, api, lifecycle } = setup()
    const first = definition('a', '1', [{ field_key: 'remedy', field_type: 'input' }])
    const latest = definition('a', '2', [{ field_key: 'environment', field_type: 'input', required: true }])
    api.getPublishedTicketDefinitionApi.mockResolvedValueOnce(first).mockResolvedValueOnce(latest)
    page.form.type_code = 'a'
    page.form.title = '合成标题'
    await settle()
    page.form.custom = { remedy: '合成原输入' }
    lifecycle.activate()
    await settle()
    expect(page.definition.value).toEqual(first)
    expect(page.nextDefinition.value).toEqual(latest)
    expect(page.fieldsReady.value).toBe(false)
    expect(page.form.custom.remedy).toBe('合成原输入')
    const clearDraft = vi.fn()
    page.richtextRefs.value = [{ clearDraft }]
    page.confirmNewDefinition()
    expect(clearDraft).toHaveBeenCalledOnce()
    expect(page.definition.value).toEqual(latest)
    expect(page.fieldsReady.value).toBe(true)
    expect(page.form.custom).toEqual({})
    expect(page.form.title).toBe('合成标题')
  })

  it('同名富文本字段按发布版本和摘要隔离草稿', async () => {
    const { page, api } = setup()
    api.getPublishedTicketDefinitionApi.mockResolvedValueOnce(definition('a', '1')).mockResolvedValueOnce(definition('a', '2'))
    expect(page.draftKeyFor?.('detail')).toBeUndefined()
    page.form.type_code = 'a'
    await settle()
    const versionOne = page.draftKeyFor?.('detail')
    expect(versionOne).toContain('hash-1')
    expect(versionOne).not.toBe(richtextDraftKey('7', 'a', 'detail'))
    await page.loadPublishedDefinition('a')
    expect(page.draftKeyFor('detail')).not.toBe(versionOne)
    expect(page.draftKeyFor('detail')).toContain('hash-2')
  })

  it('离开后收到创建成功不会导航，回到发起页仍可查看已建工单', async () => {
    const { page, api, router, lifecycle } = setup()
    api.getPublishedTicketDefinitionApi.mockResolvedValue(definition('a', '1'))
    const create = deferred()
    api.createTicketFromDefinitionApi.mockReturnValueOnce(create.promise)
    page.formRef.value = { validate: () => Promise.resolve(true), clearValidate: vi.fn() }
    page.form.type_code = 'a'
    await settle()
    const waiting = page.handleSubmit()
    await settle()
    expect(api.createTicketFromDefinitionApi).toHaveBeenCalledOnce()
    lifecycle.deactivate()
    create.resolve({ id: '81' })
    await waiting
    expect(router.push).not.toHaveBeenCalled()
    expect(page.createdTicketId.value).toBe('81')
    expect(page.form.type_code).toBe('')
  })
})

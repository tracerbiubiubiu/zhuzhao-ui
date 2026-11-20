import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { preparePage, setupPage, httpError, settle } from '@/test/sfcHarness'
import source from './index.vue?raw'
preparePage(source)
function setup(mine: Promise<unknown> = Promise.resolve([]), all: Promise<unknown> = Promise.resolve([])) {
  const api = { getMyOrgsApi: vi.fn().mockReturnValue(mine), getOrgTreeApi: vi.fn().mockReturnValue(all), getDictItemsByCodeApi: vi.fn(), getTicketTypeFieldsApi: vi.fn() }
  const { page } = setupPage(source, {
    '@/api/org/selfService': api, '@/api/system/org': api, '@/api/system/dict': api, '@/api/ticket': api,
    '@/api/storage': {}, '@/components/UserPicker/index.vue': {}, '@/components/RichtextField.vue': {}, '@/components/useRichtextDraft': {},
    '@/store/modules/user': { useUserStore: () => ({ profile: { employee_no: 'synthetic' } }) },
    'element-plus': {}, 'vue-router': { useRouter: () => ({}) },
    '@tanstack/vue-query': { useQuery: () => ({ data: ref([]) }) },
  })
  return { page, api }
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
    api.getTicketTypeFieldsApi.mockResolvedValue([{ field_key: 'choice', field_type: 'select', field_options: ['dict:choices'] }])
    api.getDictItemsByCodeApi.mockRejectedValueOnce(httpError(503, '字典故障')).mockResolvedValueOnce([{ code: 'a', label: '合成选项' }])
    await page.loadTypeFields('a')
    await settle()
    expect(page.dictCache.value.choices).toBeUndefined()
    expect(page.dictErrors?.value.choices ?? '').toContain('字典故障')
    await page.loadTypeFields('a')
    await settle()
    expect(page.optionsOf(page.fields.value[0])).toEqual([{ value: 'a', label: '合成选项' }])
    expect(page.dictErrors.value.choices).toBeFalsy()
  })
})

import { ref } from 'vue'
import { expect, it, vi } from 'vitest'
import { preparePage, setupPage, httpError, settle } from '@/test/sfcHarness'
import source from './index.vue?raw'
preparePage(source)
it('详情字典失败不缓存为空，重试保留含停用项回显语义', async () => {
  const api = { getDictItemsByCodeApi: vi.fn().mockRejectedValueOnce(httpError(503, '字典回显故障')).mockResolvedValueOnce([{ code: 'a', label: '历史选项', enabled: false }]) }
  const { page } = setupPage(source, {
    '@/api/ticket': {}, '@/api/system/dict': api, 'element-plus': {}, 'vue-router': { useRouter: () => ({}) },
    '@/store/modules/user': { useUserStoreWithOut: () => ({ hasPermission: () => false }) },
    '@/components/UserNameText/index.vue': {}, '@/components/UserPicker/index.vue': {}, '@/components/TicketAttachments.vue': {},
    './useRenderedRichtext': { useRenderedRichtext: () => ({}) },
    './relationSession': { createRelationSession: () => ({ state: {}, reset: () => undefined }) },
    '@tanstack/vue-query': { useQuery: () => ({ data: ref(undefined) }), useQueryClient: () => ({}) },
  }, { ticketId: '42' })
  const field = { field_key: 'choice', field_type: 'select', field_options: ['dict:choices'] }
  page.typeFieldsQuery.data.value = [field]
  await settle()
  expect(page.dictCache.value.choices).toBeUndefined()
  expect(page.dictErrors?.value.choices ?? '').toContain('字典回显故障')
  await page.loadDictionary('choices')
  expect(api.getDictItemsByCodeApi).toHaveBeenLastCalledWith('choices', true, { _silentError: true })
  expect(page.labelOf(field, 'a')).toBe('历史选项')
  expect(page.dictErrors.value.choices).toBeFalsy()
})

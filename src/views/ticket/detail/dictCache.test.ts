import { ref, unref, type MaybeRef } from 'vue'
import { expect, it, vi } from 'vitest'
import { preparePage, setupPage, httpError, settle } from '@/test/sfcHarness'
import { normalizeTicketDefinition } from '@/api/ticket/instanceActions'
import { newTicketOperationKey } from '@/api/ticket/operationKey'
import { createTransitionSubmission } from './transitionSubmission'
import { useRenderedRichtext } from './useRenderedRichtext'
import source from './index.vue?raw'

vi.mock('@vea/request', () => ({ default: {} }))

preparePage(source)

function setupDetail(extra = {}) {
  const row = { id: '42', type_code: 'synthetic', status: 'in_progress', ...extra }
  const detail = ref({ row, definition: normalizeTicketDefinition(row) })
  const dictionaries = { getDictItemsByCodeApi: vi.fn() }
  const transition = vi.fn()
  const writes = { updateTicketApi: vi.fn(), closeTicketApi: vi.fn(), assignTicketApi: vi.fn(), addTicketTagsApi: vi.fn(), addTicketCCApi: vi.fn() }
  const relationActive = vi.fn()
  const refresh = vi.fn()
  const { page, lifecycle } = setupPage(source, {
    '@/api/ticket': { STATUS_LABEL: {}, ...writes },
    '@/api/ticket/instanceActions': { getInstanceActionsApi: vi.fn(), normalizeTicketDefinition, transitionInstanceApi: transition },
    '@/api/ticket/operationKey': { newTicketOperationKey },
    '@/api/risk/remediation': { getRemediationContextApi: vi.fn(), getRemediationOperationApi: vi.fn() },
    '@/api/system/dict': dictionaries,
    '@/common/auth/tokenStorage': { getSessionGeneration: () => 1 },
    'element-plus': { ElMessage: { success: vi.fn() } },
    'vue-router': { useRouter: () => ({}) },
    '@/store/modules/user': { useUserStoreWithOut: () => ({ hasPermission: () => false }) },
    '@/components/UserNameText/index.vue': {}, '@/components/UserPicker/index.vue': {}, '@/components/TicketAttachments.vue': {},
    './TransitionActionDialog.vue': {},
    '@/views/risk/items/RemediationDialog.vue': {},
    '@/views/risk/items/RemediationCommandDialog.vue': {},
    './transitionSubmission': { createTransitionSubmission },
    './useRenderedRichtext': { useRenderedRichtext },
    './relationSession': { createRelationSession: ({ active }: { active: () => boolean }) => {
      relationActive.mockImplementation(active)
      return { state: {}, reset: () => undefined }
    } },
    '@tanstack/vue-query': {
      useQuery: (options: { queryKey: MaybeRef<readonly unknown[]> }) => ({
        data: unref(options.queryKey)[1] === 'detail' ? detail : ref(),
        isError: ref(false),
        error: ref(null),
        isSuccess: ref(true),
        enabled: 'enabled' in options ? options.enabled : undefined,
      }),
      useQueryClient: () => ({ invalidateQueries: refresh }),
    },
  }, { ticketId: '42' })
  return { page, lifecycle, dictionaries, transition, writes, relationActive, refresh }
}

it('详情字典失败不缓存为空，重试保留含停用项回显语义', async () => {
  const { page, dictionaries } = setupDetail()
  const api = dictionaries
  api.getDictItemsByCodeApi.mockRejectedValueOnce(httpError(503, '字典回显故障'))
    .mockResolvedValueOnce([{ code: 'a', label: '历史选项', enabled: false }])
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

it('只读降级关闭字段和办理查询、附件写资格及其余修改入口', async () => {
  const { page, writes, transition, relationActive } = setupDetail({ definition_resolution: 'degraded' })
  expect(page.ticket.value?.id).toBe('42')
  expect(page.canWriteTicket.value).toBe(false)
  expect(page.canUseOtherWrites.value).toBe(false)
  expect(page.actionsQuery.enabled.value).toBe(false)
  expect(page.typeFieldsQuery.enabled.value).toBe(false)
  expect(relationActive()).toBe(false)
  await page.submitEdit()
  await page.submitAssign()
  await page.submitClose()
  await page.addTag()
  await page.doAddCC(['2'])
  page.openTransition({ id: 'submit', to: 'closed', fields: [] })
  expect(transition).not.toHaveBeenCalled()
  for (const write of Object.values(writes)) expect(write).not.toHaveBeenCalled()
})

it('按当前绑定动作提交一次证据，离开缓存页后仍能用原操作号重试', async () => {
  const { page, lifecycle, transition, writes } = setupDetail({
    definition_resolution: 'exact', revision: '12',
    definition_ref: { type_code: 'synthetic', definition_version: '7', definition_hash: 'hash' },
  })
  const proof = { field_key: 'proof', field_type: 'file', field_label: '凭证' }
  const action = {
    id: 'submit', to: 'pending_verify', title: '送复测', expectedRevision: '12', definitionVersion: '7',
    fields: [{ definition: proof, required: true }],
  }
  transition.mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce(undefined)
  page.actionsQuery.data.value = { actions: [action], fields: [proof] }
  page.openTransition(action)
  expect(transition).not.toHaveBeenCalled()
  await page.submitTransition({ custom_data_patch: { proof: ['file-key'] } })
  expect(page.transition.state.phase).toBe('unknown')
  lifecycle.deactivate()
  expect(page.canWriteTicket.value).toBe(false)
  lifecycle.activate()
  await page.submitTransition()
  expect(transition).toHaveBeenCalledTimes(2)
  expect(transition.mock.calls[1]).toEqual(transition.mock.calls[0])
  expect(transition.mock.calls[0][0]).toEqual({
    id: '42', to: 'pending_verify', expected_revision: '12', definition_version: '7',
    custom_data_patch: { proof: ['file-key'] },
  })
  expect(writes.updateTicketApi).not.toHaveBeenCalled()
})

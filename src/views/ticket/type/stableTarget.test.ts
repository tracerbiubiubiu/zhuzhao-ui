import { transformSync } from 'esbuild'
import * as vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as contract from '@/components/FlowGraphDesigner/contract'
import * as graphTypes from '@/components/FlowGraphDesigner/types'
import * as lint from '@/components/FlowGraphDesigner/lint'
import * as designer from '@/components/FormDesigner/useDesigner'
import * as schema from '@/components/FormDesigner/schemaAdapter'
import * as fieldTypes from '@/components/FormDesigner/types'
import * as meta from './transitionMeta'
import source from './index.vue?raw'

const script = compileScript(parse(source).descriptor, { id: 'stable-target', genDefaultAs: 'page' })
const { code } = transformSync(script.content, { loader: 'ts', format: 'cjs' })
const type = { id: '101', code: 'sample', name: '类型', description: '', is_active: true, version: 1, states: ['open', 'assigned', 'closed'], transitions: { open: ['assigned', 'closed'], assigned: ['closed'], closed: ['open'] }, transition_meta: {} }
const template = { id: '201', code: 'sample_template', name: '模板', type_code: 'sample', version: 1, org_id: '301', default_priority: 3, created_at: '' }
const scopes: vue.EffectScope[] = []
afterEach(() => scopes.splice(0).forEach(scope => scope.stop()))
function fixture() {
  const api = {
    listTicketTypesApi: vi.fn(async () => [type]), listTicketTemplatesApi: vi.fn(async () => [template]),
    getTicketTypeFieldsApi: vi.fn(async () => []), listTicketsApi: vi.fn(async () => ({ total: 0 })),
    createTicketTypeApi: vi.fn(), updateTicketTypeApi: vi.fn(), deleteTicketTypeApi: vi.fn(),
    replaceTicketTypeFieldsApi: vi.fn(), createTicketTemplateApi: vi.fn(), updateTicketTemplateApi: vi.fn(), deleteTicketTemplateApi: vi.fn(),
  }
  const confirm = vi.fn(async () => 'confirm')
  const message = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
  const invalidateQueries = vi.fn()
  const libs: Record<string, unknown> = {
    vue: { ...vue, onDeactivated: () => {}, onBeforeUnmount: () => {} }, '@vea/hooks': { useTableFit: () => {} },
    '@/utils/int64': { compareInt64Desc: () => 0 },
    'element-plus': { ElMessage: message, ElMessageBox: { confirm } },
    '@tanstack/vue-query': { useQueryClient: () => ({ invalidateQueries }), useQuery: () => ({ data: vue.ref([]) }) },
    '@/api/ticket': api, '@/api/system/org': { getOrgTreeApi: vi.fn(async () => []) },
    '@/components/FormDesigner/index.vue': {}, '@/components/FlowGraphDesigner/index.vue': {},
    '@/components/FormDesigner/useDesigner': designer, '@/components/FormDesigner/schemaAdapter': schema,
    '@/components/FormDesigner/types': fieldTypes, '@/components/FlowGraphDesigner/contract': contract,
    '@/components/FlowGraphDesigner/lint': lint, '@/components/FlowGraphDesigner/types': graphTypes, './transitionMeta': meta,
  }
  const scope = vue.effectScope(); scopes.push(scope)
  // Actual setup refs and handlers are returned by the SFC compiler.
  const page = scope.run(() => new Function('require', `${code}\nreturn page.setup({}, { expose() {} })`)((name: string) => libs[name]))
  page.typeFormRef.value = { validate: async () => true }
  page.tplFormRef.value = { validate: async () => true }
  return { page, api, confirm, message, invalidateQueries }
}
const conflict = { response: { status: 409, data: { code: 10006, message: '配置已变化' } } }
describe('配置稳定目标的产品请求路径', () => {
  it('状态图、字段和模板保存均携所读对象 ID', async () => {
    const { page, api } = fixture()
    page.openTypeEdit(type); page.graphMode.value = 'json'
    await page.submitType()
    expect(api.updateTicketTypeApi).toHaveBeenCalledWith(expect.objectContaining({ id: type.id, code: type.code, version: 1 }))
    await page.openFields(type); await page.saveFields()
    expect(api.replaceTicketTypeFieldsApi).toHaveBeenCalledWith(expect.objectContaining({ id: type.id, code: type.code, version: 1 }))
    page.openTplEdit(template); await page.submitTpl()
    expect(api.updateTicketTemplateApi).toHaveBeenCalledWith(expect.objectContaining({ id: template.id, code: template.code, version: 1 }))
  })
  it('删除在确认前捕获 ID 和版本，不从后来变化的行取目标', async () => {
    const { page, api, confirm } = fixture()
    let resolve!: (value: string) => void
    confirm.mockReturnValueOnce(new Promise<string>(done => { resolve = done }))
    const row = { ...type }; const deleting = page.onDeleteType(row)
    Object.assign(row, { id: '102', version: 2 }); resolve('confirm'); await deleting
    expect(api.deleteTicketTypeApi).toHaveBeenCalledWith({ id: type.id, code: type.code, version: 1 })
    await page.onDeleteTpl(template)
    expect(api.deleteTicketTemplateApi).toHaveBeenCalledWith({ id: template.id, code: template.code, version: 1 })
  })
  it('类型保存 409 保留草稿，指引先复制再关闭并重开编辑', async () => {
    const { page, api } = fixture()
    page.openTypeEdit(type); page.graphMode.value = 'json'; page.typeForm.name = '类型草稿'
    const draft = { ...page.typeForm }
    api.updateTicketTypeApi.mockRejectedValueOnce(conflict); await page.submitType()
    expect(page.typeDialog.visible).toBe(true)
    expect(page.typeForm).toEqual(draft)
    expect(page.typeDialog.error).toContain('草稿已保留')
    expect(page.typeDialog.error).toContain('先复制草稿')
    expect(page.typeDialog.error).toContain('关闭弹窗后从列表重新打开「编辑」')
    expect(api.updateTicketTypeApi).toHaveBeenCalledTimes(1)
  })
  it('字段保存 409 保留字段草稿，指引先复制再重开字段配置', async () => {
    const { page, api } = fixture()
    await page.openFields(type)
    page.fieldEditor.add('input')
    page.fieldEditor.update(0, { field_key: 'sample_field', field_label: '合成字段草稿' })
    const draft = page.fieldEditor.serialize()
    api.replaceTicketTypeFieldsApi.mockRejectedValueOnce(conflict); await page.saveFields()
    expect(page.fieldsDialog.visible).toBe(true)
    expect(page.fieldEditor.serialize()).toEqual(draft)
    expect(page.fieldsDialog.error).toContain('草稿已保留')
    expect(page.fieldsDialog.error).toContain('先复制草稿')
    expect(page.fieldsDialog.error).toContain('关闭弹窗后从列表重新打开「字段配置」')
    expect(api.replaceTicketTypeFieldsApi).toHaveBeenCalledTimes(1)
  })
  it('模板保存 409 保留完整草稿，指引先复制再重开编辑', async () => {
    const { page, api } = fixture()
    page.openTplEdit(template)
    page.tplForm.name = '模板草稿'
    page.tplForm.default_fields_text = '{"sample_field":"合成默认值"}'
    const draft = { ...page.tplForm }
    api.updateTicketTemplateApi.mockRejectedValueOnce(conflict); await page.submitTpl()
    expect(page.tplDialog.visible).toBe(true)
    expect(page.tplForm).toEqual(draft)
    expect(page.tplDialog.error).toContain('草稿已保留')
    expect(page.tplDialog.error).toContain('先复制草稿')
    expect(page.tplDialog.error).toContain('关闭弹窗后从列表重新打开「编辑」')
    expect(api.updateTicketTemplateApi).toHaveBeenCalledTimes(1)
  })
  it.each(['type', 'template'])('新建 %s 的 409 保留真实原因和草稿，不指向编辑入口', async (kind) => {
    const { page, api } = fixture()
    const isType = kind === 'type'
    if (isType) page.openTypeCreate()
    else page.openTplCreate()
    const form = isType ? page.typeForm : page.tplForm
    const dialog = isType ? page.typeDialog : page.tplDialog
    const create = isType ? api.createTicketTypeApi : api.createTicketTemplateApi
    Object.assign(form, { code: 'duplicate', name: '合成新建草稿' })
    const draft = { ...form }
    create.mockRejectedValueOnce({ response: { status: 409, data: { code: 10005, message: '编码已存在' } } })
    if (isType) await page.submitType()
    else await page.submitTpl()
    expect(dialog.visible).toBe(true)
    expect(form).toEqual(draft)
    expect(dialog.error).toContain('编码已存在')
    expect(dialog.error).toContain('草稿已保留')
    expect(dialog.error).toContain('核对后重试')
    expect(dialog.error).not.toContain('重新打开')
    expect(create).toHaveBeenCalledTimes(1)
  })
  it.each([
    { code: 10005, backend: '该类型已有工单，不能删除', expected: '该类型已有工单，不能删除' },
    { code: 10005, backend: undefined, expected: '该类型已被引用，不能删除' },
    { code: 10005, backend: '', expected: '该类型已被引用，不能删除' },
    { code: 10006, backend: '配置已变化', expected: '列表将自动刷新' },
    { code: 10999, backend: '合成冲突原因', expected: '合成冲突原因' },
  ])('类型删除区分 409 业务码 $code：$backend', async ({ code, backend, expected }) => {
    const { page, api, message, invalidateQueries } = fixture()
    api.deleteTicketTypeApi.mockRejectedValueOnce({ response: { status: 409, data: { code, message: backend } } })
    await page.onDeleteType(type)
    expect(message.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(expected))
    if (code !== 10006) expect(message.error.mock.calls[0][0]).not.toContain('配置已变化')
    expect(api.deleteTicketTypeApi).toHaveBeenCalledExactlyOnceWith({ id: type.id, code: type.code, version: 1 })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['ticket', 'types'] })
    expect(message.success).not.toHaveBeenCalled()
  })
  it('模板删除 409 告知列表自动刷新后重新核对', async () => {
    const { page, api, message, invalidateQueries } = fixture()
    api.deleteTicketTemplateApi.mockRejectedValueOnce(conflict)
    await page.onDeleteTpl(template)
    expect(message.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('列表将自动刷新'))
    expect(api.deleteTicketTemplateApi).toHaveBeenCalledTimes(1)
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['ticket', 'templates'] })
  })
})

 it('模板校验期间切换目标，旧保存不得提交另一对象', async () => {
  const { page, api } = fixture(); page.openTplEdit(template)
  let resolve!: (value: boolean) => void
  page.tplFormRef.value = { validate: () => new Promise<boolean>(done => { resolve = done }) }
  const saving = page.submitTpl(); page.openTplEdit({ ...template, id: '202', code: 'other' })
  resolve(true); await saving
  expect(api.updateTicketTemplateApi).not.toHaveBeenCalled()
  expect(page.tplDialog.visible).toBe(true); expect(page.tplForm.id).toBe('202')
 })

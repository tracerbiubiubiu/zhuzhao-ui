import { describe, expect, it, vi } from 'vitest'
import { createRenderer, h } from 'vue'
import { preparePage, setupPage, deferred, httpError, renderPage, findNode } from '@/test/sfcHarness'
import source from './index.vue?raw'

preparePage(source)
const editors = [
  { label: '模板', open: 'openTplEdit', create: 'openTplCreate', submit: 'submitTpl', dialog: 'tplDialog', form: 'tplForm', write: 'updateMessageTemplateApi',
    first: { id: '101', code: 'synthetic_a', name: '合成模板 A', channel: 'uip', biz_type: 'ticket', subject: '合成主题 A', body: '合成正文 A', enabled: true },
    second: { id: '102', code: 'synthetic_b', name: '合成模板 B', channel: 'uip', biz_type: 'ticket', subject: '合成主题 B', body: '合成正文 B', enabled: true } },
  { label: '规则', open: 'openRuleEdit', create: 'openRuleCreate', submit: 'submitRule', dialog: 'ruleDialog', form: 'ruleForm', write: 'upsertMessageRuleApi',
    first: { id: '201', biz_type: 'ticket', event_action: 'ticket.created', template_code: 'synthetic_a', recipient_type: 'creator', fixed_recipients: '', enabled: true },
    second: { id: '202', biz_type: 'ticket', event_action: 'ticket.assigned', template_code: 'synthetic_b', recipient_type: 'assignee', fixed_recipients: '', enabled: true } },
] as const

function setup() {
  const api = {
    listMessageTemplatesApi: vi.fn().mockResolvedValue({ list: [] }),
    listMessageRulesApi: vi.fn().mockResolvedValue([]), listMessageLogsApi: vi.fn(),
    createMessageTemplateApi: vi.fn(), updateMessageTemplateApi: vi.fn(), upsertMessageRuleApi: vi.fn(),
  }
  const message = { success: vi.fn(), error: vi.fn() }
  const components = Object.fromEntries(['ElAlert', 'ElButton', 'ElCard', 'ElDialog', 'ElForm', 'ElFormItem', 'ElInput', 'ElOption', 'ElPagination', 'ElSelect', 'ElSwitch', 'ElTabPane', 'ElTable', 'ElTableColumn', 'ElTabs', 'ElTag', 'ElEmpty'].map(name => [name, { name }]))
  const { page, lifecycle } = setupPage(source, { '@/api/message': api, 'element-plus': { ...components, ElMessage: message } })
  return { page, api, message, lifecycle }
}

// 在真实 Vue 渲染上下文执行模板，读取实际绑定的表单禁用状态；不挂载业务栈。
function inspectForm(page: any, label: string, inspect: (form: any) => unknown) {
  let result: unknown
  const renderer = createRenderer({
    createElement: () => ({}), insert() {}, remove() {}, patchProp() {},
    createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {},
    parentNode: () => null, nextSibling: () => null,
  })
  const app = renderer.createApp({ render() {
    const dialog = findNode(renderPage(source, page), node => node.type?.name === 'ElDialog' && node.props.title.includes(label))
    const form = findNode({ children: dialog.children.default() }, node => node.type?.name === 'ElForm')
    result = inspect(form)
    return h('div')
  } })
  app.directive('permission', {})
  app.directive('loading', {})
  app.mount({})
  app.unmount()
  return result
}

const formDisabled = (page: any, label: string) => inspectForm(page, label, form => form.props.disabled)
const controlDisabled = (page: any, label: string, field: string) => inspectForm(page, label, form => {
  const item = findNode({ children: form.children.default() }, node => node.type?.name === 'ElFormItem' && node.props.label === field)
  return item.children.default()[0].props.disabled
})

describe.each(editors)('$label 保存绑定编辑会话', editor => {
  it.each(editor.label === '模板' ? ['标识'] : ['业务域', '事件动作'])('新建的%s显式禁用跟随当前保存锁，旧 finally 不解锁', async field => {
    const { page, api } = setup()
    const old = deferred(), current = deferred()
    const write = editor.label === '模板' ? 'createMessageTemplateApi' : 'upsertMessageRuleApi'
    api[write].mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    page[editor.create]()
    Object.assign(page[editor.form], editor.first)
    expect(controlDisabled(page, editor.label, field)).toBe(false)
    const first = page[editor.submit]()
    expect(controlDisabled(page, editor.label, field)).toBe(true)
    page[editor.create]()
    Object.assign(page[editor.form], editor.second)
    expect(controlDisabled(page, editor.label, field)).toBe(false)
    const second = page[editor.submit]()
    old.reject(httpError(409, '合成旧保存故障'))
    await first
    expect(controlDisabled(page, editor.label, field)).toBe(true)
    current.reject(httpError(409, '合成当前保存故障'))
    await second
    expect(controlDisabled(page, editor.label, field)).toBe(false)
  })

  it.each(['success', 'failure'] as const)('A→B 后旧 %s 不关闭新弹窗、覆盖草稿或释放 B 保存锁', async outcome => {
    const { page, api, message } = setup()
    const old = deferred(), current = deferred()
    api[editor.write].mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    page[editor.open](editor.first)
    const first = page[editor.submit]()
    page[editor.open](editor.second)
    expect(page[editor.dialog].loading).toBe(false)
    expect(formDisabled(page, editor.label)).toBe(false)
    const second = page[editor.submit]()
    expect(formDisabled(page, editor.label)).toBe(true)
    if (outcome === 'success') old.resolve(undefined)
    else old.reject(httpError(409, '合成旧会话冲突'))
    await first
    expect(page[editor.dialog].visible).toBe(true)
    expect(page[editor.form]).toMatchObject(editor.second)
    expect(page[editor.dialog].error).toBe('')
    expect(page[editor.dialog].loading).toBe(true)
    expect(formDisabled(page, editor.label)).toBe(true)
    expect(message.success).not.toHaveBeenCalled()
    current.reject(httpError(409, '合成当前会话冲突'))
    await second
    expect(page[editor.dialog].visible).toBe(true)
    expect(page[editor.dialog].error).toBe('合成当前会话冲突')
    expect(page[editor.dialog].loading).toBe(false)
    expect(formDisabled(page, editor.label)).toBe(false)
  })

  it('同一保存请求锁定输入且只提交一次，当前成功后才关闭', async () => {
    const { page, api, message } = setup()
    const pending = deferred()
    api[editor.write].mockReturnValue(pending.promise)
    page[editor.open](editor.first)
    const first = page[editor.submit]()
    expect(formDisabled(page, editor.label)).toBe(true)
    await page[editor.submit]()
    expect(api[editor.write]).toHaveBeenCalledTimes(1)
    expect(api[editor.write].mock.calls[0][0]).not.toHaveProperty('id')
    expect(api[editor.write].mock.calls[0][0]).toMatchObject(editor.label === '模板'
      ? { code: 'synthetic_a', name: '合成模板 A', subject: '合成主题 A', body: '合成正文 A' }
      : { biz_type: 'ticket', event_action: 'ticket.created', template_code: 'synthetic_a', recipient_type: 'creator' })
    pending.resolve(undefined)
    await first
    expect(page[editor.dialog].visible).toBe(false)
    expect(page[editor.dialog].loading).toBe(false)
    expect(message.success).toHaveBeenCalledWith(`${editor.label}已保存`)
  })

  it.each(['success', 'failure'] as const)('关闭后重开同一对象仍隔离旧 %s', async outcome => {
    const { page, api, message } = setup()
    const pending = deferred()
    api[editor.write].mockReturnValue(pending.promise)
    page[editor.open](editor.first)
    const first = page[editor.submit]()
    page[editor.dialog].visible = false
    page[editor.open](editor.first)
    page[editor.dialog].error = '新草稿提示'
    if (outcome === 'success') pending.resolve(undefined)
    else pending.reject(httpError(409, '合成旧错误'))
    await first
    expect(page[editor.dialog].visible).toBe(true)
    expect(page[editor.dialog].loading).toBe(false)
    expect(page[editor.dialog].error).toBe('新草稿提示')
    expect(message.success).not.toHaveBeenCalled()
  })

  it('离开缓存页面即撤销保存回包对弹窗和提示的写入资格', async () => {
    const { page, api, message, lifecycle } = setup()
    const pending = deferred()
    api[editor.write].mockReturnValue(pending.promise)
    page[editor.open](editor.first)
    const first = page[editor.submit]()
    lifecycle.deactivate()
    pending.resolve(undefined)
    await first
    expect(page[editor.dialog].visible).toBe(false)
    expect(page[editor.dialog].loading).toBe(false)
    expect(message.success).not.toHaveBeenCalled()
  })
})

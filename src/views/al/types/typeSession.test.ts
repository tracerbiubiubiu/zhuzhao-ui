import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { preparePage, setupPage, renderPage, findNode, deferred, httpError, settle } from '@/test/sfcHarness'
import source from './index.vue?raw'
preparePage(source)

const row = (type_name: string) => ({ type_name, fields: [{ name: 'name', type: 'string' }], version: 1 })
function setup() {
  const api = { listAlTypesApi: vi.fn(), listAlTypeHistoryApi: vi.fn(), registerAlTypeApi: vi.fn(), evolveAlTypeApi: vi.fn() }
  const message = { success: vi.fn() }
  const typesQuery = { data: ref<any>({ list: [] }), error: ref<any>(null) }
  const { page, lifecycle } = setupPage(source, {
    '@/api/al': api,
    'element-plus': {
      ...Object.fromEntries(['ElAlert', 'ElCard', 'ElDrawer', 'ElFormItem', 'ElInput', 'ElEmpty', 'ElInputNumber', 'ElPagination', 'ElSwitch', 'ElTable', 'ElTableColumn', 'ElTag', 'ElSelect', 'ElOption'].map(name => [name, { name }])),
      ElMessage: message, ElDialog: { name: 'dialog' }, ElForm: { name: 'form' }, ElButton: { name: 'button' },
    },
    '@tanstack/vue-query': { useQuery: () => typesQuery, useQueryClient: () => ({ invalidateQueries: vi.fn() }) },
  })
  page.formRef.value = { validate: async () => true }
  return { page, api, message, lifecycle, typesQuery }
}

describe('活动类型目标及编辑会话', () => {
  it.each(['create', 'evolve'])('%s 校验及保存未结束时真实模板锁住表单、字段增删和关闭；新会话恢复输入', async mode => {
    const { page, api } = setup()
    const validation = deferred(), writing = deferred()
    if (mode === 'create') {
      api.registerAlTypeApi.mockReturnValueOnce(writing.promise)
      page.openCreate()
      page.editorForm.type_name = 'new_type'
      page.editorForm.fields[0].name = 'name'
    } else {
      api.evolveAlTypeApi.mockReturnValueOnce(writing.promise)
      page.openEvolve(row('a'))
    }
    page.editorForm.fields.push({ name: 'second', type: 'string', required: false })
    page.formRef.value.validate = () => validation.promise
    const save = page.submitEditor()
    const assertLocked = (locked: boolean) => {
      const dialog = findNode(renderPage(source, page), n => n.type?.name === 'dialog')
      const body = { children: dialog.children.default() }
      const form = findNode(body, n => n.type?.name === 'form')
      expect(form.props.disabled).toBe(locked)
      const typeName = findNode({ children: findNode({ children: form.children.default() }, n => n.type?.name === 'ElFormItem' && n.props?.label === '类型名').children.default() }, n => n.type?.name === 'ElInput')
      expect(typeName.props.disabled).toBe(locked || page.editorMode.value === 'evolve')
      expect(dialog.props['close-on-press-escape']).toBe(!locked)
      expect(dialog.props['show-close']).toBe(!locked)
      const fields = { children: findNode({ children: form.children.default() }, n => n.type?.name === 'ElFormItem' && n.props?.label === '字段定义').children.default() }
      const add = findNode(fields, n => n.type?.name === 'button' && n.children?.default?.()?.some((v: any) => v.children === '+ 添加字段'))
      expect(add.props.disabled).toBe(locked)
      const remove = findNode(fields, n => n.type?.name === 'button' && n.props?.class === 'ml-auto')
      expect(remove.props.disabled).toBe(locked || page.editorForm.fields.length <= 1)
      const cancel = dialog.children.footer()[0]
      expect(cancel.props.disabled).toBe(locked)
    }
    assertLocked(true)
    const before = page.editorForm.fields.map((field: any) => ({ ...field }))
    page.addFieldRow()
    page.removeFieldRow(0)
    expect(page.editorForm.fields).toEqual(before)
    page.closeEditor()
    expect(page.editorVisible.value).toBe(true)
    validation.resolve(true)
    await settle()
    assertLocked(true)
    writing.reject(httpError(503))
    await save
    assertLocked(false)
    page.openCreate()
    assertLocked(false)
  })

  it.each(['success', 'failure'])('旧保存 %s 不占用新会话保存锁，迟到回包也不释放新锁', async outcome => {
    const { page, api } = setup()
    const old = deferred(), next = deferred()
    api.evolveAlTypeApi.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    page.openEvolve(row('a'))
    const first = page.submitEditor()
    await settle()
    page.editorVisible.value = false
    page.openEvolve(row('b'))
    page.editorForm.fields[0].name = 'next_draft'
    const second = page.submitEditor()
    await settle()
    expect(api.evolveAlTypeApi).toHaveBeenCalledTimes(2)
    expect(page.editorSaving.value).toBe(true)
    if (outcome === 'success') old.resolve({})
    else old.reject(httpError(503))
    await first
    expect(page.editorVisible.value).toBe(true)
    expect(page.editorForm.fields[0].name).toBe('next_draft')
    expect(page.editorSaving.value).toBe(true)
    await page.submitEditor()
    expect(api.evolveAlTypeApi).toHaveBeenCalledTimes(2)
    page.closeEditor()
    expect(page.editorVisible.value).toBe(true)
    next.resolve({})
    await second
    expect(page.editorVisible.value).toBe(false)
  })

  it('切类型后历史迟到不覆盖当前内容或 loading', async () => {
    const { page, api } = setup()
    const old = deferred(), next = deferred()
    api.listAlTypeHistoryApi.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    const first = page.openHistory(row('a'))
    const second = page.openHistory(row('b'))
    old.resolve({ list: [{ version: 1 }] })
    await first
    expect(page.historyRows.value).toEqual([])
    expect(page.historyLoading.value).toBe(true)
    next.resolve({ list: [{ version: 2 }] })
    await second
    expect(page.historyRows.value).toEqual([{ version: 2 }])
  })
  it('历史失败持续显示，成功空结果清除错误', async () => {
    const { page, api } = setup()
    api.listAlTypeHistoryApi.mockRejectedValueOnce(httpError(503, '历史暂不可用')).mockResolvedValueOnce({ list: [] })
    await page.openHistory(row('a'))
    expect((page.historyError?.value ?? '')).toContain('历史暂不可用')
    await page.openHistory(row('a'))
    expect((page.historyError?.value ?? '')).toBe('')
  })
  it.each(['success', 'failure'])('旧保存%s不关闭或污染重开的草稿', async outcome => {
    const { page, api, message } = setup()
    const old = deferred()
    api.evolveAlTypeApi.mockReturnValueOnce(old.promise)
    page.openEvolve(row('a'))
    const save = page.submitEditor()
    await settle()
    page.editorVisible.value = false
    page.openEvolve(row('b'))
    page.editorForm.fields[0].name = 'new_draft'
    if (outcome === 'success') old.resolve({})
    else old.reject(httpError(409, '旧版本冲突'))
    await save
    expect(page.editorVisible.value).toBe(true)
    expect(page.editorForm.fields[0].name).toBe('new_draft')
    expect(page.editorError.value).toBe('')
    expect(message.success).not.toHaveBeenCalled()
  })
  it('等待校验时重开不向新目标写入，重复点击只发一次', async () => {
    const { page, api } = setup()
    const validation = deferred()
    page.openEvolve(row('a'))
    page.formRef.value.validate = () => validation.promise
    const save = page.submitEditor()
    page.openEvolve(row('b'))
    validation.resolve(true)
    await save
    expect(api.evolveAlTypeApi).not.toHaveBeenCalled()
    page.formRef.value.validate = async () => true
    api.evolveAlTypeApi.mockReturnValue(deferred().promise)
    await Promise.all([page.submitEditor(), page.submitEditor()].map(p => Promise.race([p, settle()])))
    expect(api.evolveAlTypeApi).toHaveBeenCalledTimes(1)
  })
})

it('历史 A→B→A 最新响应先结束，旧成功和错误均不能覆盖', async () => {
  const { page, api } = setup()
  const a = deferred(), b = deferred(), current = deferred()
  api.listAlTypeHistoryApi.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise).mockReturnValueOnce(current.promise)
  const p = page.openHistory(row('a')), q = page.openHistory(row('b')), r = page.openHistory(row('a'))
  current.resolve({ list: [{ version: 3 }] })
  await r
  b.reject(httpError(403))
  a.resolve({ list: [{ version: 1 }] })
  await Promise.all([p, q])
  expect(page.historyRows.value).toEqual([{ version: 3 }])
  expect(page.historyError.value).toBe('')
})
it('关闭历史后旧错误不污染同目标重开，关闭编辑后旧成功不弹提示', async () => {
  const { page, api, message } = setup()
  const old = deferred()
  api.listAlTypeHistoryApi.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ list: [] })
  const p = page.openHistory(row('a'))
  page.historyVisible.value = false
  await page.openHistory(row('a'))
  old.reject(httpError(503))
  await p
  expect(page.historyError.value).toBe('')
  const writing = deferred()
  api.evolveAlTypeApi.mockReturnValueOnce(writing.promise)
  page.openEvolve(row('a'))
  const save = page.submitEditor()
  await settle()
  page.editorVisible.value = false
  writing.resolve({})
  await save
  expect(message.success).not.toHaveBeenCalled()
})

it('类型清单失败不冒充无类型，成功空集清错误', () => {
  const { page, typesQuery } = setup()
  typesQuery.data.value = { list: [row('old')] }
  typesQuery.error.value = httpError(403)
  expect(page.rows.value).toEqual([])
  expect(page.typesError?.value ?? '').toContain('无权')
  typesQuery.error.value = null
  typesQuery.data.value = { list: [] }
  expect(page.typesError.value).toBe('')
})

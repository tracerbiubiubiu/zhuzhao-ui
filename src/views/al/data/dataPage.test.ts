import * as vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { AlDataDoc, AlFieldDef, AlTypeDef } from '@/api/al'
import { preparePage, setupPage, httpError } from '@/test/sfcHarness'
import * as cursorPager from './cursorPager'
import source from './index.vue?raw'

preparePage(source)
type Page = {
  detailVisible: vue.Ref<boolean>
  detailRow: vue.Ref<AlDataDoc | null>
  openDetail(row: AlDataDoc): void
  list: vue.Ref<AlDataDoc[]>
  editing: { id: string; version: number }
  selectedType: vue.Ref<string>
  formData: vue.Ref<Record<string, unknown>>
  listText: vue.Ref<Record<string, string>>
  formVisible: vue.Ref<boolean>
  formSaving: vue.Ref<boolean>
  formError: vue.Ref<string>
  schema: vue.Ref<AlFieldDef[]>
  typesError: vue.Ref<string>
  importReady: vue.Ref<boolean>
  importText: vue.Ref<string>
  importVisible: vue.Ref<boolean>
  replaceConfirmed: vue.Ref<boolean>
  openImport(): void
  submitImport(): Promise<void>
  openEdit(row: AlDataDoc): void
  openCreate(): void
  dedupList(name: string): void
  submitForm(): Promise<void>
  onDelete(row: AlDataDoc): Promise<void>
  onRestore(row: AlDataDoc): Promise<void>
}
const fields: AlFieldDef[] = [
  { name: 'name', type: 'string', required: true },
  { name: 'note', type: 'string', required: false },
  { name: 'score', type: 'int', required: false },
  { name: 'labels', type: 'string_list', required: false },
  { name: 'numbers', type: 'int_list', required: false },
  { name: 'missing_text', type: 'string', required: false },
  { name: 'missing_list', type: 'string_list', required: false },
  { name: 'missing_numbers', type: 'int_list', required: false },
  { name: 'null_text', type: 'string', required: false },
  { name: 'empty_text', type: 'string', required: false },
]
function row(data: Record<string, unknown> = {}): AlDataDoc {
  return {
    id: '9007199254740993', version: 7, status: 'active',
    data: {
      name: '合成原值', note: '可选说明', score: 1,
      labels: ['a,b', 'c；d', 'line1\nline2', '  首尾  ', '', '重复', '重复'],
      numbers: [3, 1, 3, 0, -2], null_text: null, empty_text: '', ...data,
    },
    created_by: 'synthetic', updated_by: 'synthetic', created_at: '', updated_at: '',
  }
}
// 编译并执行真实页面 setup；仅替换网络、路由和渲染依赖，保留 Vue 状态与页面提交逻辑。
async function setup(schema = fields) {
  const api = {
    deleteAlDataApi: vi.fn().mockResolvedValue(row()),
    restoreAlDataApi: vi.fn().mockResolvedValue(row()),
    listAlTypesApi: vi.fn(),
    listAlDataApi: vi.fn().mockResolvedValue({ list: [], page_size: 20, next_cursor: null }),
    createAlDataApi: vi.fn().mockResolvedValue(row()),
    updateAlDataApi: vi.fn().mockResolvedValue(row()),
    importAlDataApi: vi.fn().mockResolvedValue({ rows: 1, deleted: 1, max_id: '1' }),
  }
  const definition: AlTypeDef = { type_name: 'synthetic_edit', fields: schema, status: 'active', version: 1, created_at: '', updated_at: '' }
  const messages = { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() }
  const confirm = vi.fn().mockResolvedValue(undefined)
  const typesQuery = { data: vue.ref<{ list: AlTypeDef[]; total: number } | undefined>({ list: [definition], total: 1 }), error: vue.ref<unknown>(null), isLoading: vue.ref(false) }
  const libs: Record<string, unknown> = {
    'element-plus': { ElMessage: messages, ElMessageBox: { confirm } },
    'vue-router': { useRouter: () => ({}) },
    '@tanstack/vue-query': { useQuery: () => typesQuery },
    '@vea/hooks': { useTableFit() {} },
    '@/api/al': api,
    '@/utils/datetime': {},
    './cursorPager': cursorPager,
  }
  const { page, lifecycle } = setupPage<Page>(source, libs)
  page.selectedType.value = 'synthetic_edit'
  await vue.nextTick()
  return { page, api, messages, confirm, typesQuery, definition, deactivate: () => lifecycle.deactivate(), activate: () => lifecycle.activate() }
}

describe('AL 类型读取故障阻写并保留草稿', () => {
  it.each([403, 503])('后台 %s 保留选择、schema 和编辑草稿；恢复以实际定义验证后再写入', async status => {
    const { page, api, typesQuery, definition } = await setup()
    page.openCreate()
    page.formData.value.name = '创建中的草稿'
    page.formData.value.note = '保留中的草稿'
    typesQuery.error.value = httpError(status, '合成类型读取故障')
    typesQuery.data.value = undefined
    await vue.nextTick()
    expect(page.selectedType.value).toBe('synthetic_edit')
    expect(page.schema.value).toEqual(fields)
    expect(page.formVisible.value).toBe(true)
    expect(page.formData.value.note).toBe('保留中的草稿')
    await page.submitForm()
    expect(api.createAlDataApi).not.toHaveBeenCalled()

    typesQuery.data.value = { list: [{ ...definition, version: 2, fields: [{ name: 'note', type: 'string', required: true }, { name: 'required_new', type: 'string', required: true }] }], total: 1 }
    typesQuery.error.value = null
    await vue.nextTick()
    page.formData.value.required_new = ''
    await page.submitForm()
    expect(api.createAlDataApi).not.toHaveBeenCalled()
    expect(page.formError.value).toContain('required_new')
    page.formData.value.required_new = '恢复后的实际字段'
    await page.submitForm()
    expect(api.createAlDataApi).toHaveBeenCalledExactlyOnceWith('synthetic_edit', { note: '保留中的草稿', required_new: '恢复后的实际字段' })
  })

  it('编辑已打开时读取失败不发送空 patch，恢复后仅提交原草稿变化', async () => {
    const { page, api, typesQuery } = await setup()
    page.openEdit(row())
    page.formData.value.note = '编辑中的草稿'
    typesQuery.error.value = httpError(403)
    await page.submitForm()
    expect(api.updateAlDataApi).not.toHaveBeenCalled()
    expect(page.formData.value.note).toBe('编辑中的草稿')
    typesQuery.error.value = null
    await page.submitForm()
    expect(api.updateAlDataApi).toHaveBeenCalledExactlyOnceWith('synthetic_edit', '9007199254740993', { data: { note: '编辑中的草稿' }, version: 7 })
  })

  it('读取失败同时阻止创建和导入；恢复不清导入草稿', async () => {
    const { page, api, typesQuery } = await setup()
    page.openCreate()
    page.formData.value.name = '创建草稿'
    page.openImport()
    page.importText.value = '[{"id":"1","data":{"name":"导入草稿"}}]'
    page.replaceConfirmed.value = true
    typesQuery.error.value = httpError(503)
    await page.submitForm()
    await page.submitImport()
    expect(api.createAlDataApi).not.toHaveBeenCalled()
    expect(api.importAlDataApi).not.toHaveBeenCalled()
    expect(page.importReady.value).toBe(false)
    expect(page.formData.value.name).toBe('创建草稿')
    expect(page.importText.value).toContain('导入草稿')
    typesQuery.error.value = null
    await vue.nextTick()
    expect(page.importReady.value).toBe(true)
    await page.submitImport()
    expect(api.importAlDataApi).toHaveBeenCalledExactlyOnceWith('synthetic_edit', '[{"id":"1","data":{"name":"导入草稿"}}]')
  })
})

describe('AL 普通编辑保真（真实页面 setup）', () => {
  it('只改标量时只发该字段和原版本，特殊文本/整数数组及缺省值不进入 patch', async () => {
    const { page, api } = await setup()
    page.openEdit(row())
    page.formData.value.score = 2
    await page.submitForm()
    expect(api.updateAlDataApi).toHaveBeenCalledExactlyOnceWith('synthetic_edit', '9007199254740993', { data: { score: 2 }, version: 7 })
  })

  it('未修改原样保存发送空 patch，仍携带 revision CAS', async () => {
    const { page, api } = await setup()
    page.openEdit(row())
    await page.submitForm()
    expect(api.updateAlDataApi).toHaveBeenCalledExactlyOnceWith('synthetic_edit', '9007199254740993', { data: {}, version: 7 })
  })

  it('逐项修改文本保留标点/换行/空白/空项/重复，且不修改列表原始行', async () => {
    const { page, api } = await setup()
    const original = row()
    const before = structuredClone(original)
    page.openEdit(original)
    const labels = page.formData.value.labels as string[]
    expect(labels).not.toBe(original.data.labels)
    labels[1] = '  新,项；\n保留  '
    expect(original).toEqual(before)
    await page.submitForm()
    expect(api.updateAlDataApi).toHaveBeenCalledExactlyOnceWith('synthetic_edit', original.id, {
      data: { labels: ['a,b', '  新,项；\n保留  ', 'line1\nline2', '  首尾  ', '', '重复', '重复'] }, version: 7,
    })
  })

  it('编辑整数数组也与原行隔离', async () => {
    const { page } = await setup()
    const original = row()
    page.openEdit(original)
    ;(page.formData.value.numbers as number[])[0] = 99
    expect(original.data.numbers).toEqual([3, 1, 3, 0, -2])
  })

  it('可选文本从非空明确清空发 null，未修改的 null/空串/缺省不发', async () => {
    const { page, api } = await setup()
    page.openEdit(row())
    page.formData.value.note = ''
    await page.submitForm()
    expect(api.updateAlDataApi).toHaveBeenCalledExactlyOnceWith('synthetic_edit', '9007199254740993', { data: { note: null }, version: 7 })
  })

  it('编辑后改回原值不再属于 patch；整数列表的等值输入不重发', async () => {
    const { page, api } = await setup()
    page.openEdit(row())
    page.formData.value.note = '修改中'
    page.formData.value.note = '可选说明'
    page.listText.value.numbers = '3, 1, 3, 0, -2'
    await page.submitForm()
    expect(api.updateAlDataApi.mock.lastCall?.[2]).toEqual({ data: {}, version: 7 })
  })

  it('显式修改整数列表保留原快捷解析能力，只提交该字段', async () => {
    const { page, api } = await setup()
    page.openEdit(row())
    page.listText.value.numbers = '4, 2\n4'
    await page.submitForm()
    expect(api.updateAlDataApi.mock.lastCall?.[2]).toEqual({ data: { numbers: [4, 2, 4] }, version: 7 })
  })

  it.each([null, undefined])('缺省或 null 文本列表不变成空数组：%s', async (labels) => {
    const { page, api } = await setup()
    page.openEdit(row({ labels, numbers: labels }))
    page.formData.value.score = 2
    await page.submitForm()
    expect(api.updateAlDataApi.mock.lastCall?.[2]).toEqual({ data: { score: 2 }, version: 7 })
  })

  it('显式删除全部文本项提交空数组；空字符串本身仍是一项', async () => {
    const { page, api } = await setup()
    page.openEdit(row())
    page.formData.value.labels = ['']
    await page.submitForm()
    expect(api.updateAlDataApi.mock.lastCall?.[2]).toEqual({ data: { labels: [''] }, version: 7 })
    page.openEdit(row())
    page.formData.value.labels = []
    await page.submitForm()
    expect(api.updateAlDataApi.mock.lastCall?.[2]).toEqual({ data: { labels: [] }, version: 7 })
  })

  it('逐项长度按字符计（含空白和换行），超长拒绝且保留草稿', async () => {
    const { page, api } = await setup([{ name: 'labels', type: 'string_list', required: false, max_chars: 3 }])
    page.openEdit(row({ labels: ['甲'] }))
    page.formData.value.labels = [' 甲\n乙']
    await page.submitForm()
    expect(api.updateAlDataApi).not.toHaveBeenCalled()
    expect(page.formError.value).toContain('第 1 项超长')
    expect(page.formVisible.value).toBe(true)
    page.formData.value.labels = ['😀\n甲']
    await page.submitForm()
    expect(api.updateAlDataApi.mock.lastCall?.[2]).toEqual({ data: { labels: ['😀\n甲'] }, version: 7 })
  })

  it('空项占用项数限额；必填列表零项仍拒绝', async () => {
    const { page, api } = await setup([{ name: 'labels', type: 'string_list', required: true, max_list_items: 2 }])
    page.openEdit(row({ labels: ['甲'] }))
    page.formData.value.labels = ['', '', '']
    await page.submitForm()
    expect(api.updateAlDataApi).not.toHaveBeenCalled()
    expect(page.formError.value).toContain('共 3 项，超上限 2')
    page.formData.value.labels = []
    await page.submitForm()
    expect(api.updateAlDataApi).not.toHaveBeenCalled()
    expect(page.formError.value).toContain('必填')
  })

  it('版本冲突和服务端失败保留草稿并反馈，不将失败显示为成功', async () => {
    const { page, api } = await setup()
    page.openEdit(row())
    page.formData.value.score = 2
    api.updateAlDataApi.mockRejectedValueOnce({ response: { data: { code: 100008, message: '版本不匹配（current_version=8；expected_version=7）' } } })
    await page.submitForm()
    expect(page.formError.value).toContain('版本冲突')
    expect(page.formVisible.value).toBe(true)
    expect(page.formData.value.score).toBe(2)
    expect(page.formSaving.value).toBe(false)
    page.formVisible.value = false
    page.openEdit(row())
    page.formData.value.score = 2
    api.updateAlDataApi.mockRejectedValueOnce({ response: { data: { code: 100001, message: '合成失败' } } })
    await page.submitForm()
    expect(page.formError.value).toBe('合成失败')
    expect(api.updateAlDataApi.mock.lastCall?.[2]).toEqual({ data: { score: 2 }, version: 7 })
  })

  it('创建仍支持 Excel/中英文分隔符粘贴、去重，空标量省略', async () => {
    const { page, api } = await setup()
    page.openEdit(row())
    page.openCreate()
    page.formData.value.name = '合成新增'
    page.listText.value.labels = ' 甲,乙；甲\n丙，丁;乙\n'
    page.dedupList('labels')
    page.listText.value.numbers = '1, 2\n1;3'
    await page.submitForm()
    expect(api.createAlDataApi).toHaveBeenCalledExactlyOnceWith('synthetic_edit', {
      name: '合成新增', labels: ['甲', '乙', '丙', '丁'], numbers: [1, 2, 1, 3], missing_list: [], missing_numbers: [],
    })
    expect(api.updateAlDataApi).not.toHaveBeenCalled()
  })
})


function deferred<T = AlDataDoc>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const conflict = { response: { status: 409, data: { code: 100008, message: '版本不匹配（数据已被并发修改）（current_version=8；expected_version=7）' } } }

describe('AL 编辑会话与冲突读回（真实页面 setup）', () => {
  it.each(['success', 'error'] as const)('保存中重开另一行，旧 %s 不关闭/污染新弹窗，也不释放新保存锁', async (result) => {
    const { page, api, messages } = await setup()
    const old = deferred()
    const current = deferred()
    api.updateAlDataApi.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    page.openEdit(row())
    page.formData.value.score = 2
    const first = page.submitForm()
    page.formVisible.value = false
    const next = { ...row({ name: '另一行' }), id: '9007199254740995', version: 11 }
    page.openEdit(next)
    expect(page.formSaving.value).toBe(false)
    page.formData.value.score = 3
    const second = page.submitForm()
    if (result === 'success') old.resolve(row())
    else old.reject(conflict)
    await first
    expect(page.formVisible.value).toBe(true)
    expect(page.formError.value).toBe('')
    expect(page.formSaving.value).toBe(true)
    expect(page.formData.value.score).toBe(3)
    expect(messages.success).not.toHaveBeenCalled()
    current.resolve(next)
    await second
    expect(page.formVisible.value).toBe(false)
    expect(api.updateAlDataApi.mock.lastCall).toEqual(['synthetic_edit', next.id, { data: { score: 3 }, version: 11 }])
  })

  it('关闭后重开同一行/创建也属于新会话；重复点击仅发送一次', async () => {
    const { page, api } = await setup()
    const old = deferred()
    api.updateAlDataApi.mockReturnValueOnce(old.promise)
    page.openEdit(row())
    const saving = page.submitForm()
    await page.submitForm()
    expect(api.updateAlDataApi).toHaveBeenCalledTimes(1)
    page.formVisible.value = false
    page.openEdit(row())
    page.openCreate()
    page.formData.value.name = '新建草稿'
    old.reject(conflict)
    await saving
    expect(page.formError.value).toBe('')
    expect(page.formVisible.value).toBe(true)
    expect(page.formData.value.name).toBe('新建草稿')
  })

  it.each(['type', 'deactivate'] as const)('%s 撤销旧保存回包资格并关闭旧编辑', async (change) => {
    const { page, api, messages, deactivate } = await setup()
    const pending = deferred()
    api.updateAlDataApi.mockReturnValueOnce(pending.promise)
    page.openEdit(row())
    const saving = page.submitForm()
    if (change === 'type') page.selectedType.value = 'synthetic_other'
    else deactivate()
    await vue.nextTick()
    expect(page.formVisible.value).toBe(false)
    api.listAlDataApi.mockClear()
    pending.resolve(row())
    await saving
    expect(messages.success).not.toHaveBeenCalled()
    expect(api.listAlDataApi).not.toHaveBeenCalled()
  })

  it('离开时撤销在途读，回到相同类型后重新读取版本', async () => {
    const { page, api, deactivate, activate } = await setup()
    const oldRead = deferred<{ list: AlDataDoc[]; page_size: number; next_cursor: null }>()
    api.listAlDataApi.mockReturnValueOnce(oldRead.promise)
    page.selectedType.value = 'synthetic_other'
    await vue.nextTick()
    deactivate()
    oldRead.resolve({ list: [row()], page_size: 20, next_cursor: null })
    await vue.nextTick()
    expect(page.list.value).toEqual([])
    const current = { ...row({ score: 8 }), version: 8 }
    api.listAlDataApi.mockClear().mockResolvedValue({ list: [current], page_size: 20, next_cursor: null })
    activate()
    await vue.nextTick()
    expect(api.listAlDataApi).toHaveBeenCalledTimes(1)
    expect(page.list.value).toEqual([current])
  })

  it('409 保留原草稿/版本但刷新列表，禁止直接重发；重开使用读回的新版本', async () => {
    const { page, api } = await setup()
    const latest = { ...row({ score: 8 }), version: 8 }
    api.listAlDataApi.mockClear().mockResolvedValue({ list: [latest], page_size: 20, next_cursor: null })
    page.openEdit(row())
    page.formData.value.score = 9
    api.updateAlDataApi.mockRejectedValueOnce(conflict)
    await page.submitForm()
    expect(page.formData.value.score).toBe(9)
    expect(page.editing.version).toBe(7)
    expect(page.formError.value).toContain('版本冲突')
    expect(api.listAlDataApi).toHaveBeenCalledTimes(1)
    await page.submitForm()
    expect(api.updateAlDataApi).toHaveBeenCalledTimes(1)
    page.formVisible.value = false
    page.openEdit(page.list.value[0])
    expect(page.editing.version).toBe(8)
    expect(page.formData.value.score).toBe(8)
    page.formData.value.score = 10
    await page.submitForm()
    expect(api.updateAlDataApi.mock.lastCall?.[2]).toEqual({ data: { score: 10 }, version: 8 })
  })

  it('唯一键冲突时可在原草稿修正并按原版本提交', async () => {
    const { page, api } = await setup()
    api.listAlDataApi.mockClear()
    const message = '唯一键重复（existing_id=2；unique_fields=[name]）'
    api.updateAlDataApi.mockRejectedValueOnce({ response: { status: 409, data: { code: 100008, message } } })
    page.openEdit(row())
    page.formData.value.name = '重复名'
    await page.submitForm()
    expect(page.formError.value).toBe(message)
    expect(page.formData.value.name).toBe('重复名')
    expect(api.listAlDataApi).not.toHaveBeenCalled()

    page.formData.value.name = '可用名'
    await page.submitForm()
    expect(api.updateAlDataApi).toHaveBeenCalledTimes(2)
    expect(api.updateAlDataApi.mock.lastCall?.[2]).toEqual({ data: { name: '可用名' }, version: 7 })
  })

  it('冲突刷新未完成时不允许重开旧行，失败回读也不能复用旧版本', async () => {
    const { page, api } = await setup()
    const read = deferred<{ list: AlDataDoc[]; page_size: number; next_cursor: null }>()
    api.listAlDataApi.mockReturnValueOnce(read.promise)
    page.openEdit(row())
    api.updateAlDataApi.mockRejectedValueOnce(conflict)
    const saving = page.submitForm()
    await vue.nextTick()
    page.formVisible.value = false
    page.openEdit(row())
    expect(page.formVisible.value).toBe(false)
    read.reject(new Error('synthetic read failure'))
    await saving
    expect(page.list.value).toEqual([])
  })
})

describe('AL 删除/恢复目标快照（真实页面 setup）', () => {
  it.each(['onDelete', 'onRestore'] as const)('%s 确认具名类型/ID/版本；确认等待期间改行对象不改请求快照', async (action) => {
    const { page, api, confirm } = await setup()
    const confirmation = deferred<void>()
    confirm.mockReturnValueOnce(confirmation.promise)
    const original = row()
    const work = page[action](original)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.lastCall?.[0]).toContain('synthetic_edit')
    expect(confirm.mock.lastCall?.[0]).toContain(original.id)
    expect(confirm.mock.lastCall?.[0]).toContain('v7')
    original.id = '999'
    original.version = 99
    confirmation.resolve()
    await work
    const endpoint = action === 'onDelete' ? api.deleteAlDataApi : api.restoreAlDataApi
    expect(endpoint).toHaveBeenCalledExactlyOnceWith('synthetic_edit', '9007199254740993', 7)
  })

  it.each(['onDelete', 'onRestore'] as const)('%s 取消或切类型后确认，不发送写入', async (action) => {
    const { page, api, confirm } = await setup()
    confirm.mockRejectedValueOnce('cancel')
    await page[action](row())
    const confirmation = deferred<void>()
    confirm.mockReturnValueOnce(confirmation.promise)
    const work = page[action](row())
    page.selectedType.value = 'synthetic_other'
    await vue.nextTick()
    confirmation.resolve()
    await work
    expect(api.deleteAlDataApi).not.toHaveBeenCalled()
    expect(api.restoreAlDataApi).not.toHaveBeenCalled()
  })

  it.each(['onDelete', 'onRestore'] as const)('%s 冲突读回新版本，等待确认/请求时防双击且不自动重试', async (action) => {
    const { page, api, messages } = await setup()
    const endpoint = action === 'onDelete' ? api.deleteAlDataApi : api.restoreAlDataApi
    const pending = deferred()
    endpoint.mockReturnValueOnce(pending.promise)
    const before = row()
    const work = page[action](before)
    await vue.nextTick()
    await page[action](before)
    expect(endpoint).toHaveBeenCalledTimes(1)
    api.listAlDataApi.mockClear().mockResolvedValue({ list: [{ ...before, version: 8 }], page_size: 20, next_cursor: null })
    pending.reject(conflict)
    await work
    expect(messages.error.mock.lastCall?.[0]).toContain('冲突')
    expect(api.listAlDataApi).toHaveBeenCalledTimes(1)
    expect(endpoint).toHaveBeenCalledTimes(1)
    await page[action](page.list.value[0])
    expect(endpoint.mock.lastCall).toEqual(['synthetic_edit', before.id, 8])
  })

  it.each(['onDelete', 'onRestore'] as const)('%s 迟到错误/成功不提示也不刷新新类型', async (action) => {
    const { page, api, messages } = await setup()
    const endpoint = action === 'onDelete' ? api.deleteAlDataApi : api.restoreAlDataApi
    const pending = deferred()
    endpoint.mockReturnValueOnce(pending.promise)
    const work = page[action](row())
    await vue.nextTick()
    page.selectedType.value = 'synthetic_other'
    await vue.nextTick()
    api.listAlDataApi.mockClear()
    if (action === 'onDelete') pending.reject(conflict)
    else pending.resolve(row())
    await work
    expect(messages.success).not.toHaveBeenCalled()
    expect(messages.error).not.toHaveBeenCalled()
    expect(api.listAlDataApi).not.toHaveBeenCalled()
  })
})


describe('AL 写入刷新与新详情会话隔离', () => {
  it.each(['onDelete', 'onRestore'] as const)('%s 迟到结果不关闭后来打开的详情（同一行重开也隔离）', async (action) => {
    const { page, api } = await setup()
    const pending = deferred()
    const endpoint = action === 'onDelete' ? api.deleteAlDataApi : api.restoreAlDataApi
    endpoint.mockReturnValueOnce(pending.promise)
    const original = row()
    page.openDetail(original)
    const work = page[action](original)
    await vue.nextTick()
    page.detailVisible.value = false
    page.openDetail(original)
    if (action === 'onDelete') pending.resolve(row())
    else pending.reject(conflict)
    await work
    expect(page.detailVisible.value).toBe(true)
    expect(page.detailRow.value?.id).toBe(original.id)
  })
})


describe('AL 类型定义失败阻止行状态写入', () => {
  it.each(['onDelete', 'onRestore'] as const)('%s 类型读取已失败时不发起确认或写入', async action => {
    const { page, api, typesQuery, confirm } = await setup()
    typesQuery.error.value = httpError(503)
    await page[action](row())
    expect(confirm).not.toHaveBeenCalled()
    expect(api.deleteAlDataApi).not.toHaveBeenCalled()
    expect(api.restoreAlDataApi).not.toHaveBeenCalled()
  })

  it.each(['onDelete', 'onRestore'] as const)('%s 等待确认期间类型读取失败也阻止发送', async action => {
    const { page, api, typesQuery, confirm } = await setup()
    const confirmation = deferred<void>()
    confirm.mockReturnValueOnce(confirmation.promise)
    const pending = page[action](row())
    typesQuery.error.value = httpError(403)
    confirmation.resolve()
    await pending
    expect(api.deleteAlDataApi).not.toHaveBeenCalled()
    expect(api.restoreAlDataApi).not.toHaveBeenCalled()
  })
})

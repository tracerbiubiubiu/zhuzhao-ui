import { transformSync } from 'esbuild'
import * as vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DictItemRow, DictTypeRow } from '@/api/system/dict'
import source from './index.vue?raw'

const descriptor = parse(source).descriptor
const setupScript = compileScript(descriptor, { id: 'dict-test', genDefaultAs: 'dictionaryPage' })
const { code } = transformSync(setupScript.content, { loader: 'ts', format: 'cjs' })

type Page = {
  keyword: vue.Ref<string>
  types: vue.Ref<DictTypeRow[]>
  typesLoading: vue.Ref<boolean>
  typesReadError: vue.Ref<string>
  selectedType: vue.Ref<DictTypeRow | null>
  items: vue.Ref<DictItemRow[]>
  itemsLoading: vue.Ref<boolean>
  itemsReadError: vue.Ref<string>
  itemVisible: vue.Ref<boolean>
  itemError: vue.Ref<string>
  typeVisible: vue.Ref<boolean>
  typeError: vue.Ref<string>
  typeForm: { code: string; name: string }
  openTypeCreate(): void
  submitType(): Promise<void>
  onToggleType(row: DictTypeRow, enabled: boolean): Promise<void>
  itemForm: { code: string; label: string }
  fetchTypes(preferredId?: string): Promise<void>
  fetchItems(): Promise<void>
  onKeywordInput(): void
  selectType(row: DictTypeRow): void
  openItemCreate(): void
  submitItem(): Promise<void>
  onToggleItem(row: DictItemRow, enabled: boolean): Promise<void>
  onDeleteItem(row: DictItemRow): Promise<void>
  onDeleteType(row: DictTypeRow): Promise<void>
}

// Execute the actual SFC setup with real Vue refs and controlled request timing.
// Stub the component imports because these tests exercise state and request targets.
function setup(initialTypes?: Promise<List<DictTypeRow>>) {
  const api = {
    listDictTypesApi: vi.fn<(_: { keyword?: string }) => Promise<List<DictTypeRow>>>(),
    listDictItemsApi: vi.fn<(_: { type_code: string }) => Promise<List<DictItemRow>>>(),
    createDictTypeApi: vi.fn(),
    updateDictTypeApi: vi.fn(),
    deleteDictTypeApi: vi.fn(),
    createDictItemApi: vi.fn(),
    deleteDictItemApi: vi.fn(),
    updateDictItemApi: vi.fn(),
  }
  const confirm = vi.fn<() => Promise<void>>()
  const message = { error: vi.fn(), success: vi.fn(), warning: vi.fn() }
  const lifecycle = { activate: () => {}, deactivate: () => {} }
  const libs: Record<string, unknown> = {
    vue: {
      ...vue,
      onActivated: (action: () => void) => { lifecycle.activate = action },
      onDeactivated: (action: () => void) => { lifecycle.deactivate = action },
    },
    'element-plus': { ElMessage: message, ElMessageBox: { confirm } },
    '@vea/hooks': { useTableFit: () => {} },
    '@/api/system/dict': api,
  }
  const create = new Function('require', `${code}\nreturn dictionaryPage.setup({}, { expose() {} })`) as (
    load: (name: string) => unknown,
  ) => Page
  api.listDictTypesApi.mockResolvedValue(list(typeA, typeB))
  if (initialTypes) api.listDictTypesApi.mockReturnValueOnce(initialTypes)
  api.listDictItemsApi.mockImplementation(async ({ type_code }) => list(type_code === 'a' ? itemA : itemB))
  confirm.mockResolvedValue()
  const scope = vue.effectScope()
  const page = scope.run(() => create(name => libs[name]))!
  settings.push(scope)
  return { api, page, confirm, message, lifecycle }
}

type List<T> = { list: T[]; total: number }
function list<T>(...rows: T[]): List<T> {
  return { list: rows, total: rows.length }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

const typeA: DictTypeRow = { id: 'type-a', code: 'a', name: '类型 A', enabled: true, version: 1, remark: '', created_at: '', updated_at: '' }
const typeB: DictTypeRow = { ...typeA, id: 'type-b', code: 'b', name: '类型 B' }
const itemA: DictItemRow = { id: 'item-a', type_code: 'a', code: 'alpha', label: '项 A', sort_order: 1, enabled: true, version: 1, remark: '', created_at: '', updated_at: '' }
const itemB: DictItemRow = { ...itemA, id: 'item-b', type_code: 'b', code: 'beta', label: '项 B' }

const settings: vue.EffectScope[] = []
afterEach(() => {
  for (const scope of settings.splice(0)) scope.stop()
  vi.clearAllTimers()
  vi.useRealTimers()
})

async function settle() {
  await Promise.resolve()
  await vue.nextTick()
}

describe('字典管理页面的读取与写入目标', () => {
  it('首次选择和项列表同步加载', async () => {
    const { api, page } = setup()
    await settle()
    expect(page.selectedType.value?.id).toBe(typeA.id)
    expect(api.listDictItemsApi).toHaveBeenCalledWith({ page: 1, page_size: 100, type_code: 'a' }, { _silentError: true })
    expect(page.items.value).toEqual([itemA])
  })

  const toggleCases = [
    { enabled: false, remark: '  合成备注：停用后保留\n第二行  ' },
    { enabled: true, remark: '  合成备注：启用后保留\n第二行  ' },
    { enabled: false, remark: '' },
    { enabled: true, remark: '' },
  ]

  it.each(toggleCases)('类型启停绑定完整版本快照：enabled=$enabled remark="$remark"', async ({ enabled, remark }) => {
    const original = { ...typeA, name: '合成类型名称', enabled: !enabled, version: 7, remark }
    const { api, page } = setup(Promise.resolve(list({ ...original }, typeB)))
    await settle()
    const writing = deferred<void>()
    api.updateDictTypeApi.mockReturnValueOnce(writing.promise)
    const row = page.types.value[0]
    const update = page.onToggleType(row, enabled)
    const payload = api.updateDictTypeApi.mock.calls[0]?.[0]

    // 等待期间既不重复提交，也不从已变化的响应式行补取字段。
    Object.assign(row, { name: '稍后的名称', remark: '稍后的备注', version: 99 })
    await page.onToggleType(row, !enabled)
    expect(api.updateDictTypeApi).toHaveBeenCalledTimes(1)
    expect(payload).toEqual({ id: 'type-a', name: '合成类型名称', enabled, remark, version: 7 })

    const current = { ...original, enabled, version: 8 }
    api.listDictTypesApi.mockResolvedValueOnce(list(current, typeB))
    writing.resolve()
    await update
    await settle()
    expect(page.types.value[0]).toEqual(current)
    await page.onToggleType(page.types.value[0], !enabled)
    expect(api.updateDictTypeApi).toHaveBeenLastCalledWith({
      id: 'type-a', name: '合成类型名称', enabled: !enabled, remark, version: 8,
    })
  })

  it.each(toggleCases)('字典项启停绑定完整版本快照：enabled=$enabled remark="$remark"', async ({ enabled, remark }) => {
    const { api, page } = setup()
    await settle()
    const original = { ...itemA, label: '合成条目名称', sort_order: 13, enabled: !enabled, version: 7, remark }
    api.listDictItemsApi.mockResolvedValueOnce(list({ ...original }))
    await page.fetchItems()
    const writing = deferred<void>()
    api.updateDictItemApi.mockReturnValueOnce(writing.promise)
    const row = page.items.value[0]
    const update = page.onToggleItem(row, enabled)
    const payload = api.updateDictItemApi.mock.calls[0]?.[0]

    Object.assign(row, { label: '稍后的名称', sort_order: 99, remark: '稍后的备注', version: 99 })
    await page.onToggleItem(row, !enabled)
    expect(api.updateDictItemApi).toHaveBeenCalledTimes(1)
    expect(payload).toEqual({ id: 'item-a', label: '合成条目名称', sort_order: 13, enabled, remark, version: 7 })

    const current = { ...original, enabled, version: 8 }
    api.listDictItemsApi.mockResolvedValueOnce(list(current))
    writing.resolve()
    await update
    await settle()
    expect(page.items.value[0]).toEqual(current)
    await page.onToggleItem(page.items.value[0], !enabled)
    expect(api.updateDictItemApi).toHaveBeenLastCalledWith({
      id: 'item-a', label: '合成条目名称', sort_order: 13, enabled: !enabled, remark, version: 8,
    })
  })

  it('新搜索发出后拒绝上一关键词的结果与 loading 更新', async () => {
    vi.useFakeTimers()
    const { api, page } = setup()
    await settle()
    const oldSearch = deferred<List<DictTypeRow>>()
    const nextSearch = deferred<List<DictTypeRow>>()
    api.listDictTypesApi.mockReturnValueOnce(oldSearch.promise).mockReturnValueOnce(nextSearch.promise)
    page.keyword.value = 'a'
    page.onKeywordInput()
    await vi.advanceTimersByTimeAsync(300)
    page.keyword.value = 'b'
    page.onKeywordInput()
    oldSearch.resolve(list(typeA))
    await settle()
    expect(page.types.value).toEqual([])
    expect(page.typesLoading.value).toBe(true)
    await vi.advanceTimersByTimeAsync(300)
    nextSearch.resolve(list(typeB))
    await settle()
    expect(page.types.value).toEqual([typeB])
    expect(page.selectedType.value?.id).toBe(typeB.id)
    expect(page.items.value).toEqual([itemB])
  })

  it('旧类型搜索迟于新搜索时不会覆盖已显示列表', async () => {
    vi.useFakeTimers()
    const { api, page } = setup()
    await settle()
    const oldSearch = deferred<List<DictTypeRow>>()
    api.listDictTypesApi.mockReturnValueOnce(oldSearch.promise).mockResolvedValueOnce(list(typeB))
    page.keyword.value = 'a'
    page.onKeywordInput()
    await vi.advanceTimersByTimeAsync(300)
    page.keyword.value = 'b'
    page.onKeywordInput()
    await vi.advanceTimersByTimeAsync(300)
    oldSearch.resolve(list(typeA))
    await settle()
    expect(page.types.value).toEqual([typeB])
    expect(page.selectedType.value?.id).toBe(typeB.id)
  })

  it('A → B → A 只应用最后一代，即使中间响应先结束', async () => {
    const { api, page } = setup()
    await settle()
    page.selectType(page.types.value[1])
    await settle()
    const aBefore = deferred<List<DictItemRow>>()
    const b = deferred<List<DictItemRow>>()
    const newA = { ...itemA, label: '当前 A' }
    const aAfter = deferred<List<DictItemRow>>()
    api.listDictItemsApi
      .mockReturnValueOnce(aBefore.promise).mockReturnValueOnce(b.promise).mockReturnValueOnce(aAfter.promise)
    page.selectType(page.types.value[0])
    page.selectType(page.types.value[1])
    page.selectType(page.types.value[0])
    b.resolve(list(itemB))
    await settle()
    expect(page.items.value).toEqual([])
    expect(page.itemsLoading.value).toBe(true)
    aAfter.resolve(list(newA))
    await settle()
    aBefore.resolve(list(itemA))
    await settle()
    expect(page.items.value).toEqual([newA])
  })

  it('切换时立即清空旧行，当前加载前不会打开新增或写旧行', async () => {
    const { api, page, confirm } = setup()
    await settle()
    page.selectType(page.types.value[0])
    await settle()
    const old = page.items.value[0]
    const next = deferred<List<DictItemRow>>()
    api.listDictItemsApi.mockReturnValueOnce(next.promise)
    page.selectType(page.types.value[1])
    expect(page.items.value).toEqual([])
    page.openItemCreate()
    expect(page.itemVisible.value).toBe(false)
    await page.onToggleItem(old, false)
    await page.onDeleteItem(old)
    expect(confirm).not.toHaveBeenCalled()
    expect(api.updateDictItemApi).not.toHaveBeenCalled()
    expect(api.deleteDictItemApi).not.toHaveBeenCalled()
    next.resolve(list(itemB))
    await settle()
    expect(page.items.value).toEqual([itemB])
  })

  it('切换后不能提交先前打开的新增项', async () => {
    const { api, page } = setup()
    await settle()
    page.selectType(page.types.value[0])
    await settle()
    page.openItemCreate()
    page.itemForm.code = 'new'
    page.itemForm.label = '新选项'
    page.selectType(page.types.value[1])
    await settle()
    expect(page.itemVisible.value).toBe(false)
    await page.submitItem()
    expect(api.createDictItemApi).not.toHaveBeenCalled()
  })

  it('已发送的新增只提交原类型，迟到成功不刷新新选择', async () => {
    const { api, page } = setup()
    await settle()
    page.selectType(page.types.value[0])
    await settle()
    const creating = deferred<void>()
    api.createDictItemApi.mockReturnValueOnce(creating.promise)
    page.openItemCreate()
    page.itemForm.code = 'new'
    page.itemForm.label = '新选项'
    const create = page.submitItem()
    expect(api.createDictItemApi).toHaveBeenCalledWith({
      type_code: 'a', code: 'new', label: '新选项', sort_order: 2,
    })
    page.selectType(page.types.value[1])
    await settle()
    api.listDictItemsApi.mockClear()
    creating.resolve()
    await create
    expect(api.listDictItemsApi).not.toHaveBeenCalled()
    expect(page.items.value).toEqual([itemB])
  })

  it('旧删除确认即使返回同一类型也不能提交', async () => {
    const { api, page, confirm } = setup()
    await settle()
    page.selectType(page.types.value[0])
    await settle()
    const approval = deferred<void>()
    confirm.mockReturnValueOnce(approval.promise)
    const deletion = page.onDeleteItem(page.items.value[0])
    page.selectType(page.types.value[1])
    page.selectType(page.types.value[0])
    await settle()
    approval.resolve()
    await deletion
    expect(api.deleteDictItemApi).not.toHaveBeenCalled()
  })

  it('已发送的删除保留确认前快照，迟到成功不刷新新类型', async () => {
    const { api, page } = setup()
    await settle()
    page.selectType(page.types.value[0])
    await settle()
    const deleting = deferred<void>()
    api.deleteDictItemApi.mockReturnValueOnce(deleting.promise)
    const deletion = page.onDeleteItem(page.items.value[0])
    await settle()
    expect(api.deleteDictItemApi).toHaveBeenCalledWith({ id: itemA.id, version: itemA.version })
    page.selectType(page.types.value[1])
    await settle()
    api.listDictItemsApi.mockClear()
    deleting.resolve()
    await deletion
    expect(api.listDictItemsApi).not.toHaveBeenCalled()
    expect(page.items.value).toEqual([itemB])
  })

  it('旧世代写入结束后回读当前同类型，不显示旧失败', async () => {
    const { api, page, message } = setup()
    await settle()
    page.selectType(page.types.value[0])
    await settle()
    const mutation = deferred<void>()
    api.updateDictItemApi.mockReturnValueOnce(mutation.promise)
    const update = page.onToggleItem(page.items.value[0], false)
    expect(api.updateDictItemApi).toHaveBeenCalledWith({
      id: itemA.id, version: itemA.version, enabled: false, label: itemA.label, sort_order: 1, remark: '',
    })
    page.selectType(page.types.value[1])
    page.selectType(page.types.value[0])
    await settle()
    api.listDictItemsApi.mockClear()
    const newA = { ...itemA, version: 2 }
    api.listDictItemsApi.mockResolvedValueOnce(list(newA))
    mutation.reject({ response: { data: { message: '版本冲突' } } })
    await update
    await settle()
    expect(message.error).not.toHaveBeenCalled()
    expect(api.listDictItemsApi.mock.lastCall?.[0]).toMatchObject({ type_code: 'a' })
    expect(page.items.value).toEqual([newA])
  })

  it('旧新增未完成时可打开同类型新草稿，但不能重叠提交或被旧响应关闭', async () => {
    const { api, page, message } = setup()
    await settle()
    page.selectType(page.types.value[0])
    await settle()
    const pending = deferred<void>()
    api.createDictItemApi.mockReturnValueOnce(pending.promise)
    page.openItemCreate()
    page.itemForm.code = 'old'
    page.itemForm.label = '旧草稿'
    const oldSave = page.submitItem()
    page.itemVisible.value = false
    page.openItemCreate()
    page.itemForm.code = 'new'
    page.itemForm.label = '新草稿'
    await page.submitItem()
    expect(api.createDictItemApi).toHaveBeenCalledTimes(1)
    pending.resolve()
    await oldSave
    await settle()
    expect(page.itemForm.label).toBe('新草稿')
    expect(page.itemError.value).toBe('')
    expect(page.itemVisible.value).toBe(true)
    expect(message.success).not.toHaveBeenCalled()
    await page.submitItem()
    expect(api.createDictItemApi.mock.lastCall?.[0]).toMatchObject({ type_code: 'a', label: '新草稿' })
  })

  it('当前读取失败清空旧行，显示失败且禁止写，重试成功后恢复', async () => {
    const { api, page } = setup()
    await settle()
    page.selectType(page.types.value[0])
    await settle()
    api.listDictItemsApi.mockRejectedValueOnce({ response: { data: { message: '查询失败' } } })
    await page.fetchItems().catch(() => {})
    expect(page.items.value).toEqual([])
    expect(page.itemsReadError.value).toBe('查询失败')
    page.openItemCreate()
    expect(page.itemVisible.value).toBe(false)
    await page.fetchItems()
    expect(page.itemsReadError.value).toBe('')
    expect(page.items.value).toEqual([itemA])
    page.openItemCreate()
    expect(page.itemVisible.value).toBe(true)
  })

  it('当前乐观锁失败刷新权威行，再提交时使用新版本', async () => {
    const { api, page, message } = setup()
    await settle()
    page.selectType(page.types.value[0])
    await settle()
    const current = { ...itemA, label: '当前条目', sort_order: 17, remark: '当前条目备注', version: 2 }
    api.updateDictItemApi.mockRejectedValueOnce({ response: { status: 409, data: { message: '版本冲突' } } })
    api.listDictItemsApi.mockResolvedValueOnce(list(current))
    await page.onToggleItem(page.items.value[0], false)
    await settle()
    expect(message.error).toHaveBeenCalledWith('版本冲突')
    expect(page.items.value).toEqual([current])
    await page.onToggleItem(page.items.value[0], false)
    expect(api.updateDictItemApi).toHaveBeenLastCalledWith({
      id: 'item-a', label: '当前条目', sort_order: 17, enabled: false, remark: '当前条目备注', version: 2,
    })
  })

  it('类型乐观锁失败刷新权威行，重试绑定当前名称、备注和版本', async () => {
    const { api, page, message } = setup()
    await settle()
    const current = { ...typeA, name: '当前类型', remark: '当前类型备注', version: 2 }
    api.updateDictTypeApi.mockRejectedValueOnce({ response: { status: 409, data: { message: '类型版本冲突' } } })
    api.listDictTypesApi.mockResolvedValueOnce(list(current, typeB))
    await page.onToggleType(page.types.value[0], false)
    await settle()
    expect(message.error).toHaveBeenCalledWith('类型版本冲突')
    expect(page.types.value[0]).toEqual(current)
    await page.onToggleType(page.types.value[0], false)
    expect(api.updateDictTypeApi).toHaveBeenLastCalledWith({
      id: 'type-a', name: '当前类型', enabled: false, remark: '当前类型备注', version: 2,
    })
  })

  it('过滤变更后旧类型删除确认不能提交', async () => {
    vi.useFakeTimers()
    const { api, page, confirm } = setup()
    await settle()
    const approval = deferred<void>()
    confirm.mockReturnValueOnce(approval.promise)
    const deletion = page.onDeleteType(page.types.value[0])
    page.keyword.value = 'b'
    page.onKeywordInput()
    approval.resolve()
    await deletion
    expect(api.deleteDictTypeApi).not.toHaveBeenCalled()
  })

  it('旧类型写入结束后重读仍在当前列表里的类型，不显示旧失败', async () => {
    const { api, page, message } = setup()
    await settle()
    const mutation = deferred<void>()
    api.updateDictTypeApi.mockReturnValueOnce(mutation.promise)
    const update = page.onToggleType(page.types.value[0], false)
    page.selectType(page.types.value[1])
    page.selectType(page.types.value[0])
    await settle()
    api.listDictTypesApi.mockClear()
    const current = { ...typeA, version: 2 }
    api.listDictTypesApi.mockResolvedValueOnce(list(current, typeB))
    mutation.reject({ response: { data: { message: '类型版本冲突' } } })
    await update
    await settle()
    expect(message.error).not.toHaveBeenCalled()
    expect(api.listDictTypesApi).toHaveBeenCalledTimes(1)
    expect(page.types.value[0]).toEqual(current)
  })

  it('类型写入成功后使新关键词的在途旧快照失效', async () => {
    vi.useFakeTimers()
    const { api, page, message } = setup()
    await settle()
    const mutation = deferred<void>()
    api.updateDictTypeApi.mockReturnValueOnce(mutation.promise)
    const update = page.onToggleType(page.types.value[0], false)
    const previous = deferred<List<DictTypeRow>>()
    const disabled = { ...typeA, enabled: false, version: 2 }
    api.listDictTypesApi.mockReturnValueOnce(previous.promise).mockResolvedValueOnce(list(disabled))
    page.keyword.value = 'a'
    page.onKeywordInput()
    await vi.advanceTimersByTimeAsync(300)
    expect(page.types.value).toEqual([])
    mutation.resolve()
    await update
    previous.resolve(list(typeA))
    await settle()
    expect(api.listDictTypesApi).toHaveBeenLastCalledWith(
      { page: 1, page_size: 100, keyword: 'a' }, { _silentError: true },
    )
    expect(page.types.value).toEqual([disabled])
    expect(message.success).not.toHaveBeenCalled()
  })

  it('旧类型写入后的回读失败保留当前字典项草稿，成功重试前禁止写入', async () => {
    const { api, page, message } = setup()
    await settle()
    const mutation = deferred<void>()
    api.updateDictTypeApi.mockReturnValueOnce(mutation.promise)
    const update = page.onToggleType(page.types.value[0], false)
    page.selectType(page.types.value[1])
    await settle()
    page.openItemCreate()
    Object.assign(page.itemForm, { code: 'draft', label: '保留的 B 草稿' })
    const readBack = deferred<List<DictTypeRow>>()
    api.listDictTypesApi.mockReturnValueOnce(readBack.promise)

    mutation.resolve()
    await update
    readBack.reject({ response: { data: { message: '类型暂不可读' } } })
    await settle()
    expect(page.typesReadError.value).toBe('类型暂不可读')
    expect(page.types.value).toEqual([typeA, typeB])
    expect(page.selectedType.value?.id).toBe(typeB.id)
    expect(page.itemVisible.value).toBe(true)
    expect(page.itemForm).toMatchObject({ code: 'draft', label: '保留的 B 草稿' })
    expect(message.success).not.toHaveBeenCalled()

    await page.submitItem()
    await page.onToggleType(page.types.value[1], false)
    await page.onToggleItem(page.items.value[0], false)
    expect(api.createDictItemApi).not.toHaveBeenCalled()
    expect(api.updateDictTypeApi).toHaveBeenCalledTimes(1)
    expect(api.updateDictItemApi).not.toHaveBeenCalled()

    const retry = deferred<List<DictTypeRow>>()
    api.listDictTypesApi.mockReturnValueOnce(retry.promise)
    const retrying = page.fetchTypes()
    await page.submitItem()
    expect(api.createDictItemApi).not.toHaveBeenCalled()
    retry.resolve(list({ ...typeA, enabled: false, version: 2 }, { ...typeB }))
    await retrying
    expect(page.itemVisible.value).toBe(true)
    await page.submitItem()
    expect(api.createDictItemApi).toHaveBeenCalledExactlyOnceWith({
      type_code: typeB.code, code: 'draft', label: '保留的 B 草稿', sort_order: 2,
    })
  })

  it('首次读取和新关键词读取失败都不保留旧类型数据', async () => {
    vi.useFakeTimers()
    const { api, page } = setup(Promise.reject(new Error('首读失败')))
    await settle()
    expect(page.typesReadError.value).toBe('读取字典类型失败')
    expect(page.types.value).toEqual([])
    expect(page.selectedType.value).toBeNull()
    await page.fetchTypes()
    expect(page.selectedType.value?.id).toBe(typeA.id)

    api.listDictTypesApi.mockRejectedValueOnce(new Error('筛选失败'))
    page.keyword.value = 'b'
    page.onKeywordInput()
    await vi.advanceTimersByTimeAsync(300)
    expect(page.typesReadError.value).toBe('读取字典类型失败')
    expect(page.types.value).toEqual([])
    expect(page.selectedType.value).toBeNull()
    expect(page.items.value).toEqual([])
  })

  it('缓存页重激活后接纳已创建的类型并保留当前选择，不显示上一代提示', async () => {
    const { api, page, message, lifecycle } = setup()
    await settle()
    page.selectType(page.types.value[1])
    const mutation = deferred<DictTypeRow>()
    api.createDictTypeApi.mockReturnValueOnce(mutation.promise)
    page.openTypeCreate()
    Object.assign(page.typeForm, { code: 'new', name: '合成新类型' })
    const saving = page.submitType()
    lifecycle.deactivate()
    lifecycle.activate()
    await settle()
    expect(page.selectedType.value?.id).toBe(typeB.id)

    const created = { ...typeA, id: 'type-new', code: 'new' }
    api.listDictTypesApi.mockResolvedValueOnce(list(created, typeA, typeB))
    mutation.resolve(created)
    await saving
    await settle()
    expect(page.types.value).toEqual([created, typeA, typeB])
    expect(page.selectedType.value?.id).toBe(typeB.id)
    expect(message.success).not.toHaveBeenCalled()
  })

  it('独立类型刷新替换表格行后，接受相同编码和版本的删除确认', async () => {
    const { api, page, confirm } = setup()
    await settle()
    const mutation = deferred<void>()
    const approval = deferred<void>()
    api.updateDictTypeApi.mockReturnValueOnce(mutation.promise)
    confirm.mockReturnValueOnce(approval.promise)
    const update = page.onToggleType(page.types.value[0], false)
    const row = page.types.value[1]
    const deletion = page.onDeleteType(row)
    api.listDictTypesApi.mockResolvedValueOnce(list({ ...typeA, enabled: false, version: 2 }, { ...typeB }))
    mutation.resolve()
    await update
    await settle()
    expect(page.types.value[1]).not.toBe(row)

    approval.resolve()
    await deletion
    expect(api.deleteDictTypeApi).toHaveBeenCalledExactlyOnceWith({ id: typeB.id, code: typeB.code, version: typeB.version })
  })

  it('独立条目刷新替换表格行后，接受当前类型内相同版本的删除确认', async () => {
    const { api, page, confirm } = setup()
    await settle()
    const second = { ...itemA, id: 'item-a-2', code: 'alpha-2', label: '项 A-2' }
    api.listDictItemsApi.mockResolvedValueOnce(list(itemA, second))
    await page.fetchItems()
    const mutation = deferred<void>()
    const approval = deferred<void>()
    api.updateDictItemApi.mockReturnValueOnce(mutation.promise)
    confirm.mockReturnValueOnce(approval.promise)
    const update = page.onToggleItem(page.items.value[0], false)
    const row = page.items.value[1]
    const deletion = page.onDeleteItem(row)
    api.listDictItemsApi.mockResolvedValueOnce(list({ ...itemA, enabled: false, version: 2 }, { ...second }))
    mutation.resolve()
    await update
    await settle()
    expect(page.items.value[1]).not.toBe(row)

    approval.resolve()
    await deletion
    expect(api.deleteDictItemApi).toHaveBeenCalledExactlyOnceWith({ id: second.id, version: second.version })
  })

  it('同一字典项已变更版本时必须重新确认删除', async () => {
    const { api, page, confirm, message } = setup()
    await settle()
    const approval = deferred<void>()
    confirm.mockReturnValueOnce(approval.promise)
    const deletion = page.onDeleteItem(page.items.value[0])
    api.listDictItemsApi.mockResolvedValueOnce(list({ ...itemA, label: '新的名称', version: 2 }))
    await page.fetchItems()

    approval.resolve()
    await deletion
    expect(api.deleteDictItemApi).not.toHaveBeenCalled()
    expect(message.warning).toHaveBeenCalledExactlyOnceWith('字典项正在刷新或已变化，请重新确认')
  })

  it('同一类型已变更版本时必须重新确认删除', async () => {
    const { api, page, confirm, message } = setup()
    await settle()
    const approval = deferred<void>()
    confirm.mockReturnValueOnce(approval.promise)
    const deletion = page.onDeleteType(page.types.value[0])
    api.listDictTypesApi.mockResolvedValueOnce(list({ ...typeA, name: '新的名称', version: 2 }, typeB))
    await page.fetchTypes()

    approval.resolve()
    await deletion
    expect(api.deleteDictTypeApi).not.toHaveBeenCalled()
    expect(message.warning).toHaveBeenCalledExactlyOnceWith('字典类型正在刷新或已变化，请重新确认')
  })

  it('类型删除版本冲突刷新权威行，不自动重试，重试须重新确认当前对象', async () => {
    const { api, page, message } = setup()
    await settle()
    const current = { ...typeA, name: '当前类型', version: 2 }
    api.deleteDictTypeApi.mockRejectedValueOnce({ response: { status: 409, data: { message: '类型已被他人更新' } } })
    api.listDictTypesApi.mockResolvedValueOnce(list(current, typeB))
    await page.onDeleteType(page.types.value[0])
    await settle()
    expect(api.deleteDictTypeApi).toHaveBeenCalledExactlyOnceWith({ id: 'type-a', code: 'a', version: 1 })
    expect(message.error).toHaveBeenCalledWith('类型已被他人更新；已刷新，请重新确认当前对象后再删除')
    expect(page.types.value[0]).toEqual(current)

    await page.onDeleteType(page.types.value[0])
    expect(api.deleteDictTypeApi).toHaveBeenCalledTimes(2)
    expect(api.deleteDictTypeApi).toHaveBeenLastCalledWith({ id: 'type-a', code: 'a', version: 2 })
  })

  it('条目删除版本冲突刷新权威行，不自动重试，重试须重新确认当前对象', async () => {
    const { api, page, message } = setup()
    await settle()
    const current = { ...itemA, label: '当前条目', version: 2 }
    api.deleteDictItemApi.mockRejectedValueOnce({ response: { status: 409, data: { message: '条目已被他人更新' } } })
    api.listDictItemsApi.mockResolvedValueOnce(list(current))
    await page.onDeleteItem(page.items.value[0])
    await settle()
    expect(api.deleteDictItemApi).toHaveBeenCalledExactlyOnceWith({ id: 'item-a', version: 1 })
    expect(message.error).toHaveBeenCalledWith('条目已被他人更新；已刷新，请重新确认当前对象后再删除')
    expect(page.items.value).toEqual([current])

    await page.onDeleteItem(page.items.value[0])
    expect(api.deleteDictItemApi).toHaveBeenCalledTimes(2)
    expect(api.deleteDictItemApi).toHaveBeenLastCalledWith({ id: 'item-a', version: 2 })
  })

  it('条目删除非冲突失败透传后端消息并回读，不自动重试', async () => {
    const { api, page, message } = setup()
    await settle()
    api.deleteDictItemApi.mockRejectedValueOnce({ response: { status: 400, data: { message: '存在引用' } } })
    await page.onDeleteItem(page.items.value[0])
    await settle()
    expect(message.error).toHaveBeenCalledWith('存在引用')
    expect(api.deleteDictItemApi).toHaveBeenCalledTimes(1)
  })

  it('缓存页离开后废弃旧确认和旧读取，回到页面重新加载', async () => {
    const { api, page, confirm, lifecycle } = setup()
    await settle()
    const approval = deferred<void>()
    confirm.mockReturnValueOnce(approval.promise)
    const deletion = page.onDeleteItem(page.items.value[0])
    page.openItemCreate()
    const old = deferred<List<DictItemRow>>()
    api.listDictItemsApi.mockReturnValueOnce(old.promise)
    const previous = page.fetchItems()
    lifecycle.deactivate()
    expect(page.itemVisible.value).toBe(false)
    expect(page.items.value).toEqual([])
    approval.resolve()
    await deletion
    expect(api.deleteDictItemApi).not.toHaveBeenCalled()
    const current = { ...itemA, version: 2 }
    api.listDictItemsApi.mockResolvedValueOnce(list(current))
    lifecycle.activate()
    await settle()
    old.resolve(list(itemA))
    await previous
    expect(page.items.value).toEqual([current])
  })

  it('旧的新建类型结果不会关闭同页重开的新草稿', async () => {
    const { api, page, message } = setup()
    await settle()
    const pending = deferred<DictTypeRow>()
    api.createDictTypeApi.mockReturnValueOnce(pending.promise)
    page.openTypeCreate()
    page.typeForm.code = 'old'
    page.typeForm.name = '旧类型草稿'
    const saving = page.submitType()
    page.typeVisible.value = false
    page.openTypeCreate()
    page.typeForm.code = 'new'
    page.typeForm.name = '新类型草稿'
    pending.resolve({ ...typeA, id: 'new-id', code: 'old' })
    await saving
    expect(page.typeVisible.value).toBe(true)
    expect(page.typeForm.name).toBe('新类型草稿')
    expect(message.success).not.toHaveBeenCalled()
  })
})

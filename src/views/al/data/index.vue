<script setup lang="ts">
/**
 * 活动列表（P4-W5——al_data 菜单页，activelist:data:read 可见/写操作挂 data:write；2026-10-08 由「名单数据」改名；2026-10-13 菜单改「活动数据」（顶级「活动列表」命名批））
 *
 * - 列由所选类型的 schema 驱动（字段四类型：int/string/int_list/string_list）——
 *   动态列表格+动态表单，sensitive 字段原样显示（脱敏属日志侧语义）
 * - cursor 分页（无 total——十三批「无 total 形态」）：页栈管理见 ./cursorPager（单测防漂移）
 * - 导出=blob 下载（裸 JSON 数组流）；导入=同格式文件直发 body（网关上限 1MB 前端预检）
 * - 编辑带 version 乐观锁（冲突 409+100008——activelist 跨服务码段）
 * - 2026-10-08 排版改版：类型上下文头（schema 徽标）/行详情抽屉（点行开，全字段+系统字段）/
 *   空态引导（去注册/写入首条）；废弃类型只读视图——浏览/导出/删行放行（gateType 对读与
 *   软删本就放行），写入/导入/编辑随 409 门同步隐藏
 * - 2026-10-12 两栏改版：类型选择由下拉改**左右双栏**（左类型清单分组+搜索，右数据区）——
 *   类型全集与废弃态一眼可见；废弃只读/门控语义不变
 */
import { apiErrorBody } from '@/utils/apiError'
import { formatDateTime } from '@/utils/datetime'
import { computed, onActivated, onDeactivated, onScopeDispose, reactive, ref, watch } from 'vue'
import { useTableFit } from '@vea/hooks'
import {
  ElAlert, ElButton, ElCard, ElCheckbox, ElDescriptions, ElDescriptionsItem, ElDialog, ElDrawer,
  ElEmpty, ElForm, ElFormItem, ElInput, ElInputNumber, ElMessage, ElMessageBox,
  ElOption, ElSelect, ElTable, ElTableColumn, ElTag,
} from 'element-plus'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import {
  createAlDataApi, deleteAlDataApi, exportAlDataApi, importAlDataApi, listAlDataApi,
  listAlTypesApi, restoreAlDataApi, updateAlDataApi,
  type AlCursor, type AlDataDoc, type AlFieldDef,
} from '@/api/al'
import { popCursor, pushCursor, resetCursor } from './cursorPager'

// keep-alive 契约：name=动态路由名（菜单 code al_data，组件路径 al/data/index）
defineOptions({ name: 'al_data' })

const router = useRouter()

// ─── 类型选择（schema 驱动列；废弃类型只读可见——API 读取本就放行（gateType 仅查存在），
//     UI 开只读存档入口：浏览/导出/删行清理放行，写入/导入/编辑随 409 门同步关闭）───
const typesQuery = useQuery({ queryKey: ['al', 'types'], queryFn: listAlTypesApi })
const allTypes = computed(() => typesQuery.data.value?.list ?? [])
// 左栏类型清单搜索（两栏改版——取代下拉；按类型名不区分大小写过滤）
const typeFilter = ref('')
const filteredTypes = computed(() => {
  const kw = typeFilter.value.trim().toLowerCase()
  return kw ? allTypes.value.filter((t) => t.type_name.toLowerCase().includes(kw)) : allTypes.value
})
const activeFiltered = computed(() => filteredTypes.value.filter((t) => t.status === 'active'))
const deprecatedFiltered = computed(() => filteredTypes.value.filter((t) => t.status === 'deprecated'))
// 分组折叠：已废弃默认收起（E2E 累积类型多——藏噪音）；搜索时强制展开命中分组
const activeOpen = ref(true)
const deprecatedOpen = ref(false)
const activeOpenEff = computed(() => activeOpen.value || !!typeFilter.value.trim())
const deprecatedOpenEff = computed(() => deprecatedOpen.value || !!typeFilter.value.trim())
const selectedType = ref('')
const selectedDef = computed(() => allTypes.value.find((t) => t.type_name === selectedType.value))
const isDeprecated = computed(() => selectedDef.value?.status === 'deprecated')
const schema = computed<AlFieldDef[]>(
  () => selectedDef.value?.fields ?? [],
)

const FIELD_TYPE_LABELS: Record<AlFieldDef['type'], string> = {
  int: '整数', string: '文本', int_list: '整数列表', string_list: '文本列表',
}
function fieldTypeLabel(t: AlFieldDef['type']): string {
  return FIELD_TYPE_LABELS[t] ?? t
}

// ─── cursor 分页列表 ───
const list = ref<AlDataDoc[]>([])
const listLoading = ref(false)
const pageSize = ref(20)
const nextCursor = ref<AlCursor | null>(null)
/** 页栈：stack[k-1]=第 k 页末 cursor——上一页弹栈、下一页压栈（纯函数见 cursorPager） */
const cursorStack = ref<AlCursor[]>([])
const page = computed(() => cursorStack.value.length + 1)

// 审计修复（2026-09-30 P2）：切类型竞态守卫（ticket/create 的 fieldsSeq 同款）——
// 旧类型在途响应后到不得覆盖新选中类型
let fetchSeq = 0
async function fetchPage(cursor: AlCursor | null) {
  if (!selectedType.value) return
  const seq = ++fetchSeq
  listLoading.value = true
  try {
    const res = await listAlDataApi(selectedType.value, {
      page_size: pageSize.value,
      include_deleted: true,
      ...(filt.q ? { q: filt.q } : {}),
      ...(filt.field && filt.value ? { field: filt.field, value: filt.value } : {}),
      ...(cursor ? { after_created_at: cursor.after_created_at, after_id: cursor.after_id } : {}),
    })
    if (seq !== fetchSeq) return // 已切别的类型——弃置过期响应
    list.value = res.list
    pageSize.value = res.page_size
    nextCursor.value = res.next_cursor
  } catch {
    if (seq !== fetchSeq) return
    list.value = []
    nextCursor.value = null
  } finally {
    if (seq === fetchSeq) listLoading.value = false
  }
}

function goNext() {
  if (!nextCursor.value) return
  fetchPage(pushCursor(cursorStack.value, { ...nextCursor.value }))
}

function goPrev() {
  fetchPage(popCursor(cursorStack.value))
}

// ─── 搜索/筛选（2026-10-28：q 全标量字段模糊 + 字段/值精确——后端同批交付）───
// 变更即查（筛选栏配方：文本 300ms 防抖）；筛选变更重置游标从头查
const filt = reactive({ q: '', field: '', value: '' })
const scalarFieldNames = computed(() =>
  schema.value.filter((f) => f.type === 'int' || f.type === 'string').map((f) => f.name),
)
let filtTimer: ReturnType<typeof setTimeout> | undefined
function scheduleFiltFetch() {
  clearTimeout(filtTimer)
  filtTimer = setTimeout(() => {
    resetCursor(cursorStack.value)
    fetchPage(null)
  }, 300)
}
function resetFilt() {
  clearTimeout(filtTimer)
  filt.q = ''
  filt.field = ''
  filt.value = ''
  resetCursor(cursorStack.value)
  fetchPage(null)
}

watch(selectedType, () => {
  clearTimeout(filtTimer)
  filt.q = ''
  filt.field = ''
  filt.value = ''
  resetCursor(cursorStack.value)
  list.value = []
  fetchPage(null)
})

function refresh(expectedDetailSession = detailSession) {
  // 刷新回首页（cursor 可能因写入漂移——保守重置）
  resetCursor(cursorStack.value)
  if (expectedDetailSession === detailSession) {
    detailVisible.value = false
    detailRow.value = null
  }
  return fetchPage(null)
}

// ─── 新增/编辑（schema 驱动表单）───
const formVisible = ref(false)
const formIsCreate = ref(true)
const formSaving = ref(false)
const formError = ref('')
const formConflict = ref(false)
let formSession = 0
let formType = ''
let pageGeneration = 0
function invalidateForm() {
  ++formSession
  formSaving.value = false
  formConflict.value = false
}
watch(formVisible, (visible) => {
  if (!visible) invalidateForm()
}, { flush: 'sync' })
/** 编辑态隐藏携带：行 id+version 乐观锁 */
const editing = reactive({ id: '', version: 0 })
/** 编辑态文本列表逐项保存边界；快捷分隔输入仅用于创建和整数列表。 */
const formData = ref<Record<string, unknown>>({})
const listText = ref<Record<string, string>>({})
const originalData = ref<Record<string, unknown>>({})
const originalListText = ref<Record<string, string>>({})

function cloneFieldValue(value: unknown): unknown {
  // schema 仅含标量和标量数组；草稿及对照快照均不得引用列表原行的数组。
  return Array.isArray(value) ? [...value] : value
}

function toFormFieldValue(f: AlFieldDef, doc?: AlDataDoc): { value: unknown; text: string } {
  if (!doc) return { value: f.type === 'int' ? undefined : '', text: '' }
  const raw = cloneFieldValue(doc.data[f.name])
  if (f.type === 'int_list' || f.type === 'string_list') {
    return { value: raw, text: Array.isArray(raw) ? raw.join('\n') : String(raw ?? '') }
  }
  return { value: raw, text: '' }
}

function openCreate() {
  if (!selectedDef.value || isDeprecated.value) return
  invalidateForm()
  formType = selectedType.value
  formIsCreate.value = true
  formError.value = ''
  formData.value = {}
  listText.value = {}
  originalData.value = {}
  originalListText.value = {}
  for (const f of schema.value) {
    const { value, text } = toFormFieldValue(f)
    formData.value[f.name] = value
    listText.value[f.name] = text
  }
  formVisible.value = true
}

function openEdit(row: AlDataDoc) {
  if (listLoading.value) return
  invalidateForm()
  formType = selectedType.value
  formIsCreate.value = false
  formError.value = ''
  editing.id = row.id
  editing.version = row.version
  formData.value = {}
  listText.value = {}
  originalData.value = {}
  originalListText.value = {}
  for (const f of schema.value) {
    const { value, text } = toFormFieldValue(f, row)
    formData.value[f.name] = value
    listText.value[f.name] = text
    originalData.value[f.name] = cloneFieldValue(value)
    originalListText.value[f.name] = text
  }
  formVisible.value = true
}

/** 列表文本 → 项数组（容积分隔：换行/逗号/分号中英文皆可——Excel 列粘贴与
 *  逗号串直接可用；trim + 剔空。校验与提交共用此解析，无第二份分隔语义） */
function parseListLines(text: string | undefined): string[] {
  return (text ?? '').split(/[\n,，;；]+/).map((s) => s.trim()).filter(Boolean)
}

/** 文本列表编辑不解析分隔符，空字符串也占一项。 */
function listItems(f: AlFieldDef): string[] {
  if (!formIsCreate.value && f.type === 'string_list') {
    const value = formData.value[f.name]
    return Array.isArray(value) ? value : []
  }
  return parseListLines(listText.value[f.name])
}

function addTextItem(name: string) {
  const value = formData.value[name]
  formData.value[name] = [...(Array.isArray(value) ? value : []), '']
}

function sameFieldValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, i) => item === right[i])
  }
  return left === right
}

/** 去重（保序，首个出现位留原值）写回文本域 */
function dedupList(name: string) {
  const lines = parseListLines(listText.value[name])
  const seen = new Set<string>()
  const out = lines.filter((s) => !seen.has(s) && seen.add(s))
  const removed = lines.length - out.length
  listText.value[name] = out.join('\n')
  if (removed > 0) ElMessage.success(`已去重 ${removed} 项`)
  else ElMessage.info('无重复项')
}

/** 创建保留快捷粘贴语义；更新只提交相对打开时快照的实际变化。 */
function buildDataBody(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of schema.value) {
    let value = formData.value[f.name]
    if (f.type === 'int_list' || f.type === 'string_list') {
      if (formIsCreate.value || (f.type === 'int_list' && listText.value[f.name] !== originalListText.value[f.name])) {
        const items = listItems(f)
        value = f.type === 'int_list' ? items.map(Number) : items
      }
    }
    if (formIsCreate.value) {
      if (value !== undefined && value !== '') out[f.name] = value
      continue
    }
    const original = originalData.value[f.name]
    if (sameFieldValue(value, original)) continue
    if (f.type === 'string' && (value === '' || value == null)) {
      // 从未有值的输入仍属未修改；已有文本被明确清空才覆写为 null。
      if (original === '' || original == null) continue
      value = null
    }
    if (value !== undefined) out[f.name] = cloneFieldValue(value)
  }
  return out
}

async function submitForm() {
  if (!formVisible.value || formSaving.value || formConflict.value || formType !== selectedType.value) return
  const session = formSession
  const details = detailSession
  const type = formType
  const isCreate = formIsCreate.value
  const { id, version } = editing
  const isCurrent = () => session === formSession && formVisible.value && type === selectedType.value
  const body = buildDataBody()
  // required + 长度手检（动态 prop 校验在此场景过重——四类型封闭手检即可；
  // 长度上限与后端 checkValue 同源语义：字符数非字节，0/缺省=255——2026-10-27 拍板）
  for (const f of schema.value) {
    if (!formIsCreate.value && !Object.hasOwn(body, f.name)) continue
    if (f.required) {
      if (f.type === 'int_list' || f.type === 'string_list') {
        if (!listItems(f).length) {
          formError.value = `「${f.name}」为必填`
          return
        }
      } else if (formData.value[f.name] == null || formData.value[f.name] === '') {
        formError.value = `「${f.name}」为必填`
        return
      }
    }
    if (f.type === 'int_list' || f.type === 'string_list') {
      const items = listItems(f)
      const itemLimit = f.max_list_items || 100
      if (items.length > itemLimit) {
        formError.value = `「${f.name}」共 ${items.length} 项，超上限 ${itemLimit}`
        return
      }
    }
    if (f.type === 'string_list') {
      const limit = f.max_chars || 255
      const lines = listItems(f)
      const bad = lines.findIndex((s) => [...s].length > limit)
      if (bad >= 0) {
        formError.value = `「${f.name}」第 ${bad + 1} 项超长（上限 ${limit} 字符）`
        return
      }
    }
  }
  formSaving.value = true
  formError.value = ''
  try {
    if (isCreate) await createAlDataApi(type, body)
    else await updateAlDataApi(type, id, { data: body, version })
    if (!isCurrent()) return
    ElMessage.success(isCreate ? '已写入' : '已更新')
    formVisible.value = false
    await refresh(details)
  } catch (err: unknown) {
    if (!isCurrent()) return
    const resp = apiErrorBody(err)
    // AL 同一冲突码还用于唯一键和短时锁冲突。只有过期的行快照需要重开。
    const message = resp.message ?? ''
    const changed = message.startsWith('数据已软删') || /[（；]expected_version=\d+/.test(message)
    if (!isCreate && resp.code === 100008 && changed) {
      formConflict.value = true
      formError.value = message.startsWith('数据已软删') ? message : '版本冲突：该行已被他人变更，请关闭后从刷新列表重新打开确认（乐观锁）'
      list.value = []
      await refresh(details)
    } else {
      formError.value = resp.message ?? '保存失败，请核对结果后重试'
    }
  } finally {
    if (isCurrent()) formSaving.value = false
  }
}

// ─── 删除/恢复（目标快照 + 可选版本 CAS；不自动重试写入）───
const pendingRows = new Set<string>()
async function changeRowState(row: AlDataDoc, restore: boolean) {
  if (!selectedType.value || listLoading.value) return
  // 首个 await 前拍下目标，确认过程中切类型或原行对象变化均不能改写目标。
  const details = detailSession
  const target = { type: selectedType.value, id: row.id, version: row.version, generation: pageGeneration }
  const key = `${target.type}/${target.id}`
  if (pendingRows.has(key)) return
  pendingRows.add(key)
  const action = restore ? '恢复' : '删除'
  const isCurrent = () => target.generation === pageGeneration && target.type === selectedType.value
  try {
    try {
      await ElMessageBox.confirm(`确认${action}「${target.type}」#${target.id}（v${target.version}）？${restore ? '' : '（软删，可恢复）'}`, `${action}数据`, {
        type: 'warning', confirmButtonText: action, cancelButtonText: '取消',
      })
    } catch { return }
    if (!isCurrent()) return
    try {
      if (restore) await restoreAlDataApi(target.type, target.id, target.version)
      else await deleteAlDataApi(target.type, target.id, target.version)
      if (!isCurrent()) return
      ElMessage.success(`#${target.id} 已${action}${restore ? '' : '（软删）'}`)
      await refresh(details)
    } catch (err: unknown) {
      if (!isCurrent()) return
      const resp = apiErrorBody(err)
      if (resp.code === 100008) {
        ElMessage.error(`${action}冲突：${resp.message ?? '该行已变更'}，请从刷新列表重新确认`)
        list.value = []
        await refresh(details)
      } else {
        ElMessage.error(resp.message ?? `${action}失败，请核对结果后重试`)
      }
    }
  } finally {
    pendingRows.delete(key)
  }
}
function onDelete(row: AlDataDoc) { return changeRowState(row, false) }
/** 恢复软删行：废弃类型仍放行，目标态幂等由服务端判断。 */
function onRestore(row: AlDataDoc) { return changeRowState(row, true) }

/** 行样式：软删行灰态（已删除徽标+恢复入口的数据面） */
function rowClass({ row }: { row: AlDataDoc }): string {
  return row.status === 'deleted' ? 'al-row-deleted' : 'al-data-row'
}

// ─── 导出/导入 ───
async function onExport() {
  const type = selectedType.value
  try {
    const blob = await exportAlDataApi(type)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${type}_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    ElMessage.error(resp?.message ?? '导出失败')
  }
}

const IMPORT_MAX_BYTES = 1024 * 1024
const importVisible = ref(false)
const importType = ref('')
const importText = ref('')
const importReading = ref(false)
const importBusy = ref(false)
const importError = ref('')
const importResult = ref('')
const replaceConfirmed = ref(false)
let importReadSeq = 0
const importPayload = computed(() => importText.value.trim())
const importFormatError = computed(() => {
  if (!importPayload.value) return ''
  if (new TextEncoder().encode(importPayload.value).length > IMPORT_MAX_BYTES) {
    return '导入内容超过 1 MiB'
  }
  try {
    if (Array.isArray(JSON.parse(importPayload.value))) return ''
  } catch {
    // 无效 JSON 与非数组同样不能确认。
  }
  return '导入内容须为有效的 JSON 数组'
})
const importReady = computed(() =>
  importVisible.value && importType.value === selectedType.value && !isDeprecated.value
  && !importReading.value && !importBusy.value && !!importPayload.value && !importFormatError.value,
)

function editImportText(value: string) {
  ++importReadSeq
  importReading.value = false
  importText.value = value
  importError.value = ''
  importResult.value = ''
  replaceConfirmed.value = false
}

function openImport() {
  if (importBusy.value || !selectedType.value || isDeprecated.value) return
  editImportText('')
  importType.value = selectedType.value
  importVisible.value = true
}

async function onImportFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || importBusy.value) return
  // 换文件先撤销上一份内容的确认。允许随后重选同一文件。
  input.value = ''
  editImportText('')
  if (file.size > IMPORT_MAX_BYTES) {
    importError.value = '文件超过 1 MiB'
    return
  }
  const readSeq = importReadSeq
  const isCurrentRead = () => readSeq === importReadSeq && importVisible.value
  importReading.value = true
  try {
    const contents = await file.text()
    if (isCurrentRead()) importText.value = contents
  } catch {
    if (isCurrentRead()) importError.value = '读取文件失败，请重新选择文件'
  } finally {
    if (isCurrentRead()) importReading.value = false
  }
}

async function submitImport() {
  if (!importReady.value || !replaceConfirmed.value) return
  const type = importType.value
  const payload = importPayload.value
  importBusy.value = true
  importError.value = ''
  importResult.value = ''
  replaceConfirmed.value = false
  try {
    const res = await importAlDataApi(type, payload)
    importResult.value = `已替换为 ${res.rows} 行（清除原有 ${res.deleted} 行）`
    ElMessage.warning(`导入为全量替换：已清除原有 ${res.deleted} 行`)
    if (selectedType.value === type) refresh()
  } catch (err: unknown) {
    importError.value = apiErrorBody(err).message ?? '未能确认导入结果，请核对数据后重试'
  } finally {
    importBusy.value = false
  }
}

// ─── 渲染辅助 ───
function cellText(f: AlFieldDef, row: AlDataDoc): string {
  const raw = row.data[f.name]
  if (raw === undefined || raw === null) return '—'
  if (Array.isArray(raw)) return raw.join('、')
  return String(raw)
}

function formatTime(iso?: string): string {
  if (!iso) return '—'
  return formatDateTime(iso)
}

// ─── 行详情抽屉（点行开——动态 schema 行的全字段视图；编辑/删除收进抽屉底部）───
const detailVisible = ref(false)
const detailRow = ref<AlDataDoc | null>(null)
let detailSession = 0
watch(detailVisible, (visible) => {
  if (!visible) ++detailSession
}, { flush: 'sync' })
function openDetail(row: AlDataDoc) {
  if (listLoading.value) return
  ++detailSession
  detailRow.value = row
  detailVisible.value = true
}

function invalidatePageTarget() {
  ++pageGeneration
  ++fetchSeq
  listLoading.value = false
  invalidateForm()
  formVisible.value = false
  detailVisible.value = false
  detailRow.value = null
}
watch(selectedType, invalidatePageTarget, { flush: 'sync' })
onActivated(() => {
  if (selectedType.value) void refresh()
})
onDeactivated(invalidatePageTarget)
onScopeDispose(invalidatePageTarget)

const dataTable = ref()
useTableFit(dataTable, () => list.value)
</script>

<template>
  <div class="fill-page p-4">
    <div class="flex flex-1 gap-4 min-h-0">
      <!-- 左：类型清单（分组+搜索；点击切换——取代下拉，类型全集与废弃态一眼可见） -->
      <el-card shadow="never" class="w-[240px] al-pane al-pane--left">
        <template #header>
          <span class="font-semibold">活动类型</span>
        </template>
        <el-input v-model="typeFilter" placeholder="搜索类型" clearable size="small" class="mb-2" />
        <div class="al-type-list">
          <template v-if="!typesQuery.isLoading.value && filteredTypes.length">
            <div
              class="al-type-group al-type-group--toggle"
              @click="activeOpen = !activeOpen"
            >
              <span>使用中（{{ activeFiltered.length }}）</span>
              <span class="al-type-chevron" :class="{ open: activeOpenEff }">▾</span>
            </div>
            <template v-if="activeOpenEff">
              <div
                v-for="t in activeFiltered" :key="t.type_name"
                class="al-type-item" :class="{ 'al-type-item--active': selectedType === t.type_name }"
                @click="selectedType = t.type_name"
              >
                <span class="al-type-name">{{ t.type_name }}</span>
                <span class="al-type-meta">{{ t.fields.length }} 字段</span>
              </div>
            </template>
            <template v-if="deprecatedFiltered.length">
              <div
                class="al-type-group al-type-group--toggle mt-2"
                @click="deprecatedOpen = !deprecatedOpen"
              >
                <span>已废弃（只读）</span>
                <span class="al-type-chevron" :class="{ open: deprecatedOpenEff }">▾</span>
              </div>
              <template v-if="deprecatedOpenEff">
                <div
                  v-for="t in deprecatedFiltered" :key="t.type_name"
                  class="al-type-item" :class="{ 'al-type-item--active': selectedType === t.type_name }"
                  :title="`${t.type_name}（已废弃，只读）`"
                  @click="selectedType = t.type_name"
                >
                  <span class="al-type-name">{{ t.type_name }}</span>
                  <el-tag size="small" type="info">废</el-tag>
                </div>
              </template>
            </template>
          </template>
          <div v-else-if="!typesQuery.isLoading.value" class="text-xs text-gray-400 px-1">无匹配类型</div>
        </div>
      </el-card>

      <!-- 右：所选类型的数据区（原单卡内容平移） -->
      <el-card shadow="never" class="flex-1 al-pane al-pane--right">
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">{{ selectedType || '活动数据' }}</span>
            <div v-if="selectedType">
              <!-- 废弃类型只读：写入/导入随 409 门同步隐藏；导出（存档）保留 -->
              <el-button v-if="!isDeprecated" v-permission="'activelist:data:write'" type="primary" size="small" @click="openCreate">写入</el-button>
              <el-button v-if="!isDeprecated" v-permission="'activelist:data:write'" size="small" @click="openImport">导入</el-button>
              <el-button size="small" @click="onExport">导出</el-button>
            </div>
          </div>
        </template>

        <!-- 空态引导：无类型 → 去注册；有类型未选 → 选择提示 -->
        <el-empty
          v-if="!typesQuery.isLoading.value && !allTypes.length"
          description="暂无活动类型——请先在「活动类型」页注册"
        >
          <el-button type="primary" @click="router.push('/al/types')">去注册类型</el-button>
        </el-empty>
        <el-empty v-else-if="!selectedType" description="从左侧选择一个类型以查看其数据" />


        <!-- 类型上下文头：schema 徽标一眼看懂列表形状（字段·类型·必填*） -->
        <div v-if="selectedDef" class="mb-3 flex flex-wrap items-center gap-2">
          <el-tag :type="isDeprecated ? 'info' : 'success'" size="small">
            {{ isDeprecated ? '已废弃' : '使用中' }}
          </el-tag>
          <span class="text-xs text-gray-400">v{{ selectedDef.version }} · 注册于 {{ formatTime(selectedDef.created_at) }}</span>
          <el-tag v-for="f in schema" :key="f.name" size="small" effect="plain">
            {{ f.name }} · {{ fieldTypeLabel(f.type) }}{{ f.required ? ' *' : '' }}
          </el-tag>
        </div>

        <el-alert
          v-if="isDeprecated"
          title="该类型已废弃：数据只读——可导出存档、删除行清理；写入/导入/编辑已关闭"
          type="warning" show-icon :closable="false" class="mb-3"
        />

        <!-- 搜索/筛选（2026-10-28）：关键字全标量字段模糊 + 单字段精确；变更即查 300ms 防抖 -->
        <div v-if="selectedType" class="flex flex-wrap items-center gap-4 mb-3">
          <el-input
            v-model="filt.q" placeholder="关键字（全字段模糊）" class="!w-[220px]" clearable
            data-testid="al-data-q" @input="scheduleFiltFetch"
          />
          <el-select
            v-model="filt.field" placeholder="筛选字段" clearable class="!w-[140px]"
            data-testid="al-data-field" @change="scheduleFiltFetch"
          >
            <el-option v-for="n in scalarFieldNames" :key="n" :label="n" :value="n" />
          </el-select>
          <el-input
            v-model="filt.value" placeholder="字段值（精确）" class="!w-[160px]" clearable
            :disabled="!filt.field" data-testid="al-data-value" @input="scheduleFiltFetch"
          />
          <el-button size="small" @click="resetFilt">重置</el-button>
        </div>

        <el-empty v-if="selectedType && !listLoading && !list.length" description="暂无数据">
          <el-button v-if="!isDeprecated" v-permission="'activelist:data:write'" type="primary" @click="openCreate">写入首条</el-button>
        </el-empty>
        <template v-else-if="selectedType">
          <!-- min-h-0 flex-1 + height 100%：表格吃满剩余视口内部滚动（fill 链，与 ProTable 同款） -->
          <div class="min-h-0 flex-initial">
            <el-table ref="dataTable" :data="list" v-loading="listLoading" row-key="id" :row-class-name="rowClass" height="100%" @row-click="openDetail">
            <el-table-column prop="id" label="ID" width="90" />
            <!-- 状态列已移除（2026-10-28 走查）：软删行由整行灰态+操作列「恢复」承载，
                 活跃行整列横线是纯噪音 -->
            <!-- 动态列：schema 驱动（sensitive 原样显示——脱敏属日志侧语义） -->
            <el-table-column
              v-for="f in schema" :key="f.name" :label="f.name" :min-width="140" show-overflow-tooltip
            >
              <template #default="{ row }">{{ cellText(f, row as AlDataDoc) }}</template>
            </el-table-column>
            <el-table-column prop="version" label="v" width="60" align="center" />
            <el-table-column label="更新时间" width="170">
              <template #default="{ row }">{{ formatTime((row as AlDataDoc).updated_at) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="160" fixed="right">
              <template #default="{ row }">
                <!-- .stop：行点击开详情抽屉，按钮动作不冒泡 -->
                <template v-if="(row as AlDataDoc).status === 'deleted'">
                  <el-button v-permission="'activelist:data:write'" link type="primary" size="small" @click.stop="onRestore(row as AlDataDoc)">恢复</el-button>
                </template>
                <template v-else>
                  <el-button v-if="!isDeprecated" v-permission="'activelist:data:write'" link type="primary" size="small" @click.stop="openEdit(row as AlDataDoc)">编辑</el-button>
                  <el-button v-permission="'activelist:data:write'" link type="danger" size="small" @click.stop="onDelete(row as AlDataDoc)">删除</el-button>
                </template>
              </template>
            </el-table-column>
          </el-table>
          </div>

        <!-- cursor 分页（无 total——「第 N 页」由页栈派生；空页 next_cursor=null=遍历终止） -->
        <div class="flex items-center justify-between mt-3">
          <span class="text-xs text-gray-400">第 {{ page }} 页 · 每页 {{ pageSize }} 条（无总数统计）</span>
          <div>
            <el-button size="small" :disabled="page <= 1 || listLoading" @click="goPrev">上一页</el-button>
            <el-button size="small" :disabled="!nextCursor || listLoading" @click="goNext">下一页</el-button>
          </div>
        </div>
        </template>
      </el-card>
    </div>

    <!-- 写入/编辑（schema 驱动表单——四类型） -->
    <el-dialog :close-on-click-modal="false" v-model="formVisible" :title="formIsCreate ? `写入「${selectedType}」` : `编辑 #${editing.id}`" width="560px">
      <el-alert v-if="formError" :title="formError" type="error" show-icon class="mb-4" :closable="false" />
      <div v-if="!formIsCreate" class="text-xs text-gray-400 mb-2">编辑版本 v{{ editing.version }}</div>
      <el-form label-width="120px" class="max-h-[60vh] overflow-y-auto">
        <el-form-item v-for="f in schema" :key="f.name" :label="f.name" :required="f.required">
          <el-input-number v-if="f.type === 'int'" v-model="(formData[f.name] as number | undefined)" :controls="false" class="!w-48" />
          <el-input
            v-else-if="f.type === 'string'" v-model="(formData[f.name] as string | undefined)"
            :maxlength="f.max_chars || 255" show-word-limit clearable
          />
          <div v-else-if="!formIsCreate && f.type === 'string_list'" class="w-full">
            <div class="text-xs text-gray-400 mb-1">每个输入框为一项，保留空白、换行与分隔符；空框也算一项。</div>
            <div v-for="(_, index) in listItems(f)" :key="index" class="flex items-start gap-2 mb-2">
              <el-input
                v-model="(formData[f.name] as string[])[index]" type="textarea" :rows="2"
                :aria-label="`${f.name} 第 ${index + 1} 项`"
              />
              <el-button :aria-label="`删除 ${f.name} 第 ${index + 1} 项`" @click="(formData[f.name] as string[]).splice(index, 1)">删除项</el-button>
            </div>
            <div class="flex items-center gap-2">
              <span
                class="text-xs"
                :class="listItems(f).length > (f.max_list_items || 100) ? 'text-red-500' : 'text-gray-400'"
              >共 {{ listItems(f).length }} 项 / 上限 {{ f.max_list_items || 100 }}</span>
              <el-button :disabled="listItems(f).length >= (f.max_list_items || 100)" @click="addTextItem(f.name)">添加项</el-button>
            </div>
          </div>
          <template v-else>
            <el-input
              v-model="listText[f.name]" type="textarea" :rows="3" clearable
              :placeholder="f.type === 'int_list' ? '每行一个整数，逗号分隔亦可' : '每行一项，逗号/分号分隔亦可'"
            />
            <div v-if="(listText[f.name] ?? '').trim()" class="flex items-center gap-2 mt-1">
              <span
                class="text-xs"
                :class="parseListLines(listText[f.name]).length > (f.max_list_items || 100) ? 'text-red-500' : 'text-gray-400'"
              >共 {{ parseListLines(listText[f.name]).length }} 项 / 上限 {{ f.max_list_items || 100 }}</span>
              <el-button link type="primary" size="small" @click="dedupList(f.name)">去重</el-button>
            </div>
          </template>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="formSaving" :disabled="formConflict" @click="submitForm">{{ formIsCreate ? '写入' : '更新' }}</el-button>
      </template>
    </el-dialog>

    <!-- 导入（JSON 数组；网关上限 1 MiB） -->
    <el-dialog
      v-model="importVisible"
      :close-on-click-modal="false"
      :close-on-press-escape="!importBusy"
      :show-close="!importBusy"
      destroy-on-close
      title="导入数据（全量替换）"
      width="560px"
    >
      <el-alert
        title="导入为全量替换：将先清除该类型全部数据（含已删除行），再写入文件内容，不可撤销"
        type="warning" show-icon :closable="false" class="mb-4"
      />
      <el-alert v-if="importError || importFormatError" :title="importError || importFormatError" type="error" show-icon class="mb-4" :closable="false" />
      <el-alert v-if="importResult" :title="importResult" type="success" show-icon class="mb-4" :closable="false" />
      <input type="file" accept=".json,application/json" class="mb-3" :disabled="importBusy" @change="onImportFile">
      <span v-if="importReading" class="ml-2 text-sm" role="status">正在读取文件…</span>
      <el-input
        :model-value="importText" type="textarea" :rows="8" :disabled="importBusy"
        placeholder='[{"id":"1","status":"active","data":{"name":"示例"}}]'
        @update:model-value="editImportText"
      />
      <div class="text-xs text-gray-400 mt-2">可粘贴 JSON 数组或选择文件。每行须包含正整数 ID 字符串，浏览器导入上限 1 MiB。导入空数组会清空数据。</div>
      <el-checkbox v-model="replaceConfirmed" class="mt-2" :disabled="!importReady">
        我已知晓导入会<span class="text-red-500 font-bold">清除「{{ importType }}」全部现有数据（含已删除行）</span>
      </el-checkbox>
      <template #footer>
        <el-button :disabled="importBusy || importType !== selectedType" @click="onExport">导出当前数据</el-button>
        <el-button :disabled="importBusy" @click="importVisible = false">关闭</el-button>
        <el-button type="danger" :loading="importBusy" :disabled="!importReady || !replaceConfirmed" @click="submitImport">导入（替换）</el-button>
      </template>
    </el-dialog>

    <!-- 行详情抽屉：动态 schema 全字段 + 系统字段；编辑/删除收进底部（废弃类型随只读隐藏编辑） -->
    <el-drawer v-model="detailVisible" :title="detailRow ? `数据详情 #${detailRow.id}` : '数据详情'" size="560px">
      <el-descriptions v-if="detailRow" :column="1" border size="small">
        <el-descriptions-item v-for="f in schema" :key="f.name" :label="f.name">
          {{ cellText(f, detailRow as AlDataDoc) }}
        </el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag v-if="detailRow.status === 'deleted'" size="small" type="info">已删除</el-tag>
          <template v-else>正常</template>
        </el-descriptions-item>
        <el-descriptions-item label="版本">v{{ detailRow.version }}</el-descriptions-item>
        <el-descriptions-item label="创建人">{{ detailRow.created_by }}</el-descriptions-item>
        <el-descriptions-item label="更新人">{{ detailRow.updated_by }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ formatTime(detailRow.created_at) }}</el-descriptions-item>
        <el-descriptions-item label="更新时间">{{ formatTime(detailRow.updated_at) }}</el-descriptions-item>
      </el-descriptions>
      <template v-if="detailRow" #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <template v-if="detailRow.status === 'deleted'">
          <el-button v-permission="'activelist:data:write'" type="primary" @click="detailVisible = false; onRestore(detailRow as AlDataDoc)">恢复</el-button>
        </template>
        <template v-else>
          <el-button
            v-if="!isDeprecated" v-permission="'activelist:data:write'"
            type="primary" @click="detailVisible = false; openEdit(detailRow as AlDataDoc)"
          >编辑</el-button>
          <el-button v-permission="'activelist:data:write'" type="danger" @click="detailVisible = false; onDelete(detailRow as AlDataDoc)">删除</el-button>
        </template>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
/* 行可点开详情抽屉；软删行灰态 */
:deep(.al-data-row) {
  cursor: pointer;
}
:deep(.al-row-deleted) {
  cursor: pointer;
  opacity: 0.55;
}

/* 双栏骨架（dict-pane 同款）：两卡各自弹性列、卡体弹性化、内滚 */
.al-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.al-pane--left {
  flex: none;
}
.al-pane--right {
  flex: 1;
}
.al-pane :deep(.el-card__body) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

/* 左栏类型清单：分组标题/清单项（点选切换）/选中态/元信息 */
.al-type-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.al-type-group {
  padding: 2px 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.al-type-group--toggle {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.al-type-group--toggle:hover {
  background: var(--el-fill-color-light);
}
.al-type-chevron {
  transition: transform 160ms ease;
  color: var(--el-text-color-secondary);
}
.al-type-chevron.open {
  transform: rotate(180deg);
}
.al-type-item {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
.al-type-item:hover {
  background: var(--el-fill-color-light);
}
.al-type-item--active,
.al-type-item--active:hover {
  background: var(--el-color-primary-light-9);
}
.al-type-item--active .al-type-name {
  color: var(--el-color-primary);
  font-weight: 600;
}
.al-type-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.al-type-meta {
  flex: none;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>

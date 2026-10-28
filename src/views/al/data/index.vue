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
import { computed, reactive, ref, watch } from 'vue'
import { useTableFit } from '@vea/hooks'
import {
  ElAlert, ElButton, ElCard, ElDescriptions, ElDescriptionsItem, ElDialog, ElDrawer,
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

function refresh() {
  // 刷新回首页（cursor 可能因写入漂移——保守重置）
  resetCursor(cursorStack.value)
  fetchPage(null)
}

// ─── 新增/编辑（schema 驱动表单）───
const formVisible = ref(false)
const formIsCreate = ref(true)
const formSaving = ref(false)
const formError = ref('')
/** 编辑态隐藏携带：行 id+version 乐观锁 */
const editing = reactive({ id: '', version: 0 })
/** 表单值：list 类字段编辑态用换行文本，提交时拆分 */
const formData = ref<Record<string, unknown>>({})
const listText = ref<Record<string, string>>({})

function toFormFieldValue(f: AlFieldDef, doc?: AlDataDoc): { value: unknown; text: string } {
  if (!doc) return { value: f.type === 'int' ? undefined : '', text: '' }
  const raw = doc.data[f.name]
  if (f.type === 'int_list' || f.type === 'string_list') {
    return { value: raw, text: Array.isArray(raw) ? raw.join('\n') : String(raw ?? '') }
  }
  return { value: raw, text: '' }
}

function openCreate() {
  formIsCreate.value = true
  formError.value = ''
  formData.value = {}
  listText.value = {}
  for (const f of schema.value) {
    const { value, text } = toFormFieldValue(f)
    formData.value[f.name] = value
    listText.value[f.name] = text
  }
  formVisible.value = true
}

function openEdit(row: AlDataDoc) {
  formIsCreate.value = false
  formError.value = ''
  editing.id = row.id
  editing.version = row.version
  formData.value = {}
  listText.value = {}
  for (const f of schema.value) {
    const { value, text } = toFormFieldValue(f, row)
    formData.value[f.name] = value
    listText.value[f.name] = text
  }
  formVisible.value = true
}

/** 列表文本 → 项数组（容积分隔：换行/逗号/分号中英文皆可——Excel 列粘贴与
 *  逗号串直接可用；trim + 剔空。校验与提交共用此解析，无第二份分隔语义） */
function parseListLines(text: string | undefined): string[] {
  return (text ?? '').split(/[\n,，;；]+/).map((s) => s.trim()).filter(Boolean)
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

/** 表单值 → 提交 body（list 文本经 parseListLines 拆分；int_list 转 number[]） */
function buildDataBody(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of schema.value) {
    if (f.type === 'int_list' || f.type === 'string_list') {
      const lines = parseListLines(listText.value[f.name])
      out[f.name] = f.type === 'int_list' ? lines.map(Number) : lines
    } else {
      const v = formData.value[f.name]
      if (v !== undefined && v !== '') out[f.name] = v
    }
  }
  return out
}

async function submitForm() {
  // required + 长度手检（动态 prop 校验在此场景过重——四类型封闭手检即可；
  // 长度上限与后端 checkValue 同源语义：字符数非字节，0/缺省=255——2026-10-27 拍板）
  for (const f of schema.value) {
    if (f.required) {
      if (f.type === 'int_list' || f.type === 'string_list') {
        if (!parseListLines(listText.value[f.name]).length) {
          formError.value = `「${f.name}」为必填`
          return
        }
      } else if (formData.value[f.name] === undefined || formData.value[f.name] === '') {
        formError.value = `「${f.name}」为必填`
        return
      }
    }
    if (f.type === 'int_list' || f.type === 'string_list') {
      const items = parseListLines(listText.value[f.name])
      const itemLimit = f.max_list_items || 100
      if (items.length > itemLimit) {
        formError.value = `「${f.name}」共 ${items.length} 项，超上限 ${itemLimit}`
        return
      }
    }
    if (f.type === 'string_list') {
      const limit = f.max_chars || 255
      const lines = parseListLines(listText.value[f.name])
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
    const body = buildDataBody()
    if (formIsCreate.value) {
      await createAlDataApi(selectedType.value, body)
      ElMessage.success('已写入')
    } else {
      await updateAlDataApi(selectedType.value, editing.id, { data: body, version: editing.version })
      ElMessage.success('已更新')
    }
    formVisible.value = false
    refresh()
  } catch (err: unknown) {
    const resp = apiErrorBody(err)
    // 100008(CONFLICT) 双语义分档：版本冲突仅存在于更新路径（插入无乐观锁）；
    // 插入态透传后端原文（唯一键冲突等——否则被误标成「版本冲突」）
    if (!formIsCreate.value && resp?.code === 100008) {
      formError.value = '版本冲突：该行已被他人变更，关闭后重开编辑（乐观锁）'
    } else {
      formError.value = resp?.message ?? '保存失败，请稍后重试'
    }
  } finally {
    formSaving.value = false
  }
}

// ─── 删除/恢复（软删）───
async function onDelete(row: AlDataDoc) {
  try {
    await ElMessageBox.confirm(`确认删除 #${row.id}？（软删，可恢复）`, '删除数据', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消',
    })
  } catch { return }
  try {
    await deleteAlDataApi(selectedType.value, row.id)
    ElMessage.success(`#${row.id} 已删除（软删）`)
    refresh()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    ElMessage.error(resp?.message ?? '删除失败')
  }
}

/** 恢复软删行（幂等；废弃类型下仍放行——gateType 对存量生命周期操作放行） */
async function onRestore(row: AlDataDoc) {
  try {
    await restoreAlDataApi(selectedType.value, row.id)
    ElMessage.success(`#${row.id} 已恢复`)
    refresh()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    ElMessage.error(resp?.message ?? '恢复失败')
  }
}

/** 行样式：软删行灰态（已删除徽标+恢复入口的数据面） */
function rowClass({ row }: { row: AlDataDoc }): string {
  return row.status === 'deleted' ? 'al-row-deleted' : 'al-data-row'
}

// ─── 导出/导入 ───
async function onExport() {
  try {
    const blob = await exportAlDataApi(selectedType.value)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selectedType.value}_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    ElMessage.error(resp?.message ?? '导出失败')
  }
}

const importVisible = ref(false)
const importText = ref('')
const importBusy = ref(false)
const importError = ref('')
const importResult = ref('')

function openImport() {
  importText.value = ''
  importError.value = ''
  importResult.value = ''
  importVisible.value = true
}

async function onImportFile(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (file.size > 1024 * 1024) {
    importError.value = '文件超过 1MB（网关实际上限——非 activelist 自身）'
    return
  }
  importText.value = await file.text()
}

async function submitImport() {
  if (!importText.value.trim()) {
    importError.value = '请选择文件或粘贴 JSON 数组'
    return
  }
  importBusy.value = true
  importError.value = ''
  try {
    const res = await importAlDataApi(selectedType.value, importText.value)
    importResult.value = `导入完成：新增 ${res.inserted ?? '?'} 行${res.skipped ? `，跳过 ${res.skipped} 行` : ''}`
    refresh()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    importError.value = resp?.message ?? '导入失败，请检查 JSON 格式'
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
function openDetail(row: AlDataDoc) {
  detailRow.value = row
  detailVisible.value = true
}

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

        <el-empty v-if="!listLoading && !list.length" description="暂无数据">
          <el-button v-if="!isDeprecated" v-permission="'activelist:data:write'" type="primary" @click="openCreate">写入首条</el-button>
        </el-empty>
        <template v-else>
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
    <el-dialog v-model="formVisible" :title="formIsCreate ? `写入「${selectedType}」` : `编辑 #${editing.id}`" width="560px">
      <el-alert v-if="formError" :title="formError" type="error" show-icon class="mb-4" :closable="false" />
      <el-form label-width="120px">
        <el-form-item v-for="f in schema" :key="f.name" :label="f.name" :required="f.required">
          <el-input-number v-if="f.type === 'int'" v-model="(formData[f.name] as number | undefined)" class="!w-48" />
          <el-input
            v-else-if="f.type === 'string'" v-model="(formData[f.name] as string | undefined)"
            :maxlength="f.max_chars || 255" show-word-limit clearable
          />
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
        <el-button type="primary" :loading="formSaving" @click="submitForm">{{ formIsCreate ? '写入' : '更新' }}</el-button>
      </template>
    </el-dialog>

    <!-- 导入（JSON 数组与导出对称；网关上限 1MB） -->
    <el-dialog v-model="importVisible" title="导入数据" width="560px">
      <el-alert v-if="importError" :title="importError" type="error" show-icon class="mb-4" :closable="false" />
      <el-alert v-if="importResult" :title="importResult" type="success" show-icon class="mb-4" :closable="false" />
      <input type="file" accept=".json,application/json" class="mb-3" @change="onImportFile">
      <el-input
        v-model="importText" type="textarea" :rows="8"
        placeholder='或直接粘贴 JSON 数组（与导出格式对称）：[{"data":{...}},...]'
      />
      <div class="text-xs text-gray-400 mt-2">网关实际上限 1MB；格式校验失败整批不入（同事务）</div>
      <template #footer>
        <el-button @click="importVisible = false">关闭</el-button>
        <el-button type="primary" :loading="importBusy" @click="submitImport">导入</el-button>
      </template>
    </el-dialog>

    <!-- 行详情抽屉：动态 schema 全字段 + 系统字段；编辑/删除收进底部（废弃类型随只读隐藏编辑） -->
    <el-drawer v-model="detailVisible" :title="detailRow ? `数据详情 #${detailRow.id}` : '数据详情'" size="440px">
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

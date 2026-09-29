<script setup lang="ts">
/**
 * 名单数据（P4-W5——al_data 菜单页，activelist:data:read 可见/写操作挂 data:write）
 *
 * - 列由所选类型的 schema 驱动（字段四类型：int/string/int_list/string_list）——
 *   动态列表格+动态表单，sensitive 字段原样显示（脱敏属日志侧语义）
 * - cursor 分页（无 total——十三批「无 total 形态」）：页栈管理见 ./cursorPager（单测防漂移）
 * - 导出=blob 下载（裸 JSON 数组流）；导入=同格式文件直发 body（网关上限 1MB 前端预检）
 * - 编辑带 version 乐观锁（冲突 409+100008——activelist 跨服务码段）
 */
import { computed, reactive, ref, watch } from 'vue'
import {
  ElAlert, ElButton, ElCard, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber,
  ElMessage, ElMessageBox, ElOption, ElSelect, ElTable, ElTableColumn,
} from 'element-plus'
import { useQuery } from '@tanstack/vue-query'
import {
  createAlDataApi, deleteAlDataApi, exportAlDataApi, importAlDataApi, listAlDataApi,
  listAlTypesApi, updateAlDataApi,
  type AlCursor, type AlDataDoc, type AlFieldDef,
} from '@/api/al'
import { popCursor, pushCursor, resetCursor } from './cursorPager'

// keep-alive 契约：name=动态路由名（菜单 code al_data，组件路径 al/data/index）
defineOptions({ name: 'al_data' })

// ─── 类型选择（schema 驱动列）───
const typesQuery = useQuery({ queryKey: ['al', 'types'], queryFn: listAlTypesApi })
const activeTypes = computed(() => (typesQuery.data.value?.list ?? []).filter((t) => t.status === 'active'))
const selectedType = ref('')
const schema = computed<AlFieldDef[]>(
  () => activeTypes.value.find((t) => t.type_name === selectedType.value)?.fields ?? [],
)

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

watch(selectedType, () => {
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

/** 表单值 → 提交 body（list 文本按行拆分；int_list 转 number[]） */
function buildDataBody(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of schema.value) {
    if (f.type === 'int_list' || f.type === 'string_list') {
      const lines = (listText.value[f.name] ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
      out[f.name] = f.type === 'int_list' ? lines.map(Number) : lines
    } else {
      const v = formData.value[f.name]
      if (v !== undefined && v !== '') out[f.name] = v
    }
  }
  return out
}

async function submitForm() {
  // required 手检（动态 prop 校验在此场景过重——四类型封闭手检即可）
  for (const f of schema.value) {
    if (!f.required) continue
    if (f.type === 'int_list' || f.type === 'string_list') {
      if (!(listText.value[f.name] ?? '').trim()) {
        formError.value = `「${f.name}」为必填`
        return
      }
    } else if (formData.value[f.name] === undefined || formData.value[f.name] === '') {
      formError.value = `「${f.name}」为必填`
      return
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
    const resp = (err as { response?: { data?: { code?: number; message?: string } } })?.response?.data
    if (resp?.code === 100008) {
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
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <div class="p-4">
    <el-card shadow="never">
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <span class="font-semibold">名单数据</span>
            <el-select
              v-model="selectedType" filterable placeholder="选择类型" class="!w-56"
              :loading="typesQuery.isLoading.value"
            >
              <el-option v-for="t in activeTypes" :key="t.type_name" :label="t.type_name" :value="t.type_name" />
            </el-select>
          </div>
          <div v-if="selectedType">
            <el-button v-permission="'activelist:data:write'" type="primary" @click="openCreate">写入</el-button>
            <el-button v-permission="'activelist:data:write'" @click="openImport">导入</el-button>
            <el-button @click="onExport">导出</el-button>
          </div>
        </div>
      </template>

      <el-alert
        v-if="!typesQuery.isLoading.value && !activeTypes.length"
        title="暂无使用中的名单类型——请先在「名单类型」页注册"
        type="info" show-icon :closable="false" class="mb-3"
      />

      <template v-if="selectedType">
        <el-table :data="list" v-loading="listLoading" row-key="id">
          <el-table-column prop="id" label="ID" width="90" />
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
              <el-button v-permission="'activelist:data:write'" link type="primary" size="small" @click="openEdit(row as AlDataDoc)">编辑</el-button>
              <el-button v-permission="'activelist:data:write'" link type="danger" size="small" @click="onDelete(row as AlDataDoc)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>

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

    <!-- 写入/编辑（schema 驱动表单——四类型） -->
    <el-dialog v-model="formVisible" :title="formIsCreate ? `写入「${selectedType}」` : `编辑 #${editing.id}`" width="560px">
      <el-alert v-if="formError" :title="formError" type="error" show-icon class="mb-4" :closable="false" />
      <el-form label-width="120px">
        <el-form-item v-for="f in schema" :key="f.name" :label="f.name" :required="f.required">
          <el-input-number v-if="f.type === 'int'" v-model="(formData[f.name] as number | undefined)" class="!w-48" />
          <el-input v-else-if="f.type === 'string'" v-model="(formData[f.name] as string | undefined)" />
          <el-input
            v-else v-model="listText[f.name]" type="textarea" :rows="3"
            :placeholder="f.type === 'int_list' ? '每行一个整数' : '每行一项'"
          />
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
  </div>
</template>

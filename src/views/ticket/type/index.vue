<script setup lang="ts">
/**
 * 类型配置三件套（P4-W4 S12——类型/字段/模板管理，FE2「管理全流程无 SQL」收口件）
 *
 * - 菜单内页（ticket_type_manage，route:/tickets/types）——admin 专属（B 案：页面=4 共享
 *   GET、7 写端点挂 ticket_type_write_btn 同码 ticket:type:manage，000031 词表重排）
 * - 字段编辑=**全量替换语义**（POST /ticket-types/fields/replace）——保存前危险确认弹窗
 *   （S12/S23 硬要求）；field_options 归一为字符串数组（后端 optionValues 双形态兼容）
 * - states/transitions=JSON 源码模式（02 §5 深水区策略兜底形态；form-create 设计器决策
 *   顺延）；⚠ 编辑框注记：状态图可配但用户实际可点动作仅 分派/取消/关闭/更新/删除——
 *   三态经 API 不可达（03 S11），防管理员以为画了就能点
 * - 乐观锁：类型/模板 version 回传 CAS（可省略——管理页应带上），10006 → 关框刷新范式
 */
import { computed, reactive, ref } from 'vue'
import {
  ElAlert, ElButton, ElCard, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber,
  ElMessage, ElMessageBox, ElOption, ElSelect, ElSwitch, ElTable, ElTableColumn, ElTabPane, ElTabs, ElTag,
} from 'element-plus'
import type { FormInstance } from 'element-plus'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  createTicketTemplateApi, createTicketTypeApi, deleteTicketTemplateApi, deleteTicketTypeApi,
  getTicketTypeFieldsApi, listTicketTemplatesApi, listTicketTypesApi,
  replaceTicketTypeFieldsApi, updateTicketTemplateApi, updateTicketTypeApi,
  type TicketTypeFieldDef, type TicketTypeFieldInput, type TicketTypeFullRow,
  type TicketTemplateRow,
} from '@/api/ticket'
import { getOrgTreeApi, type OrgTreeNode } from '@/api/system/org'

// keep-alive 契约：name=动态路由名（菜单 code ticket_type_manage）
defineOptions({ name: 'ticket_type_manage' })

const queryClient = useQueryClient()
const FIELD_TYPES: Array<{ value: TicketTypeFieldInput['field_type']; label: string }> = [
  { value: 'input', label: '单行文本' },
  { value: 'textarea', label: '多行文本' },
  { value: 'number', label: '数字' },
  { value: 'date', label: '日期' },
  { value: 'select', label: '下拉（单选）' },
  { value: 'multi_select', label: '下拉（多选）' },
  { value: 'tips', label: '说明块' },
]

// ─── 类型 Tab ───
import { useTableFit } from '@vea/hooks'
const typesQuery = useQuery({ queryKey: ['ticket', 'types'], queryFn: listTicketTypesApi })
const typeColumns = [
  { prop: 'code', label: '编码', width: 160 },
  { prop: 'name', label: '名称', minWidth: 140 },
  { prop: 'description', label: '描述', minWidth: 160 },
  { prop: 'default_sla_hours', label: 'SLA(h)', width: 80, align: 'center' as const },
  { prop: 'has_custom_fields', label: '自定义字段', width: 100, align: 'center' as const },
  { prop: 'is_active', label: '启用', width: 80, align: 'center' as const },
  { prop: 'version', label: '版本', width: 70, align: 'center' as const },
]

const typeDialog = reactive({ visible: false, isCreate: true, loading: false, error: '' })
const typeFormRef = ref<FormInstance>()
const typeForm = reactive({
  code: '', name: '', description: '', is_active: true,
  statesText: '', transitionsText: '', version: 0,
})

function openTypeCreate() {
  Object.assign(typeDialog, { visible: true, isCreate: true, loading: false, error: '' })
  Object.assign(typeForm, { code: '', name: '', description: '', is_active: true, statesText: '', transitionsText: '', version: 0 })
}

function openTypeEdit(row: TicketTypeFullRow) {
  Object.assign(typeDialog, { visible: true, isCreate: false, loading: false, error: '' })
  Object.assign(typeForm, {
    code: row.code, name: row.name, description: row.description, is_active: row.is_active,
    statesText: row.states ? JSON.stringify(row.states, null, 0) : '',
    transitionsText: row.transitions ? JSON.stringify(row.transitions, null, 0) : '',
    version: row.version,
  })
}

/** JSON 源码模式校验（空=不传，后端缺省 6 态默认图） */
function parseJsonText(text: string): { ok: true; value?: unknown } | { ok: false } {
  if (!text.trim()) return { ok: true }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

async function submitType() {
  const valid = await typeFormRef.value?.validate().catch(() => false)
  if (!valid) return
  const states = parseJsonText(typeForm.statesText)
  const transitions = parseJsonText(typeForm.transitionsText)
  if (!states.ok || !transitions.ok) {
    typeDialog.error = 'states/transitions 须为合法 JSON'
    return
  }
  typeDialog.loading = true
  typeDialog.error = ''
  try {
    if (typeDialog.isCreate) {
      await createTicketTypeApi({
        code: typeForm.code, name: typeForm.name,
        description: typeForm.description || undefined,
        is_active: typeForm.is_active,
      })
      ElMessage.success('类型已创建')
    } else {
      await updateTicketTypeApi({
        code: typeForm.code, name: typeForm.name,
        description: typeForm.description || undefined,
        states: states.value, transitions: transitions.value,
        is_active: typeForm.is_active, version: typeForm.version, // 乐观锁回传
      })
      ElMessage.success('类型已更新')
    }
    typeDialog.visible = false
    await queryClient.invalidateQueries({ queryKey: ['ticket', 'types'] })
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { code?: number; message?: string } } })?.response?.data
    if (resp?.code === 10006) {
      typeDialog.visible = false
      ElMessage.warning('该类型已被他人修改，请刷新后重试')
      await queryClient.invalidateQueries({ queryKey: ['ticket', 'types'] })
    } else {
      typeDialog.error = resp?.message ?? '保存失败，请稍后重试'
    }
  } finally {
    typeDialog.loading = false
  }
}

async function onDeleteType(row: TicketTypeFullRow) {
  try {
    await ElMessageBox.confirm(`确认删除类型「${row.name}」？已有工单的类型将被拒绝删除。`, '危险操作', {
      type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger',
    })
  } catch {
    return
  }
  try {
    await deleteTicketTypeApi(row.code)
    ElMessage.success('已删除')
    await queryClient.invalidateQueries({ queryKey: ['ticket', 'types'] })
  } catch (err: unknown) {
    ElMessage.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '删除失败')
  }
}

// ─── 字段编辑器（全量替换——危险确认）───
interface FieldDraft {
  field_key: string
  field_label: string
  field_type: TicketTypeFieldInput['field_type']
  optionsText: string
  required: boolean
  validate_regex: string
  sort_order: number
}

const fieldsDialog = reactive({ visible: false, loading: false, saving: false, error: '', code: '', name: '', version: 0 })
const fieldRows = ref<FieldDraft[]>([])

function draftOf(f: TicketTypeFieldDef): FieldDraft {
  // field_options 双形态归一展示：字符串数组直取；{value,label} 数组取 label（回传时
  // 统一产字符串数组——后端 optionValues 两形态都收，展示以 label 为准）
  const raw = f.field_options
  let optionsText = ''
  if (Array.isArray(raw)) {
    optionsText = raw
      .map((o) => (typeof o === 'object' && o !== null ? String((o as Record<string, unknown>).label ?? (o as Record<string, unknown>).value) : String(o)))
      .join(',')
  }
  return {
    field_key: f.field_key, field_label: f.field_label, field_type: f.field_type,
    optionsText, required: f.required, validate_regex: f.validate_regex ?? '', sort_order: f.sort_order,
  }
}

async function openFields(row: TicketTypeFullRow) {
  Object.assign(fieldsDialog, { visible: true, loading: true, error: '', code: row.code, name: row.name, version: row.version })
  try {
    const fields = await getTicketTypeFieldsApi(row.code)
    fieldRows.value = fields.map(draftOf)
  } catch {
    fieldsDialog.error = '字段加载失败，请关闭后重试'
  } finally {
    fieldsDialog.loading = false
  }
}

function addFieldRow() {
  const nextSort = fieldRows.value.reduce((m, r) => Math.max(m, r.sort_order), 0) + 1
  fieldRows.value.push({ field_key: '', field_label: '', field_type: 'input', optionsText: '', required: false, validate_regex: '', sort_order: nextSort })
}

function removeFieldRow(idx: number) {
  fieldRows.value.splice(idx, 1)
}

const fieldHasOptions = (t: TicketTypeFieldInput['field_type']) => t === 'select' || t === 'multi_select'

async function saveFields() {
  const fields: TicketTypeFieldInput[] = []
  for (const [i, r] of fieldRows.value.entries()) {
    if (!r.field_key.trim() || !r.field_label.trim()) {
      fieldsDialog.error = `第 ${i + 1} 行的 field_key/label 不能为空`
      return
    }
    if (fieldHasOptions(r.field_type) && !r.optionsText.trim()) {
      fieldsDialog.error = `第 ${i + 1} 行（${r.field_label}）为选项类型，须填选项（逗号分隔）`
      return
    }
    fields.push({
      field_key: r.field_key.trim(), field_label: r.field_label.trim(), field_type: r.field_type,
      ...(fieldHasOptions(r.field_type) ? { field_options: r.optionsText.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
      required: r.required,
      ...(r.validate_regex.trim() ? { validate_regex: r.validate_regex.trim() } : {}),
      sort_order: r.sort_order,
    })
  }
  // S12/S23 硬要求：全量替换语义——保存前危险确认（存量字段将被整组覆盖）
  try {
    await ElMessageBox.confirm(
      `字段保存为「全量替换」：类型「${fieldsDialog.name}」的字段组将被以下 ${fields.length} 行整体覆盖（含删除未列出的字段）。确认？`,
      '危险操作', { type: 'warning', confirmButtonText: '整体替换', confirmButtonClass: 'el-button--danger' },
    )
  } catch {
    return
  }
  fieldsDialog.saving = true
  fieldsDialog.error = ''
  try {
    const saved = await replaceTicketTypeFieldsApi({ code: fieldsDialog.code, fields, version: fieldsDialog.version })
    fieldRows.value = saved.map(draftOf)
    ElMessage.success('字段已替换')
    fieldsDialog.visible = false
    await queryClient.invalidateQueries({ queryKey: ['ticket', 'types'] })
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { code?: number; message?: string } } })?.response?.data
    fieldsDialog.error = resp?.code === 10006 ? '类型已被他人修改（版本冲突），请关闭后重开再改' : resp?.message ?? '保存失败'
  } finally {
    fieldsDialog.saving = false
  }
}

// ─── 模板 Tab ───
const templatesQuery = useQuery({ queryKey: ['ticket', 'templates'], queryFn: listTicketTemplatesApi })

const orgOptions = computed(() => {
  const flat: Array<{ value: string; label: string }> = []
  const walk = (nodes: OrgTreeNode[] | undefined) => {
    for (const n of nodes ?? []) {
      flat.push({ value: n.id, label: n.is_virtual ? `${n.name}（虚拟组）` : n.name })
      walk(n.children)
    }
  }
  walk(orgTreeQuery.data.value as OrgTreeNode[] | undefined)
  return flat
})
const orgTreeQuery = useQuery({ queryKey: ['system', 'orgs'], queryFn: () => getOrgTreeApi() })

const tplDialog = reactive({ visible: false, isCreate: true, loading: false, error: '' })
const tplFormRef = ref<FormInstance>()
const tplForm = reactive({
  code: '', name: '', type_code: '', default_priority: 3,
  default_sla_minutes: undefined as number | undefined,
  default_fields_text: '', org_id: '', version: 0,
})

const tplRules = computed(() => ({
  code: [{ required: true, message: '请输入模板编码' }, { max: 50, message: '不超过 50 字' }],
  name: [{ required: true, message: '请输入模板名称' }, { max: 200, message: '不超过 200 字' }],
  type_code: [{ required: true, message: '请选择工单类型' }],
  ...(tplDialog.isCreate ? { org_id: [{ required: true, message: '请选择归属组织' }] } : {}),
}))

function openTplCreate() {
  Object.assign(tplDialog, { visible: true, isCreate: true, loading: false, error: '' })
  Object.assign(tplForm, { code: '', name: '', type_code: '', default_priority: 3, default_sla_minutes: undefined, default_fields_text: '', org_id: '', version: 0 })
}

function openTplEdit(row: TicketTemplateRow) {
  Object.assign(tplDialog, { visible: true, isCreate: false, loading: false, error: '' })
  Object.assign(tplForm, {
    code: row.code, name: row.name, type_code: row.type_code,
    default_priority: row.default_priority || 3,
    default_sla_minutes: row.default_sla_minutes ?? undefined,
    default_fields_text: row.default_fields ? JSON.stringify(row.default_fields) : '',
    org_id: row.org_id, version: row.version,
  })
}

async function submitTpl() {
  const valid = await tplFormRef.value?.validate().catch(() => false)
  if (!valid) return
  let defaultFields: unknown
  if (tplForm.default_fields_text.trim()) {
    try {
      defaultFields = JSON.parse(tplForm.default_fields_text)
    } catch {
      tplDialog.error = 'default_fields 须为合法 JSON'
      return
    }
  }
  tplDialog.loading = true
  tplDialog.error = ''
  try {
    if (tplDialog.isCreate) {
      await createTicketTemplateApi({
        code: tplForm.code, name: tplForm.name, type_code: tplForm.type_code,
        default_priority: tplForm.default_priority,
        ...(defaultFields !== undefined ? { default_fields: defaultFields } : {}),
        ...(tplForm.default_sla_minutes ? { default_sla_minutes: tplForm.default_sla_minutes } : {}),
        org_id: tplForm.org_id,
      })
      ElMessage.success('模板已创建')
    } else {
      await updateTicketTemplateApi({
        code: tplForm.code, name: tplForm.name,
        default_priority: tplForm.default_priority,
        ...(defaultFields !== undefined ? { default_fields: defaultFields } : {}),
        ...(tplForm.default_sla_minutes ? { default_sla_minutes: tplForm.default_sla_minutes } : {}),
        version: tplForm.version,
      })
      ElMessage.success('模板已更新')
    }
    tplDialog.visible = false
    await queryClient.invalidateQueries({ queryKey: ['ticket', 'templates'] })
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { code?: number; message?: string } } })?.response?.data
    if (resp?.code === 10006) {
      tplDialog.visible = false
      ElMessage.warning('该模板已被他人修改，请刷新后重试')
      await queryClient.invalidateQueries({ queryKey: ['ticket', 'templates'] })
    } else {
      tplDialog.error = resp?.message ?? '保存失败，请稍后重试'
    }
  } finally {
    tplDialog.loading = false
  }
}

async function onDeleteTpl(row: TicketTemplateRow) {
  try {
    await ElMessageBox.confirm(`确认删除模板「${row.name}」？`, '危险操作', {
      type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger',
    })
  } catch {
    return
  }
  try {
    await deleteTicketTemplateApi(row.code)
    ElMessage.success('已删除')
    await queryClient.invalidateQueries({ queryKey: ['ticket', 'templates'] })
  } catch (err: unknown) {
    ElMessage.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '删除失败')
  }
}

const ttTable = ref()
useTableFit(ttTable, () => typesQuery.data.value)

const tplTable = ref()
useTableFit(tplTable, () => templatesQuery.data.value)
</script>

<template>
  <div class="fill-page p-4">
    <el-card shadow="never">
      <el-tabs class="fill-tabs">
        <el-tab-pane label="工单类型">
          <div class="mb-2 flex-none">
            <el-button v-permission="'ticket:type:manage'" type="primary" @click="openTypeCreate">新建类型</el-button>
          </div>
          <div class="min-h-0 flex-initial">
          <el-table ref="ttTable" v-loading="typesQuery.isLoading.value" :data="typesQuery.data.value ?? []" row-key="id" stripe height="100%">
            <el-table-column v-for="col in typeColumns" :key="col.prop" :prop="col.prop" :label="col.label" :width="col.width" :min-width="col.minWidth" :align="col.align">
              <template #default="{ row }">
                <template v-if="col.prop === 'has_custom_fields'">
                  <el-tag v-if="row.has_custom_fields" size="small" type="info">有</el-tag>
                  <span v-else class="text-gray-400">无</span>
                </template>
                <template v-else-if="col.prop === 'is_active'">
                  <el-tag :type="row.is_active ? 'success' : 'danger'" size="small">{{ row.is_active ? '启用' : '停用' }}</el-tag>
                </template>
                <template v-else>{{ row[col.prop] }}</template>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="220" fixed="right">
              <template #default="{ row }">
                <el-button v-permission="'ticket:type:manage'" link type="primary" size="small" @click="openTypeEdit(row as TicketTypeFullRow)">编辑</el-button>
                <el-button v-permission="'ticket:type:manage'" link type="primary" size="small" @click="openFields(row as TicketTypeFullRow)">字段配置</el-button>
                <el-button v-permission="'ticket:type:manage'" link type="danger" size="small" @click="onDeleteType(row as TicketTypeFullRow)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          </div>
        </el-tab-pane>

        <el-tab-pane label="工单模板" lazy>
          <div class="mb-2 flex-none">
            <el-button v-permission="'ticket:type:manage'" type="primary" @click="openTplCreate">新建模板</el-button>
          </div>
          <div class="min-h-0 flex-initial">
          <el-table ref="tplTable" v-loading="templatesQuery.isLoading.value" :data="templatesQuery.data.value ?? []" row-key="id" stripe height="100%">
            <el-table-column prop="code" label="编码" width="160" />
            <el-table-column prop="name" label="名称" min-width="160" />
            <el-table-column prop="type_code" label="类型" width="140" />
            <el-table-column prop="default_priority" label="默认优先级" width="100" align="center" />
            <el-table-column prop="default_sla_minutes" label="SLA(分)" width="90" align="center" />
            <el-table-column prop="version" label="版本" width="70" align="center" />
            <el-table-column label="操作" width="160" fixed="right">
              <template #default="{ row }">
                <el-button v-permission="'ticket:type:manage'" link type="primary" size="small" @click="openTplEdit(row as TicketTemplateRow)">编辑</el-button>
                <el-button v-permission="'ticket:type:manage'" link type="danger" size="small" @click="onDeleteTpl(row as TicketTemplateRow)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <!-- 类型新建/编辑（states/transitions=JSON 源码模式——设计器批前的兜底形态） -->
    <el-dialog v-model="typeDialog.visible" :title="typeDialog.isCreate ? '新建类型' : '编辑类型'" width="600px">
      <el-form ref="typeFormRef" :model="typeForm" label-width="110px">
        <el-form-item label="编码" required>
          <el-input v-model="typeForm.code" :disabled="!typeDialog.isCreate" placeholder="如 incident" maxlength="50" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="typeForm.name" maxlength="100" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="typeForm.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="typeForm.is_active" />
          <span class="text-xs text-gray-400 ml-2">停用后新工单不可选该类型（存量不受影响）</span>
        </el-form-item>
        <template v-if="!typeDialog.isCreate">
          <el-form-item label="states(JSON)">
            <el-input v-model="typeForm.statesText" type="textarea" :rows="3" placeholder='["open","assigned",...]' />
          </el-form-item>
          <el-form-item label="transitions(JSON)">
            <el-input v-model="typeForm.transitionsText" type="textarea" :rows="4" placeholder='{"open":["assigned","closed"],...}' />
          </el-form-item>
          <el-alert
            type="warning" :closable="false" class="mb-2"
            title="状态图可配（含 in_progress/pending_verify 等），但用户实际可点的动作仅 分派/取消/关闭/更新/删除——in_progress、pending_verify、rejected 三态经 API 不可达（审批随翻案批），画了也不可点。"
          />
        </template>
      </el-form>
      <el-alert v-if="typeDialog.error" :title="typeDialog.error" type="error" show-icon class="mb-2" :closable="false" />
      <template #footer>
        <el-button @click="typeDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="typeDialog.loading" @click="submitType">保存</el-button>
      </template>
    </el-dialog>

    <!-- 字段编辑器（全量替换——危险确认） -->
    <el-dialog v-model="fieldsDialog.visible" :title="`字段配置 — ${fieldsDialog.name}`" width="860px">
      <div class="mb-2 flex items-center justify-between">
        <span class="text-xs text-gray-400">保存为「全量替换」：未列出的存量字段将被删除。字段类型七枚举：input/textarea/number/date/select/multi_select/tips。</span>
        <el-button v-permission="'ticket:type:manage'" size="small" @click="addFieldRow">添加字段</el-button>
      </div>
      <el-table v-loading="fieldsDialog.loading" :data="fieldRows" size="small" border>
        <el-table-column label="field_key" width="150">
          <template #default="{ row }"><el-input v-model="row.field_key" size="small" placeholder="英文键" maxlength="50" /></template>
        </el-table-column>
        <el-table-column label="label" width="140">
          <template #default="{ row }"><el-input v-model="row.field_label" size="small" maxlength="100" /></template>
        </el-table-column>
        <el-table-column label="类型" width="130">
          <template #default="{ row }">
            <el-select v-model="row.field_type" size="small">
              <el-option v-for="t in FIELD_TYPES" :key="t.value" :label="t.label" :value="t.value" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="选项(逗号分隔)" min-width="150">
          <template #default="{ row }">
            <el-input v-if="fieldHasOptions(row.field_type)" v-model="row.optionsText" size="small" placeholder="选项1,选项2" />
            <span v-else class="text-gray-300">—</span>
          </template>
        </el-table-column>
        <el-table-column label="必填" width="60" align="center">
          <template #default="{ row }"><el-switch v-model="row.required" size="small" :disabled="row.field_type === 'tips'" /></template>
        </el-table-column>
        <el-table-column label="regex" width="140">
          <template #default="{ row }"><el-input v-model="row.validate_regex" size="small" placeholder="可选" maxlength="200" /></template>
        </el-table-column>
        <el-table-column label="排序" width="90" align="center">
          <template #default="{ row }"><el-input-number v-model="row.sort_order" size="small" :min="0" controls-position="right" style="width: 70px" /></template>
        </el-table-column>
        <el-table-column label="操作" width="70" align="center">
          <template #default="{ $index }">
            <el-button link type="danger" size="small" @click="removeFieldRow($index)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-alert v-if="fieldsDialog.error" :title="fieldsDialog.error" type="error" show-icon class="mt-2" :closable="false" />
      <template #footer>
        <el-button @click="fieldsDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="fieldsDialog.saving" @click="saveFields">保存（整体替换）</el-button>
      </template>
    </el-dialog>

    <!-- 模板新建/编辑 -->
    <el-dialog v-model="tplDialog.visible" :title="tplDialog.isCreate ? '新建模板' : '编辑模板'" width="560px">
      <el-form ref="tplFormRef" :model="tplForm" :rules="tplRules" label-width="120px">
        <el-form-item label="编码" prop="code">
          <el-input v-model="tplForm.code" :disabled="!tplDialog.isCreate" maxlength="50" />
        </el-form-item>
        <el-form-item label="名称" prop="name">
          <el-input v-model="tplForm.name" maxlength="200" />
        </el-form-item>
        <el-form-item label="工单类型" prop="type_code">
          <el-select v-model="tplForm.type_code" :disabled="!tplDialog.isCreate" class="!w-full">
            <el-option v-for="t in typesQuery.data.value ?? []" :key="t.code" :label="`${t.name}（${t.code}）`" :value="t.code" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="tplDialog.isCreate" label="归属组织" prop="org_id">
          <el-select v-model="tplForm.org_id" filterable class="!w-full" placeholder="选择组织（决定可见范围）">
            <el-option v-for="o in orgOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="默认优先级">
          <el-select v-model="tplForm.default_priority" class="!w-[140px]">
            <el-option label="紧急" :value="1" />
            <el-option label="高" :value="2" />
            <el-option label="中" :value="3" />
            <el-option label="低" :value="4" />
          </el-select>
        </el-form-item>
        <el-form-item label="默认 SLA(分钟)">
          <el-input-number v-model="tplForm.default_sla_minutes" :min="1" controls-position="right" />
        </el-form-item>
        <el-form-item label="默认字段(JSON)">
          <el-input v-model="tplForm.default_fields_text" type="textarea" :rows="3" placeholder='{"env":"生产"}（可选）' />
        </el-form-item>
      </el-form>
      <el-alert v-if="tplDialog.error" :title="tplDialog.error" type="error" show-icon class="mb-2" :closable="false" />
      <template #footer>
        <el-button @click="tplDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="tplDialog.loading" @click="submitTpl">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

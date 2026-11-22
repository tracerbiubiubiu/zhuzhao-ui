<script setup lang="ts">
/**
 * 工单发起（P4-W4 第二批——动态字段渲染器）
 *
 * 设计口径注记：01 §1 拍板 form-create（仅工单自定义字段）——本批**自写七类型轻量渲染器**
 * （字段类型枚举封闭：input/textarea/number/date/select/multi_select/tips，零新依赖）；
 * form-create 库引入决策顺延至「类型管理三件套·设计器批」评估（02 §5 深水区策略：
 * 先渲染器后设计器——渲染器无需拖拽生成 schema）。
 *
 * - org_id 必填（CreateTicketRequest）：组织下拉双源——GET /user/orgs（自服务）优先，
 *   成功空集则 GET /orgs（管理面）；双空提示入组，失败/无权独立显示
 * - 字段校验：required 前置 + validate_regex 客户端预检（03 S8：G2 400 挂表单项）
 * - assigned_to 拒收（W0 P0-5）——发起不传；「创建即分派」形态已随 W0 有意下线
 */
import { apiErrorMessage, apiReadError } from '@/utils/apiError'
import { computed, onActivated, onDeactivated, onUnmounted, reactive, ref, watch } from 'vue'
import {
  ElButton, ElCard, ElDatePicker, ElForm, ElFormItem, ElInput, ElInputNumber,
  ElMessage, ElOption, ElRadio, ElRadioGroup, ElRate, ElSelect, ElTag,
  ElAlert,
} from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { listTicketTypesApi } from '@/api/ticket'
import {
  createTicketFromDefinitionApi, getPublishedTicketDefinitionApi,
  type PublishedTicketDefinition, type PublishedTicketField,
} from '@/api/ticket/publishedDefinition'
import { uploadAndConfirm } from '@/api/storage'
import { getMyOrgsApi } from '@/api/org/selfService'
import { getOrgTreeApi, type OrgTreeNode } from '@/api/system/org'
import { getDictItemsByCodeApi } from '@/api/system/dict'
import UserPicker from '@/components/UserPicker/index.vue'
import RichtextField from '@/components/RichtextField.vue'
import { richtextDraftKey } from '@/components/useRichtextDraft'
import { useUserStore } from '@/store/modules/user'
import { getSessionGeneration } from '@/common/auth/tokenStorage'

defineOptions({ name: 'TicketCreate' })

const router = useRouter()
const formRef = ref<FormInstance>()
const richtextRefs = ref<InstanceType<typeof RichtextField>[]>([])
const userStore = useUserStore()
const loading = ref(false)
const errorMsg = ref('')
const createdTicketId = ref('')
let active = true
let disposed = false

const form = reactive({
  type_code: '',
  title: '',
  description: '',
  priority: 3,
  org_id: '',
  custom: {} as Record<string, unknown>,
  escalationSupervisor: '', // 催办上级·人工指定（S10 B10-4——dd §31 基线档，可选）
})

const rules: FormRules = {
  type_code: [{ required: true, message: '请选择工单类型', trigger: 'change' }],
  title: [{ required: true, message: '请输入标题', trigger: 'blur' }, { max: 200, message: '不超过 200 字', trigger: 'blur' }],
  org_id: [{ required: true, message: '请选择归属组织', trigger: 'change' }],
}

// ─── 类型目录及已发布定义 ───
const typesQuery = useQuery({ queryKey: ['ticket', 'types'], queryFn: listTicketTypesApi })
const definition = ref<PublishedTicketDefinition>()
const nextDefinition = ref<PublishedTicketDefinition>()
const definitionLoading = ref(false)
const definitionStale = ref(false)
const fieldsPreviewOpen = ref(false)
const fields = computed(() => definition.value?.fields ?? [])
const fieldsError = ref('')
const fieldsReady = computed(() => definition.value?.type.code === form.type_code
  && !definitionLoading.value && !definitionStale.value && !fieldsError.value && !nextDefinition.value)
let fieldsSeq = 0

async function loadPublishedDefinition(code: string) {
  const seq = ++fieldsSeq
  const previous = definition.value?.type.code === code ? definition.value : undefined
  nextDefinition.value = undefined
  fieldsError.value = ''
  errorMsg.value = ''
  definitionStale.value = false
  definitionLoading.value = !!code
  if (!previous) {
    definition.value = undefined
    fieldsPreviewOpen.value = false
    form.custom = {}
    fileErrors.value = {}
  }
  fileUploading.value = {}
  if (!code) return
  try {
    const next = await getPublishedTicketDefinitionApi(code)
    if (seq !== fieldsSeq) return
    if (previous && Object.keys(form.custom).length && (
      previous.definition_ref.definition_version !== next.definition_ref.definition_version
      || previous.definition_ref.definition_hash !== next.definition_ref.definition_hash
    )) {
      nextDefinition.value = next
    } else {
      definition.value = next
    }
  } catch (err) {
    if (seq === fieldsSeq) {
      fieldsError.value = apiReadError(err, '已发布规则加载失败，请重试', '该类型的已发布规则当前不可用')
    }
  } finally {
    if (seq === fieldsSeq) definitionLoading.value = false
  }
}

function confirmNewDefinition() {
  if (!nextDefinition.value || definitionLoading.value || loading.value) return
  richtextRefs.value.forEach(editor => editor.clearDraft())
  form.custom = {}
  fileErrors.value = {}
  definition.value = nextDefinition.value
  nextDefinition.value = undefined
  formRef.value?.clearValidate()
}

watch(() => form.type_code, loadPublishedDefinition, { flush: 'sync' })
onActivated(() => {
  active = true
  if (form.type_code && !loading.value && !definitionLoading.value && !hasPendingUpload.value) {
    void loadPublishedDefinition(form.type_code)
  }
})
onDeactivated(() => { active = false })
onUnmounted(() => { active = false; disposed = true; fieldsSeq++ })

function draftKeyFor(fieldKey: string) {
  const ref = definition.value?.definition_ref
  if (!ref) return undefined
  const scope = JSON.stringify(['create', ref.type_code, ref.definition_version, ref.definition_hash])
  return richtextDraftKey(userStore.profile?.id, scope, fieldKey)
}

// ── B1-6 批3：条件显隐（渲染端 watch 联动——服务端 G2 提交时兜底断言） ──
function isVisibleField(f: PublishedTicketField): boolean {
  const vw = (f.field_meta as { visible_when?: string } | null | undefined)?.visible_when
  if (!vw) return true
  try {
    const m = vw.match(/^(\w+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/)
    if (!m) return true
    const [, key, op, rawVal] = m
    const cur = (form.custom as Record<string, unknown>)[key]
    const target = rawVal.replace(/'/g, '').replace(/"/g, '').trim()
    const curStr = String(cur ?? '')
    switch (op) {
      case '==': return curStr === target
      case '!=': return curStr !== target
      case '>': return Number(cur) > Number(target)
      case '<': return Number(cur) < Number(target)
      case '>=': return Number(cur) >= Number(target)
      case '<=': return Number(cur) <= Number(target)
    }
    return true
  } catch {
    return true
  }
}

// ── B1-6 批3：布局渲染投影（col_span 栅格 + group 折叠 + visible_when 过滤） ──
const visibleFields = computed(() => fields.value.filter((f) => isVisibleField(f)))


// ── B1-6 批3 file：上传字段（presign→PUT→confirm 三步直传→object_key 入 custom_data） ──
const fileUploading = ref<Record<string, boolean>>({})
const fileErrors = ref<Record<string, string>>({})
const hasPendingUpload = computed(() => Object.values(fileUploading.value).some(Boolean))

function fileKeys(f: PublishedTicketField): string[] {
  return ((form.custom as Record<string, unknown>)[f.field_key] as string[] | undefined) ?? []
}

function setFileKeys(f: PublishedTicketField, keys: string[]) {
  ;(form.custom as Record<string, unknown>)[f.field_key] = keys.length ? keys : undefined
}

function mimeAllowed(f: PublishedTicketField, file: File): boolean {
  const raw = f.field_options
  if (!Array.isArray(raw) || raw.length === 0) return true
  return raw.some((m) => typeof m === 'string' && file.type === m)
}

async function handleFileUpload(f: PublishedTicketField, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !fieldsReady.value || loading.value || fileUploading.value[f.field_key]) return
  const seq = fieldsSeq
  fileErrors.value[f.field_key] = ''
  if (!mimeAllowed(f, file)) {
    fileErrors.value[f.field_key] = `文件类型 ${file.type} 不在白名单内`
    return
  }
  fileUploading.value[f.field_key] = true
  try {
    const result = await uploadAndConfirm(file, 'attachment_create')
    if (seq === fieldsSeq) setFileKeys(f, [...fileKeys(f), result.object_key])
  } catch (e) {
    if (seq === fieldsSeq) fileErrors.value[f.field_key] = e instanceof Error ? e.message : '上传失败'
  } finally {
    if (seq === fieldsSeq) fileUploading.value[f.field_key] = false
  }
}

function removeFileKey(f: PublishedTicketField, key: string) {
  if (!fieldsReady.value || loading.value) return
  setFileKeys(f, fileKeys(f).filter((k) => k !== key))
}

function shortName(key: string): string {
  const parts = key.split('/')
  return parts[parts.length - 1] ?? key
}

/** 字段动态校验规则（required + regex 预检——03 S8） */
const fieldRules = computed(() => {
  const out: FormRules = {}
  for (const f of fields.value) {
    if (f.field_type === 'tips') continue
    const rs: Array<Record<string, unknown>> = []
    if (f.required) rs.push({ required: true, message: `请填写「${f.field_label}」`, trigger: 'blur' })
    if (f.validate_regex) {
      rs.push({
        validator: (_r: unknown, value: unknown, cb: (e?: Error) => void) => {
          if (value === undefined || value === null || value === '') return cb()
          try {
            if (new RegExp(f.validate_regex!).test(String(value))) cb()
            else cb(new Error(`「${f.field_label}」格式不正确`))
          } catch {
            cb() // 服务端正则语法异常不阻塞前端
          }
        },
        trigger: 'blur',
      })
    }
    if (rs.length) out[f.field_key] = rs
  }
  return out
})

// ── B1-2 字典引用预载：field_options 单元素 "dict:<code>" → 拉启用项缓存（optionsOf 同步查） ──
const dictCache = ref<Record<string, Array<{ value: string; label: string }>>>({})
const dictErrors = ref<Record<string, string>>({})
const dictLoading = ref<Record<string, boolean>>({})
const dictPending = new Map<string, Promise<void>>()
function dictCode(f: PublishedTicketField): string {
  const raw = f.field_options
  return Array.isArray(raw) && raw.length === 1 && typeof raw[0] === 'string' && raw[0].startsWith('dict:') ? raw[0].slice(5) : ''
}
async function loadDictionary(code: string) {
  if (!code || dictCache.value[code]) return
  if (dictPending.has(code)) return dictPending.get(code)
  dictLoading.value[code] = true
  dictErrors.value[code] = ''
  const pending = (async () => {
    try {
      const items = await getDictItemsByCodeApi(code, false, { _silentError: true })
      dictCache.value[code] = (items ?? []).map(i => ({ value: i.code, label: i.label }))
    } catch (err) {
      dictErrors.value[code] = apiReadError(err, '字典加载失败，请重试')
    } finally {
      dictLoading.value[code] = false
      dictPending.delete(code)
    }
  })()
  dictPending.set(code, pending)
  return pending
}
watch([fields, definitionLoading], ([fs, reading]) => {
  if (reading) return
  const codes = new Set(fs.map(dictCode).filter(Boolean))
  codes.forEach(code => { void loadDictionary(code) })
}, { immediate: true })

/** B1-3 formula 字段判定（field_meta.formula 非空——服务端求值 SSOT，前端禁编辑） */
function isFormulaField(f: PublishedTicketField): boolean {
  return !!(f as { field_meta?: { formula?: string } | null }).field_meta?.formula
}

/** select 选项归一（字符串数组 / {value,label} 数组 / dict:<code> 引用——B1-2 三形态） */
function optionsOf(f: PublishedTicketField): Array<{ value: string; label: string }> {
  const raw = f.field_options
  if (Array.isArray(raw)) {
    // 挂字典引用：展开启用项（缓存未到时暂空——watch immediate 补齐后响应式刷新）
    if (raw.length === 1 && typeof raw[0] === 'string' && raw[0].startsWith('dict:')) {
      return dictCache.value[raw[0].slice(5)] ?? []
    }
    return raw.map((o) =>
      typeof o === 'object' && o !== null && 'value' in (o as Record<string, unknown>)
        ? { value: String((o as Record<string, unknown>).value), label: String((o as Record<string, unknown>).label ?? (o as Record<string, unknown>).value) }
        : { value: String(o), label: String(o) },
    )
  }
  return []
}

// ─── 组织下拉（双源）───
const orgOptions = ref<Array<{ value: string; label: string }>>([])
const orgsLoading = ref(true)
const orgsError = ref('')
let orgsSeq = 0
async function loadOrgs() {
  const seq = ++orgsSeq
  orgsLoading.value = true
  orgsError.value = ''
  orgOptions.value = []
  try {
    const mine = await getMyOrgsApi()
    if (seq !== orgsSeq) return
    if (mine.length) {
      orgOptions.value = mine.map(o => ({ value: String(o.org_id), label: String(o.org_name ?? '') }))
    } else {
      const all = await getOrgTreeApi({ _silentError: true })
      if (seq !== orgsSeq) return
      const flat: Array<{ value: string; label: string }> = []
      const walk = (nodes: OrgTreeNode[]) => {
        for (const n of nodes) {
          flat.push({ value: n.id, label: n.is_virtual ? `${n.name}（虚拟组）` : n.name })
          walk(n.children ?? [])
        }
      }
      walk(all ?? [])
      orgOptions.value = flat
    }
  } catch (err) {
    if (seq === orgsSeq) orgsError.value = apiReadError(err, '组织加载失败，请重试')
  } finally {
    if (seq === orgsSeq) orgsLoading.value = false
  }
}
void loadOrgs()

async function handleSubmit() {
  if (!active || loading.value || hasPendingUpload.value || (form.type_code && !fieldsReady.value)) return
  const seq = fieldsSeq
  const generation = getSessionGeneration()
  const isCurrent = () => !disposed && seq === fieldsSeq && generation === getSessionGeneration()
  loading.value = true
  errorMsg.value = ''
  try {
    const valid = await formRef.value?.validate().catch(() => false)
    const snapshot = definition.value
    if (!valid || !active || !isCurrent() || !snapshot || !fieldsReady.value || hasPendingUpload.value) return
    const customData = { ...form.custom }
    const { id } = await createTicketFromDefinitionApi({
      type_code: form.type_code,
      title: form.title,
      org_id: form.org_id,
      priority: form.priority,
      description: form.description || undefined,
      custom_data: Object.keys(customData).length ? customData : undefined,
      ...(form.escalationSupervisor ? { escalation_supervisor_id: form.escalationSupervisor } : {}),
    }, snapshot.definition_ref)
    if (!isCurrent()) return
    richtextRefs.value.forEach((editor) => editor.clearDraft())
    // 发起页在 keep-alive 中存活；成功后复原表单，返回发起页不能继承已提交内容。
    Object.assign(form, { type_code: '', title: '', description: '', priority: 3, org_id: '', custom: {}, escalationSupervisor: '' })
    formRef.value?.clearValidate()
    if (active) {
      ElMessage.success('工单已提交')
      void router.push(`/tickets/${id}`)
    } else {
      createdTicketId.value = id
    }
  } catch (err: unknown) {
    if (!isCurrent()) return
    const status = (err as { response?: { status?: number } })?.response?.status
    if (status === 409) {
      definitionStale.value = true
      errorMsg.value = `${apiErrorMessage(err, '提交发生冲突')}。请刷新已发布定义并核对字段后再提交。`
    } else {
      errorMsg.value = apiErrorMessage(err, '提交失败，请稍后重试')
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="fill-page p-4 max-w-[760px] mx-auto">
    <div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
    <el-card shadow="never">
      <el-alert v-if="errorMsg" :title="errorMsg" type="error" show-icon class="mb-4" :closable="false" />
      <el-alert v-if="createdTicketId" title="工单已提交" type="success" show-icon class="mb-4" @close="createdTicketId = ''">
        <el-button link type="primary" @click="router.push(`/tickets/${createdTicketId}`)">查看已提交工单</el-button>
      </el-alert>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px" :disabled="loading" :inert="loading">
        <el-form-item label="工单类型" prop="type_code">
          <el-select v-model="form.type_code" :loading="typesQuery.isFetching.value" placeholder="选择类型" class="!w-full">
            <el-option
              v-for="t in typesQuery.data.value ?? []"
              :key="t.code" :label="definition?.type.code === t.code ? definition.type.name : t.name" :value="t.code"
            />
          </el-select>
        </el-form-item>
        <el-alert
          v-if="typesQuery.error.value"
          :title="apiReadError(typesQuery.error.value, '工单类型加载失败，请重试')"
          type="error" show-icon :closable="false" class="mb-4"
        >
          <el-button size="small" @click="typesQuery.refetch()">重试加载类型</el-button>
        </el-alert>
        <p v-if="definitionLoading" class="mb-4" role="status">正在读取已发布定义</p>
        <el-alert v-if="fieldsError" :title="fieldsError" type="error" show-icon :closable="false" class="mb-4">
          <el-button size="small" @click="loadPublishedDefinition(form.type_code)">重试读取已发布定义</el-button>
        </el-alert>
        <el-button
          v-if="definitionStale" size="small" class="mb-4" @click="loadPublishedDefinition(form.type_code)"
        >刷新已发布定义</el-button>
        <el-alert
          v-if="nextDefinition"
          :title="`已发布版本已变更为 ${nextDefinition.definition_ref.definition_version}`"
          type="warning" show-icon :closable="false" class="mb-4"
        >
          <p>切换版本会清空当前自定义字段。请先留存需要的内容，再按新版本核对填写。</p>
          <el-button size="small" @click="confirmNewDefinition">切换到新版本</el-button>
        </el-alert>
        <div v-if="definition" class="mb-4">
          <div>{{ definition.type.name }} · {{ fieldsReady ? '已发布版本' : '已读取版本' }} {{ definition.definition_ref.definition_version }}</div>
          <div class="text-xs [overflow-wrap:anywhere]">定义摘要 {{ definition.definition_ref.definition_hash }}</div>
          <p v-if="definition.type.description">{{ definition.type.description }}</p>
          <details class="mt-1" @toggle="fieldsPreviewOpen = ($event.target as HTMLDetailsElement).open">
            <summary class="cursor-pointer">核对字段定义</summary>
            <template v-if="fieldsPreviewOpen">
              <p v-if="!fields.length">此版本无自定义字段</p>
              <ul v-else class="pl-5">
                <li v-for="f in fields" :key="f.field_key">
                  {{ f.field_label }}（{{ f.field_key }}{{ f.required ? '，必填' : '' }}）
                </li>
              </ul>
            </template>
          </details>
        </div>
        <el-form-item label="标题" prop="title">
          <el-input v-model="form.title" maxlength="200" show-word-limit placeholder="一句话描述问题或请求" />
        </el-form-item>
        <el-form-item label="优先级">
          <el-select v-model="form.priority" class="!w-[140px]">
            <el-option label="紧急" :value="1" />
            <el-option label="高" :value="2" />
            <el-option label="中" :value="3" />
            <el-option label="低" :value="4" />
          </el-select>
        </el-form-item>
        <el-form-item label="归属组织" prop="org_id">
          <el-select v-model="form.org_id" :loading="orgsLoading" filterable placeholder="选择组织" class="!w-full">
            <el-option v-for="o in orgOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
          <el-alert v-if="orgsError" :title="orgsError" type="error" :closable="false"><el-button size="small" @click="loadOrgs">重试</el-button></el-alert>
          <span v-if="!orgsLoading && !orgsError && !orgOptions.length" class="text-xs text-[var(--el-color-danger)]">
            无可选组织（未入组）——请联系管理员将你加入组织后再发起
          </span>
        </el-form-item>

        <!-- 动态自定义字段（七类型渲染器；类型切换时重置） -->
        <template v-for="f in visibleFields" :key="`${form.type_code}:${definition?.definition_ref.definition_version}:${f.field_key}`">
          <!-- tips=说明块无值：脱离 label 列整行呈现（此前 label/内容双显同文案） -->
          <div v-if="f.field_type === 'tips'" class="text-xs text-gray-400 -mt-1 mb-3">
            {{ f.field_label }}
          </div>
          <el-form-item v-else :label="f.field_label" :prop="['custom', f.field_key]" :rules="fieldRules[f.field_key]">
            <el-input
              v-if="f.field_type === 'input' && !isFormulaField(f)" v-model="(form.custom[f.field_key] as string | undefined)"
              :placeholder="f.required ? '必填' : ''"
            />
            <el-input
              v-else-if="f.field_type === 'input' && isFormulaField(f)" :model-value="String(form.custom[f.field_key] ?? '—')"
              disabled
            >
              <template #suffix><span class="text-xs text-blue-400">自动计算</span></template>
            </el-input>
            <el-input
              v-else-if="f.field_type === 'textarea'" v-model="(form.custom[f.field_key] as string | undefined)"
              type="textarea" :rows="3"
            />
            <el-input-number
              v-else-if="f.field_type === 'number' && !isFormulaField(f)" v-model="form.custom[f.field_key] as number | undefined"
              :controls="false"
            />
            <el-input-number
              v-else-if="f.field_type === 'number' && isFormulaField(f)" :model-value="(form.custom[f.field_key] as number | undefined)"
              :controls="false" disabled
            />
            <!-- 后端 validateFieldValue 严格校验 YYYY-MM-DD——value-format 直出字符串，
                 防 Date 对象被序列化成 ISO datetime 而吃 400 -->
            <el-date-picker
              v-else-if="f.field_type === 'date'" v-model="(form.custom[f.field_key] as string | undefined)"
              type="date" value-format="YYYY-MM-DD" class="!w-full"
            />
            <el-select
              v-else-if="f.field_type === 'select'" v-model="(form.custom[f.field_key] as string | undefined)"
              clearable :loading="dictLoading[dictCode(f)]" class="!w-full"
            >
              <el-option v-for="o in optionsOf(f)" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
            <el-select
              v-else-if="f.field_type === 'multi_select'" v-model="form.custom[f.field_key] as string[] | undefined"
              multiple clearable :loading="dictLoading[dictCode(f)]" class="!w-full"
            >
              <el-option v-for="o in optionsOf(f)" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
            <!-- B1-6 批3 radio：与 select 同数据模型不同渲染（el-radio-group） -->
            <el-radio-group
              v-else-if="f.field_type === 'radio'" v-model="form.custom[f.field_key] as string | undefined"
            >
              <el-radio v-for="o in optionsOf(f)" :key="o.value" :value="o.value">{{ o.label }}</el-radio>
            </el-radio-group>
            <!-- B1-6 批3 rating：与 number 同数据模型（el-rate 1–5 整数） -->
            <el-rate
              v-else-if="f.field_type === 'rating' && !isFormulaField(f)"
              :model-value="Number(form.custom[f.field_key] ?? 0)"
              @update:model-value="(v: number | undefined) => { form.custom[f.field_key] = v ?? 0 }"
            />
            <el-input-number
              v-else-if="f.field_type === 'rating' && isFormulaField(f)"
              :model-value="Number(form.custom[f.field_key] ?? 0)" :controls="false" disabled
            />
            <!-- B1-6 批3 file：上传字段（presign→confirm 直传→object_key 数组） -->
            <div v-else-if="f.field_type === 'file'" class="file-upload-field">
              <input
                type="file"
                :data-field-key="f.field_key"
                :disabled="!fieldsReady || loading"
                class="hidden"
                @change="handleFileUpload(f, $event)"
              />
              <el-button
                size="small"
                :loading="fileUploading[f.field_key]"
                :disabled="!fieldsReady"
                @click="(($event?.target as HTMLElement)?.closest('.file-upload-field')?.querySelector('input[type=file]') as HTMLInputElement | null)?.click()"
              >
                选择文件
              </el-button>
              <div v-if="fileKeys(f).length" class="mt-1 flex flex-wrap gap-1">
                <el-tag
                  v-for="k in fileKeys(f)"
                  :key="k"
                  size="small"
                  :closable="fieldsReady && !loading"
                  @close="removeFileKey(f, k)"
                >{{ shortName(k) }}</el-tag>
              </div>
              <div v-if="fileErrors[f.field_key]" class="text-xs text-red-500 mt-1">{{ fileErrors[f.field_key] }}</div>
            </div>
            <!-- richtext=md-editor-v3 富文本编辑器（工具栏+图片粘贴直传+本地草稿） -->
            <RichtextField
              v-else-if="f.field_type === 'richtext' && !isFormulaField(f)"
              :key="`${form.type_code}:${f.field_key}`"
              ref="richtextRefs"
              :model-value="(form.custom[f.field_key] as string | undefined) ?? ''"
              :placeholder="f.required ? '必填' : ''"
              :draft-key="draftKeyFor(f.field_key)"
              @update:model-value="(v: string) => { form.custom[f.field_key] = v }"
            />
            <el-input
              v-else-if="f.field_type === 'richtext' && isFormulaField(f)"
              :model-value="String(form.custom[f.field_key] ?? '—')"
              disabled
            >
              <template #suffix><span class="text-xs text-blue-400">自动计算</span></template>
            </el-input>
            <el-alert v-if="dictCode(f) && dictErrors[dictCode(f)]" :title="dictErrors[dictCode(f)]" type="error" :closable="false">
              <el-button size="small" @click="loadDictionary(dictCode(f))">重试加载选项</el-button>
            </el-alert>
          </el-form-item>
        </template>

        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="4" placeholder="补充细节（可选）" />
        </el-form-item>
        <!-- S10 B10-4：催办上级人工指定（可选——超时催办的上级收件档；可后续分派时改） -->
        <el-form-item label="催办上级">
          <UserPicker v-model="form.escalationSupervisor" :context="{ purpose: 'create-supervisor', orgId: form.org_id, typeCode: form.type_code }" class="!w-[240px]" />
          <span class="text-xs text-gray-400 ml-2">可选：工单超时催办时通知的上级（不填则只催处理人）</span>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" :disabled="hasPendingUpload || (!!form.type_code && !fieldsReady)" @click="handleSubmit">提交工单</el-button>
          <el-button @click="router.back()">取消</el-button>
        </el-form-item>
      </el-form>
    </el-card>
    </div>
  </div>
</template>

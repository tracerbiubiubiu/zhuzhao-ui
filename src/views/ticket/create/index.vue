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
 *   空（admin/未入组）则 GET /orgs（管理面）；双空/403 → 提示先入组织
 * - 字段校验：required 前置 + validate_regex 客户端预检（03 S8：G2 400 挂表单项）
 * - assigned_to 拒收（W0 P0-5）——发起不传；「创建即分派」形态已随 W0 有意下线
 */
import { computed, reactive, ref, watch } from 'vue'
import {
  ElButton, ElCard, ElDatePicker, ElForm, ElFormItem, ElInput, ElInputNumber,
  ElMessage, ElOption, ElSelect,
  ElAlert,
} from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import {
  createTicketApi, getTicketTypeFieldsApi, listTicketTypesApi,
  type TicketTypeFieldDef,
} from '@/api/ticket'
import { getMyOrgsApi } from '@/api/org/selfService'
import { getOrgTreeApi, type OrgTreeNode } from '@/api/system/org'

defineOptions({ name: 'TicketCreate' })

const router = useRouter()
const formRef = ref<FormInstance>()
const loading = ref(false)
const errorMsg = ref('')

const form = reactive({
  type_code: '',
  title: '',
  description: '',
  priority: 3,
  org_id: '',
  custom: {} as Record<string, unknown>,
})

const rules: FormRules = {
  type_code: [{ required: true, message: '请选择工单类型', trigger: 'change' }],
  title: [{ required: true, message: '请输入标题', trigger: 'blur' }, { max: 200, message: '不超过 200 字', trigger: 'blur' }],
  org_id: [{ required: true, message: '请选择归属组织', trigger: 'change' }],
}

// ─── 类型与字段定义 ───
const typesQuery = useQuery({ queryKey: ['ticket', 'types'], queryFn: listTicketTypesApi })
const fields = ref<TicketTypeFieldDef[]>([])
let fieldsSeq = 0 // 快速切换类型时弃置过期响应（后到的旧 schema 不得覆盖新选中类型）

watch(() => form.type_code, async (code) => {
  form.custom = {}
  const seq = ++fieldsSeq
  const next = code ? await getTicketTypeFieldsApi(code).catch(() => []) : []
  if (seq !== fieldsSeq) return
  fields.value = next
})

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

/** select 选项归一（field_options 可能是字符串数组或 {value,label} 数组） */
function optionsOf(f: TicketTypeFieldDef): Array<{ value: string; label: string }> {
  const raw = f.field_options
  if (Array.isArray(raw)) {
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
;(async () => {
  try {
    const mine = await getMyOrgsApi().catch(() => [])
    if (mine.length) {
      orgOptions.value = mine.map((o) => ({ value: String(o.org_id), label: String(o.org_name ?? '') }))
    } else {
      // admin/未入组：管理面全量兜底（无 Casbin 者此处 403 → 空列表提示）
      const all = await getOrgTreeApi({ _silentError: true }).catch(() => null)
      const flat: Array<{ value: string; label: string }> = []
      const walk = (nodes: OrgTreeNode[] | undefined) => {
        for (const n of nodes ?? []) {
          flat.push({ value: n.id, label: n.is_virtual ? `${n.name}（虚拟组）` : n.name })
          walk(n.children)
        }
      }
      walk(all ?? [])
      orgOptions.value = flat
    }
  } finally {
    orgsLoading.value = false
  }
})()

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  errorMsg.value = ''
  try {
    const { id } = await createTicketApi({
      type_code: form.type_code,
      title: form.title,
      org_id: form.org_id,
      priority: form.priority,
      description: form.description || undefined,
      custom_data: Object.keys(form.custom).length ? form.custom : undefined,
    })
    ElMessage.success('工单已提交')
    router.push(`/tickets/${id}`)
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    errorMsg.value = resp?.message ?? '提交失败，请稍后重试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="fill-page p-4 max-w-[760px] mx-auto">
    <div class="min-h-0 flex-1 overflow-y-auto">
    <el-card shadow="never">
      <template #header><span class="font-semibold">发起工单</span></template>
      <el-alert v-if="errorMsg" :title="errorMsg" type="error" show-icon class="mb-4" :closable="false" />
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="工单类型" prop="type_code">
          <el-select v-model="form.type_code" placeholder="选择类型" class="!w-full">
            <el-option v-for="t in typesQuery.data.value ?? []" :key="t.code" :label="t.name" :value="t.code" />
          </el-select>
        </el-form-item>
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
          <span v-if="!orgsLoading && !orgOptions.length" class="text-xs text-[var(--el-color-danger)]">
            无可选组织（未入组）——请联系管理员将你加入组织后再发起
          </span>
        </el-form-item>

        <!-- 动态自定义字段（七类型渲染器；类型切换时重置） -->
        <template v-for="f in fields" :key="f.field_key">
          <!-- tips=说明块无值：脱离 label 列整行呈现（此前 label/内容双显同文案） -->
          <div v-if="f.field_type === 'tips'" class="text-xs text-gray-400 -mt-1 mb-3">
            {{ f.field_label }}
          </div>
          <el-form-item v-else :label="f.field_label" :prop="`custom.${f.field_key}`" :rules="fieldRules[f.field_key]">
            <el-input
              v-if="f.field_type === 'input'" v-model="(form.custom[f.field_key] as string | undefined)"
              :placeholder="f.required ? '必填' : ''"
            />
            <el-input
              v-else-if="f.field_type === 'textarea'" v-model="(form.custom[f.field_key] as string | undefined)"
              type="textarea" :rows="3"
            />
            <el-input-number
              v-else-if="f.field_type === 'number'" v-model="form.custom[f.field_key] as number | undefined"
            />
            <!-- 后端 validateFieldValue 严格校验 YYYY-MM-DD——value-format 直出字符串，
                 防 Date 对象被序列化成 ISO datetime 而吃 400 -->
            <el-date-picker
              v-else-if="f.field_type === 'date'" v-model="(form.custom[f.field_key] as string | undefined)"
              type="date" value-format="YYYY-MM-DD" class="!w-full"
            />
            <el-select
              v-else-if="f.field_type === 'select'" v-model="(form.custom[f.field_key] as string | undefined)"
              clearable class="!w-full"
            >
              <el-option v-for="o in optionsOf(f)" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
            <el-select
              v-else-if="f.field_type === 'multi_select'" v-model="form.custom[f.field_key] as string[] | undefined"
              multiple clearable class="!w-full"
            >
              <el-option v-for="o in optionsOf(f)" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
          </el-form-item>
        </template>

        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="4" placeholder="补充细节（可选）" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="handleSubmit">提交工单</el-button>
          <el-button @click="router.back()">取消</el-button>
        </el-form-item>
      </el-form>
    </el-card>
    </div>
  </div>
</template>

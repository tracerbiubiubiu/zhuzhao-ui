<script setup lang="ts">
import { computed, onScopeDispose, reactive, ref, useId, watch } from 'vue'
import {
  ElAlert, ElButton, ElDatePicker, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber,
  ElOption, ElRadio, ElRadioGroup, ElRate, ElSelect,
} from 'element-plus'
import { getDictItemsByCodeApi } from '@/api/system/dict'
import type { TicketTypeFieldDef } from '@/api/ticket'
import { getSessionGeneration } from '@/common/auth/tokenStorage'
import { apiReadError } from '@/utils/apiError'
import { allowedFileMimes, collectTransitionInput, createActionFileQueue, type TransitionActionForm, type TransitionActionInput } from './transitionActionFields'

const props = defineProps<{
  modelValue: boolean
  action: TransitionActionForm | null
  submitting?: boolean
  failure?: string
  retryOnly?: boolean
  refreshRequired?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [input: TransitionActionInput]
  refresh: []
}>()

const id = useId()
const values = reactive<Record<string, unknown>>(Object.create(null))
const comment = ref('')
const attempted = ref(false)
const files = createActionFileQueue()
const fields = computed(() => props.action?.fields ?? [])
const editLocked = computed(() => props.submitting || props.retryOnly || props.refreshRequired)
const dismissLocked = computed(() => props.submitting || props.retryOnly)

interface Option {
  value: string
  label: string
}

type DictionaryState = { loading: true } | { options: Option[] } | { error: string }
const dictionaries = reactive<Record<string, DictionaryState>>(Object.create(null))
let optionGeneration = 0

function dictCode(field: TicketTypeFieldDef): string {
  if (!['select', 'multi_select', 'radio'].includes(field.field_type)) return ''
  const raw = field.field_options
  return Array.isArray(raw) && raw.length === 1 && typeof raw[0] === 'string' && raw[0].startsWith('dict:')
    ? raw[0].slice(5)
    : ''
}

function optionsOf(field: TicketTypeFieldDef): Option[] {
  const dictionary = dictionaries[dictCode(field)]
  if (dictionary) return 'options' in dictionary ? dictionary.options : []
  const raw = field.field_options
  if (!Array.isArray(raw)) return []
  return raw.map(option => typeof option === 'object' && option !== null && 'value' in option
    ? { value: String(option.value), label: String(option.label ?? option.value) }
    : { value: String(option), label: String(option) })
}

async function loadOptions(code: string) {
  if (!props.modelValue || dictionaries[code] && !('error' in dictionaries[code])) return
  const generation = optionGeneration
  const session = getSessionGeneration()
  const current = () => generation === optionGeneration && session === getSessionGeneration()
  dictionaries[code] = { loading: true }
  try {
    const items = await getDictItemsByCodeApi(code, false, { _silentError: true })
    if (current()) dictionaries[code] = { options: items.map(item => ({ value: item.code, label: item.label })) }
  } catch (error) {
    if (current()) dictionaries[code] = { error: apiReadError(error, '选项加载失败，请重试') }
  }
}

function dictionaryError(field: TicketTypeFieldDef): string {
  const dictionary = dictionaries[dictCode(field)]
  return dictionary && 'error' in dictionary ? dictionary.error : ''
}

function dictionaryLoading(field: TicketTypeFieldDef): boolean {
  const dictionary = dictionaries[dictCode(field)]
  return !!dictionary && 'loading' in dictionary
}

const dictionaryCodes = computed(() => new Set(fields.value.map(field => dictCode(field.definition)).filter(Boolean)))
const dictionariesReady = computed(() => [...dictionaryCodes.value].every(code => {
  const dictionary = dictionaries[code]
  return dictionary && 'options' in dictionary
}))

function reset() {
  optionGeneration++
  attempted.value = false
  comment.value = ''
  for (const key of Object.keys(values)) delete values[key]
  for (const code of Object.keys(dictionaries)) delete dictionaries[code]
  files.reset()
}

watch(() => props.action, reset, { flush: 'sync' })
watch([() => props.modelValue, dictionaryCodes], ([open, codes]) => {
  if (open) codes.forEach(code => { void loadOptions(code) })
}, { immediate: true })
onScopeDispose(reset)

const validation = computed(() => props.action && collectTransitionInput(props.action, values, files.keys(), comment.value))
const errors = computed(() => attempted.value && validation.value && 'errors' in validation.value ? validation.value : undefined)
const confirmDisabled = computed(() => props.submitting || props.refreshRequired || files.hasUnconfirmed.value || !dictionariesReady.value)

function dismiss() {
  // 只转发主动关闭。缓存页隐藏对话框时保留当前动作的输入。
  if (props.modelValue && !dismissLocked.value) emit('update:modelValue', false)
}

function submit() {
  if (!props.modelValue || confirmDisabled.value) return
  attempted.value = true
  const result = validation.value
  if (result && 'input' in result) emit('confirm', result.input)
}

function selectFiles(field: TicketTypeFieldDef, event: Event) {
  const input = event.target as HTMLInputElement
  const selected = Array.from(input.files ?? [])
  input.value = ''
  if (!editLocked.value && selected.length) void files.add(field, selected)
}
</script>

<template>
  <el-dialog
    :model-value="modelValue" :title="action?.title" width="min(560px, 95vw)"
    :close-on-click-modal="false" :close-on-press-escape="!dismissLocked" :show-close="!dismissLocked"
    :before-close="dismiss"
  >
    <div class="max-h-[min(420px,55vh)] overflow-y-auto px-1">
      <el-alert v-if="failure" :title="failure" type="error" :closable="false" class="mb-3" />
      <el-form v-if="action" label-position="top" :disabled="editLocked" @submit.prevent="submit">
        <el-form-item
          v-for="{ definition: field, required } in fields" :key="field.field_key"
          :label="field.field_label" :required="required" :error="errors?.errors[field.field_key]"
          :for="field.field_type === 'file' ? `${id}-${field.field_key}` : undefined"
        >
          <el-input v-if="field.field_type === 'input'" v-model="values[field.field_key] as string | undefined" />
          <el-input
            v-else-if="field.field_type === 'textarea' || field.field_type === 'richtext'"
            v-model="values[field.field_key] as string | undefined" type="textarea" :rows="3"
            :placeholder="field.field_type === 'richtext' ? '支持 Markdown' : undefined"
          />
          <el-input-number v-else-if="field.field_type === 'number'" v-model="values[field.field_key] as number | undefined" :controls="false" />
          <el-date-picker
            v-else-if="field.field_type === 'date'" v-model="values[field.field_key] as string | undefined"
            type="date" value-format="YYYY-MM-DD" class="!w-full"
          />
          <el-select
            v-else-if="field.field_type === 'select' || field.field_type === 'multi_select'"
            v-model="values[field.field_key] as string | string[] | undefined"
            :multiple="field.field_type === 'multi_select'" :loading="dictionaryLoading(field)" clearable class="!w-full"
          >
            <el-option v-for="option in optionsOf(field)" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
          <el-radio-group v-else-if="field.field_type === 'radio'" v-model="values[field.field_key] as string | undefined">
            <el-radio v-for="option in optionsOf(field)" :key="option.value" :value="option.value">{{ option.label }}</el-radio>
          </el-radio-group>
          <el-rate
            v-else-if="field.field_type === 'rating'" :model-value="Number(values[field.field_key] ?? 0)"
            @update:model-value="value => { values[field.field_key] = value || undefined }"
          />
          <div v-else-if="field.field_type === 'file'" class="w-full">
            <input
              :id="`${id}-${field.field_key}`" type="file" multiple :accept="allowedFileMimes(field).join(',')"
              :disabled="editLocked" :aria-required="required" @change="selectFiles(field, $event)"
            />
            <ul v-if="files.state[field.field_key]?.length" class="m-0 list-none p-0" aria-live="polite">
              <li v-for="file in files.state[field.field_key]" :key="file.id" class="break-all">
                {{ file.name }}
                <span v-if="file.status === 'pending'">正在上传…</span>
                <span v-else-if="file.status === 'failed'" class="text-[var(--el-color-danger)]">{{ file.error }}</span>
                <el-button
                  v-if="file.status === 'failed' && file.retryable" link type="primary" :aria-label="`重新上传 ${file.name}`"
                  @click="files.retry(field, file.id)"
                >重新上传</el-button>
                <el-button
                  v-if="file.status !== 'pending'" link :aria-label="`移除 ${file.name}`" @click="files.remove(field.field_key, file.id)"
                >移除</el-button>
              </li>
            </ul>
          </div>
          <span v-if="field.field_type === 'radio' && dictionaryLoading(field)">正在加载选项…</span>
          <el-alert v-if="dictionaryError(field)" :title="dictionaryError(field)" type="error" :closable="false">
            <el-button size="small" @click="loadOptions(dictCode(field))">重试加载选项</el-button>
          </el-alert>
        </el-form-item>
        <el-form-item v-if="action.commentRequired" label="办理说明" required :error="errors?.commentError">
          <el-input v-model="comment" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
    </div>
    <template #footer>
      <el-button :disabled="dismissLocked" @click="dismiss">取消</el-button>
      <el-button v-if="refreshRequired" type="primary" :loading="submitting" @click="emit('refresh')">刷新工单</el-button>
      <el-button v-else type="primary" :loading="submitting" :disabled="confirmDisabled" @click="submit">
        {{ retryOnly ? '重试原操作' : `确认${action?.title ?? '办理'}` }}
      </el-button>
    </template>
  </el-dialog>
</template>

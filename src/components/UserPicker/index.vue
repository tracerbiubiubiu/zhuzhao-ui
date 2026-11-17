<template>
  <div class="inline-block align-top">
    <el-select
      :model-value="modelValue"
      filterable remote clearable
      :remote-method="session.search"
      :loading="session.state.loading"
      :disabled="!contextReady"
      placeholder="输入至少2字姓名/工号/用户名"
      class="!w-full"
      data-testid="user-picker"
      @visible-change="dropdownChanged"
      @update:model-value="emit('update:modelValue', $event || '')"
    >
      <el-option v-for="u in session.state.options" :key="u.id" :value="u.id" :label="u.label" />
      <template #empty><div class="p-2 text-xs text-gray-500">{{ hint }}</div></template>
    </el-select>
    <div v-if="hint" role="status" data-testid="people-search-status" class="text-xs mt-1" :class="failed ? 'text-red-500' : 'text-gray-500'">{{ hint }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onDeactivated, onUnmounted, ref, watch } from 'vue'
import { ElOption, ElSelect } from 'element-plus'
import { searchManagedPeopleApi, searchTicketPeopleApi, type TicketPeopleContext } from '@/api/ticket/people'
import { createPeopleSearch } from './searchSession'

const props = withDefaults(defineProps<{ modelValue: string; context?: TicketPeopleContext; active?: boolean }>(), { active: true })
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()
const live = ref(true)
const contextReady = computed(() => {
  if (!props.active || !live.value) return false
  if (!props.context) return true // Management use retains the original GET /users authorization.
  if ('ticketId' in props.context) return /^[1-9]\d*$/.test(props.context.ticketId)
  return /^[1-9]\d*$/.test(props.context.orgId) && (!('typeCode' in props.context) || !!props.context.typeCode)
})
const session = createPeopleSearch((term) => {
  // Capture the request context before the first await; no fallback from a business 403.
  const context = props.context
  return context ? searchTicketPeopleApi({ ...context }, term) : searchManagedPeopleApi(term)
})
watch(() => JSON.stringify([props.context, contextReady.value]), (_, old) => {
  session.reset(contextReady.value)
  if (old !== undefined && props.modelValue) emit('update:modelValue', '')
}, { immediate: true, flush: 'sync' })
onActivated(() => { live.value = true })
onDeactivated(() => { live.value = false })
onUnmounted(() => session.reset(false))

function dropdownChanged(visible: boolean) {
  if (visible) return
  const selected = session.state.options.filter((row) => row.id === props.modelValue)
  session.reset(contextReady.value)
  session.state.options = selected // Keep the chosen display label, but invalidate all pending requests.
}
const failed = computed(() => ['forbidden', 'missing', 'error'].includes(session.state.status))
const hint = computed(() => ({
  input: '请输入2–50个字符搜索，最多显示20人',
  context: '请先选择有效的工单或目标组织（建票还需选择类型）',
  loading: '正在搜索…',
  ready: '',
  empty: '没有匹配的可选人员',
  forbidden: '无权为当前动作选择人员',
  missing: '当前工单或类型不存在或不可见',
  error: '人员搜索失败，请重新输入重试',
})[session.state.status])
</script>

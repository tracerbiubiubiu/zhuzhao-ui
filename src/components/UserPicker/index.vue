<template>
  <el-select
    :model-value="modelValue"
    filterable
    remote
    clearable
    :remote-method="search"
    :loading="loading"
    placeholder="输入姓名拼音/工号/用户名搜索"
    class="!w-full"
    data-testid="user-picker"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-option
      v-for="u in options"
      :key="u.id"
      :value="u.id"
      :label="u.display"
    />
  </el-select>
</template>

<script setup lang="ts">
/**
 * UserPicker 人员补全件（B1-2——01 号 §3.2"指派/抄送/参与人选人走既有用户搜索端点"）。
 *
 * 替换 detail 页分派对话框的手输数字 ID；remote 搜索走 GET /users
 * （username/employee_no 过滤分流：纯数字按工号、否则按用户名前缀——
 * 后端无通用 keyword 参数，双字段各查合并去重）。M-HR 对接后本地人员
 * 数据补全零额外对接（01 号 §3.2 既定）。
 */
import { ref } from 'vue'
import { ElOption, ElSelect } from 'element-plus'
import { listUsersApi, type UserRow } from '@/api/system/user'

defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const loading = ref(false)
const options = ref<Array<{ id: string; display: string }>>([])

async function search(q: string) {
  const term = q.trim()
  if (!term) {
    options.value = []
    return
  }
  loading.value = true
  try {
    // 纯数字 → 工号；否则用户名（两次查询合并去重，各取首页）
    const queries: Array<{ username?: string; employee_no?: string }> = /^\d+$/.test(term)
      ? [{ employee_no: term }]
      : [{ username: term }]
    const merged = new Map<string, { id: string; display: string }>()
    for (const params of queries) {
      const r = await listUsersApi({ page: 1, page_size: 20, ...params }).catch(() => null)
      for (const u of (r?.list ?? []) as UserRow[]) {
        merged.set(u.id, { id: u.id, display: `${u.real_name || u.username}（${u.employee_no}）` })
      }
    }
    options.value = [...merged.values()]
  } finally {
    loading.value = false
  }
}
</script>

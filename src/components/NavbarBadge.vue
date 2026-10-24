<script setup lang="ts">
/**
 * NavbarBadge 全局待办角标（S10 B10-3——10 号附录 A.4）：
 * 60s 轮询 GET /badges（sections 开放 map——未知 section 忽略向前兼容）；
 * 点击跳工单列表 assignee=me。轮询失败静默（角标是提示面，不弹错）。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElBadge } from 'element-plus'
import { Icon } from '@iconify/vue'
import { getBadgesApi } from '@/api/ticket'

const router = useRouter()
const todo = ref(0)
const unread = ref(0)
let timer: number | undefined

async function refresh() {
  try {
    const sections = await getBadgesApi()
    if (typeof sections.todo === 'number') todo.value = sections.todo
    if (typeof sections.unread === 'number') unread.value = sections.unread
  } catch {
    // 提示面——静默（下轮重试）
  }
}

onMounted(() => {
  void refresh()
  timer = window.setInterval(() => void refresh(), 60_000)
})
onUnmounted(() => {
  if (timer !== undefined) window.clearInterval(timer)
})

function goTodo() {
  void router.push({ path: '/tickets', query: { assignee: 'me' } })
}

function goInbox() {
  void router.push({ path: '/messages' })
}
</script>

<template>
  <button
    class="navbar-badge header-action"
    data-testid="navbar-badge"
    title="站内消息（未读）"
    @click="goInbox"
  >
    <el-badge :value="unread" :hidden="unread === 0" :max="99" type="danger" data-testid="badge-unread">
      <Icon icon="mdi:bell-outline" color="var(--top-header-text-color)" :height="18" />
    </el-badge>
  </button>
  <button
    class="navbar-badge header-action"
    data-testid="navbar-todo"
    title="待办工单"
    @click="goTodo"
  >
    <el-badge :value="todo" :hidden="todo === 0" :max="99" type="warning">
      <Icon icon="mdi:clipboard-check-outline" color="var(--top-header-text-color)" :height="18" />
    </el-badge>
  </button>
</template>

<style scoped>
.navbar-badge {
  height: 100%;
  padding: 0 10px;
  display: flex;
  align-items: center;
  background: transparent;
  border: none;
  cursor: pointer;
}
.navbar-badge:hover {
  background: var(--top-header-hover-color);
}
</style>

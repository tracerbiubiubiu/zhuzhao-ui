<script setup lang="ts">
/**
 * NavbarBadge 全局待办角标（S10 B10-3——10 号附录 A.4）：
 * 60s 轮询 GET /badges（sections 开放 map——未知 section 忽略向前兼容）；
 * 消息写操作失效 ['badge'] 后立即重取；后台仍按 60s 同步。
 * 待办跳工单列表 assignee=me + exclude_statuses=closed,rejected，与角标计数同口径。
 * 请求错误沿用统一请求层提示；重取失败保留上次成功数据。
 */
import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { useRouter } from 'vue-router'
import { ElBadge } from 'element-plus'
import { Icon } from '@iconify/vue/offline'
import { getBadgesApi } from '@/api/ticket'

const router = useRouter()
const badges = useQuery({
  queryKey: ['badge'],
  queryFn: getBadgesApi,
  refetchInterval: 60_000,
})
const todo = computed(() => typeof badges.data.value?.todo === 'number' ? badges.data.value.todo : 0)
const unread = computed(() => typeof badges.data.value?.unread === 'number' ? badges.data.value.unread : 0)

function goTodo() {
  void router.push({ path: '/tickets', query: { assignee: 'me', exclude_statuses: 'closed,rejected' } })
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
    :aria-label="`站内消息（${unread}条未读）`"
    @click="goInbox"
  >
    <el-badge :value="unread" :hidden="unread === 0" :max="99" type="danger" data-testid="badge-unread">
      <Icon icon="mdi:bell-outline" color="var(--top-header-text-color)" :height="18" />
    </el-badge>
  </button>
  <button
    class="navbar-badge header-action"
    data-testid="navbar-todo"
    title="待办工单（分派给我，排除已关闭和已驳回）"
    :aria-label="`待办工单（${todo}条，排除已关闭和已驳回）`"
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

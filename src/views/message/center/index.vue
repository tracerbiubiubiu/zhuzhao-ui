<script setup lang="ts">
/**
 * 消息中心（S6 二期 B6-7——双 tab：通知=事件快照读过即完 / 待办=状态派生
 * 无已读概念[GitLab To-dos vs GitHub Notifications 语义分离——06 号 §6]）。
 * 通知行=摘要+时间+深链（link 直跳）；单条点击即读+全部已读。
 * 待办 tab 数据源=S10 角标同源（assignee=me 列表——状态派生非快照）。
 */
import { formatDateTime } from '@/utils/datetime'
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  ElButton, ElCard, ElCheckbox, ElEmpty, ElMessage, ElPagination, ElTabPane, ElTabs, ElTag,
} from 'element-plus'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  listNotificationsApi, markAllNotificationsReadApi, markNotificationReadApi,
  type NotificationRow,
} from '@/api/message'
import { listTicketsApi, STATUS_LABEL } from '@/api/ticket'

// keep-alive 契约：name=动态路由名（菜单 code message_center）
defineOptions({ name: 'message_center_page' })

const router = useRouter()
const queryClient = useQueryClient()
const activeTab = ref<'notifications' | 'todos'>('notifications')
const onlyUnread = ref(false)
const page = reactive({ current: 1, size: 20 })

const inboxQuery = useQuery({
  queryKey: computed(() => ['message', 'inbox', page.current, page.size, onlyUnread.value]),
  queryFn: () => listNotificationsApi({ page: page.current, page_size: page.size, unread: onlyUnread.value || undefined }),
})

// 待办 tab：assignee=me 未关闭（状态派生——无已读概念）
const todosQuery = useQuery({
  queryKey: ['message', 'todos'],
  queryFn: () => listTicketsApi({ page: 1, page_size: 50, assignee: 'me' }),
  enabled: computed(() => activeTab.value === 'todos'),
})

async function refresh() {
  await queryClient.invalidateQueries({ queryKey: ['message'] })
  await queryClient.invalidateQueries({ queryKey: ['badge'] })
}

function openItem(n: NotificationRow) {
  if (!n.read_at) void markNotificationReadApi(n.id).then(refresh)
  if (n.link) void router.push(n.link)
}

async function readAll() {
  const n = await markAllNotificationsReadApi()
  ElMessage.success(`已置 ${n} 条为已读`)
  await refresh()
}

function goTodo(row: { id: string; status: string }) {
  void router.push(`/tickets/${row.id}`)
}

const timeText = (t: string) => formatDateTime(t)
</script>

<template>
  <div class="fill-page p-4">
    <el-card shadow="never" class="fill-card">
      <el-tabs v-model="activeTab">
        <el-tab-pane :label="`通知${inboxQuery.data.value?.total ? `（${inboxQuery.data.value.total}）` : ''}`" name="notifications">
          <div class="mb-2 flex items-center gap-2">
            <el-checkbox v-model="onlyUnread" @change="page.current = 1">仅未读</el-checkbox>
            <div class="flex-1" />
            <el-button size="small" data-testid="read-all" @click="readAll">全部已读</el-button>
          </div>
          <div v-loading="inboxQuery.isLoading.value" class="min-h-[300px]">
            <div
              v-for="n in inboxQuery.data.value?.list ?? []"
              :key="n.id"
              class="msg-row"
              :class="{ 'msg-row--unread': !n.read_at }"
              :data-testid="`msg-${n.id}`"
              @click="openItem(n)"
            >
              <span class="msg-dot" :class="{ 'msg-dot--unread': !n.read_at }" />
              <span class="flex-1">{{ n.title }}</span>
              <el-tag v-if="n.biz_type" size="small" type="info" class="mr-2">{{ n.biz_type }}</el-tag>
              <span class="text-xs text-gray-400">{{ timeText(n.created_at) }}</span>
            </div>
            <el-empty v-if="!inboxQuery.isLoading.value && !(inboxQuery.data.value?.list ?? []).length" description="暂无消息" />
          </div>
          <div class="mt-2 flex justify-end">
            <el-pagination
              v-model:current-page="page.current" v-model:page-size="page.size"
              :total="inboxQuery.data.value?.total ?? 0" layout="prev, pager, next"
              @current-change="() => inboxQuery.refetch()"
            />
          </div>
        </el-tab-pane>

        <el-tab-pane :label="`待办（${todosQuery.data.value?.total ?? 0}）`" name="todos" lazy>
          <div v-loading="todosQuery.isLoading.value" class="min-h-[300px]">
            <div v-for="t in todosQuery.data.value?.list ?? []" :key="t.id" class="msg-row" @click="goTodo(t)">
              <span class="flex-1">#{{ t.id }} {{ t.title }}</span>
              <el-tag size="small" class="mr-2">{{ STATUS_LABEL[t.status] ?? t.status }}</el-tag>
              <span class="text-xs text-gray-400">{{ timeText(t.created_at) }}</span>
            </div>
            <el-empty v-if="!todosQuery.isLoading.value && !(todosQuery.data.value?.list ?? []).length" description="暂无待办" />
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<style scoped>
.msg-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  cursor: pointer;
  font-size: 14px;
}
.msg-row:hover { background: var(--el-fill-color-light); }
.msg-row--unread { font-weight: 600; }
.msg-dot { width: 8px; height: 8px; border-radius: 50%; background: transparent; flex-shrink: 0; }
.msg-dot--unread { background: var(--el-color-danger); }
</style>

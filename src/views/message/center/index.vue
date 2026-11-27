<script setup lang="ts">
/**
 * 消息中心（S6 二期 B6-7——双 tab：通知=事件快照读过即完 / 待办=状态派生
 * 无已读概念[GitLab To-dos vs GitHub Notifications 语义分离——06 号 §6]）。
 * 通知行=摘要+时间+深链（link 直跳）；单条点击即读+全部已读。
 * 待办 tab 数据源=S10 角标同源（assignee=me 列表——状态派生非快照）。
 */
import { apiErrorMessage, apiReadError } from '@/utils/apiError'
import { formatDateTime } from '@/utils/datetime'
import { compareInt64Desc } from '@/utils/int64'
import { computed, onActivated, onDeactivated, onMounted, onScopeDispose, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  ElAlert, ElButton, ElCard, ElCheckbox, ElDrawer, ElEmpty, ElMessage, ElPagination, ElTabPane, ElTabs, ElTag,
} from 'element-plus'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  listNotificationsApi, markAllNotificationsReadApi, markNotificationReadApi,
  getNotificationDeliveryApi, listNotificationOptoutsApi, setNotificationOptoutApi,
  type NotificationDelivery, type NotificationRow,
} from '@/api/message'
import { listTicketsApi, STATUS_LABEL, type TicketListQuery, type TicketRow } from '@/api/ticket'

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
// 换页时 Query 暂无当前页数据，不能把未知总数传成 0 触发分页组件回到首页。
const inboxTotal = ref<number | null>(null)
watch(inboxQuery.data, data => {
  if (data) inboxTotal.value = data.total
}, { immediate: true })

// 待办 tab：assignee=me 未关闭（状态派生——无已读概念）。
// 2026-10-31 M-4 修复：原 page_size:50 单查询混入已关闭单且超 50 静默截断（total 与
// 列表不一致）——对齐首页待办口径（assigned+in_progress）。分页=「按后端排序键
// （id DESC）多页拉取的 top-K 归并」：page_size 超 100 后端会重置为 20（非截断），
// fetchTop 多页兜住上限；归并键与后端排序键一致（int64 string→数值比较）保证切片正确
const todoPage = ref(1)
const TODO_PAGE_SIZE = 20

/** 按给定筛选拉取后端序（id DESC）前 n 条及总数——page_size 超 100 后端重置为 20，多页兜住。
 * size 必须逐页固定：后端 OFFSET=(page-1)*page_size，页间变 size 会使 offset 交错重复
 * （2026-10-31 二轮复审实证——末页收尾用小 size 会把 20-39 段重复拉一遍） */
async function fetchTop(q: TicketListQuery, n: number): Promise<{ rows: TicketRow[]; total: number }> {
  const size = Math.min(100, n) // 逐页固定——offset 连续不重不漏
  const rows: TicketRow[] = []
  let total = 0
  for (let pageNo = 1; rows.length < n; pageNo++) {
    const r = await listTicketsApi({ ...q, page: pageNo, page_size: size })
    total = r.total
    rows.push(...r.list)
    if (r.list.length < size) break // 不足页=源耗尽
  }
  return { rows: rows.slice(0, n), total }
}

const todosQuery = useQuery({
  queryKey: computed(() => ['message', 'todos', todoPage.value]),
  queryFn: async () => {
    const requestedPage = todoPage.value
    const budget = requestedPage * TODO_PAGE_SIZE
    const [{ rows: assigned, total: assignedTotal }, { rows: inProgress, total: inProgressTotal }] = await Promise.all([
      fetchTop({ status: 'assigned', assignee: 'me' }, budget),
      fetchTop({ status: 'in_progress', assignee: 'me' }, budget),
    ])
    // 严格弱序比较器（相等返回 0）；归并键=后端排序键 id DESC
    const merged = [...assigned, ...inProgress].sort((a, b) => compareInt64Desc(a.id, b.id))
    const start = (requestedPage - 1) * TODO_PAGE_SIZE
    return { list: merged.slice(start, start + TODO_PAGE_SIZE), total: assignedTotal + inProgressTotal }
  },
  enabled: computed(() => activeTab.value === 'todos'),
})

const inboxError = computed(() => inboxQuery.isError.value ? apiReadError(inboxQuery.error.value) : '')
const inboxRows = computed(() => inboxError.value ? [] : inboxQuery.data.value?.list ?? [])
const todoError = computed(() => todosQuery.isError.value ? apiReadError(todosQuery.error.value) : '')
const todoRows = computed(() => todoError.value ? [] : todosQuery.data.value?.list ?? [])

const deliveryStates = new Map([
  ['pending', '待投递'], ['sending', '发送中'], ['accepted', '已受理'], ['delivered', '已送达'],
  ['failed', '发送失败'], ['unknown', '结果未知'], ['suppressed', '已抑制'],
])
const delivery = reactive({ id: '', result: null as NotificationDelivery | null, loading: false, error: '' })
const deliveryLabel = computed(() => delivery.result ? deliveryStates.get(delivery.result.state) ?? '状态未知' : '')
let deliverySeq = 0

function closeDelivery() {
  deliverySeq++
  Object.assign(delivery, { id: '', result: null, loading: false, error: '' })
}

async function openDelivery(id: string) {
  if (!id) return
  closeDelivery()
  delivery.id = id
  await loadDelivery()
}

async function loadDelivery() {
  if (!delivery.id || delivery.loading) return
  const id = delivery.id
  const seq = ++deliverySeq
  delivery.loading = true
  delivery.error = ''
  try {
    const result = await getNotificationDeliveryApi(id)
    if (seq !== deliverySeq) return
    if (result?.delivery_id !== id) {
      delivery.result = null
      delivery.error = '投递记录与查询编号不一致'
      return
    }
    delivery.result = result
  } catch (error) {
    if (seq === deliverySeq) {
      delivery.result = null
      delivery.error = apiReadError(error, '查询投递状态失败，请重试', '投递记录不可查看')
    }
  } finally {
    if (seq === deliverySeq) delivery.loading = false
  }
}

const reviewOptout = { biz_type: 'ticket', event_action: 'ticket.review_requested' }
const reviewPreference = reactive({ ready: false, optedOut: false, allOptedOut: false, loading: false, saving: false, error: '' })
let preferenceSeq = 0

async function loadReviewPreference() {
  if (reviewPreference.loading || reviewPreference.saving) return
  const seq = ++preferenceSeq
  Object.assign(reviewPreference, { ready: false, loading: true, error: '' })
  try {
    const entries = await listNotificationOptoutsApi()
    if (seq !== preferenceSeq) return
    reviewPreference.optedOut = entries.some(e => e.biz_type === reviewOptout.biz_type && e.event_action === reviewOptout.event_action)
    reviewPreference.allOptedOut = entries.some(e => e.biz_type === reviewOptout.biz_type && e.event_action === '*')
    reviewPreference.ready = true
  } catch (error) {
    if (seq === preferenceSeq) reviewPreference.error = apiReadError(error, '加载通知偏好失败，请重试')
  } finally {
    if (seq === preferenceSeq) reviewPreference.loading = false
  }
}

async function setReviewPreference(optedOut: boolean) {
  if (!reviewPreference.ready || reviewPreference.saving || reviewPreference.allOptedOut) return
  const seq = ++preferenceSeq
  Object.assign(reviewPreference, { saving: true, error: '' })
  try {
    await setNotificationOptoutApi({ ...reviewOptout, opt_out: optedOut })
    if (seq === preferenceSeq) reviewPreference.optedOut = optedOut
  } catch (error) {
    if (seq === preferenceSeq) reviewPreference.error = apiErrorMessage(error, '保存通知偏好失败，请重试')
  } finally {
    if (seq === preferenceSeq) reviewPreference.saving = false
  }
}

function clearDetails() {
  closeDelivery()
  preferenceSeq++
  Object.assign(reviewPreference, { ready: false, optedOut: false, allOptedOut: false, loading: false, saving: false, error: '' })
}

onMounted(loadReviewPreference)
onActivated(() => { if (!reviewPreference.ready) void loadReviewPreference() })
onDeactivated(clearDetails)
onScopeDispose(clearDetails)

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
          <div class="mb-2 flex flex-wrap items-center gap-2">
            <el-checkbox v-model="onlyUnread" @change="page.current = 1">仅未读</el-checkbox>
            <el-checkbox
              :model-value="reviewPreference.optedOut || reviewPreference.allOptedOut"
              :disabled="!reviewPreference.ready || reviewPreference.saving || reviewPreference.allOptedOut"
              @change="setReviewPreference($event === true)"
            >退订工单待复核外送提醒</el-checkbox>
            <span v-if="reviewPreference.allOptedOut" class="text-xs">工单外送通知已全部退订</span>
            <span v-if="reviewPreference.saving" role="status" class="text-xs">正在保存偏好</span>
            <div class="flex-1" />
            <el-button size="small" data-testid="read-all" @click="readAll">全部已读</el-button>
          </div>
          <el-alert v-if="reviewPreference.error" :title="reviewPreference.error" type="error" :closable="false" class="mb-2">
            <el-button size="small" @click="loadReviewPreference">查询当前偏好</el-button>
          </el-alert>
          <div v-loading="inboxQuery.isLoading.value" class="min-h-[300px]">
            <el-alert v-if="inboxError" :title="inboxError" type="error" :closable="false"><el-button size="small" @click="inboxQuery.refetch()">重试</el-button></el-alert>
            <div
              v-for="n in inboxRows"
              :key="n.id"
              class="msg-row"
              :class="{ 'msg-row--unread': !n.read_at }"
              :data-testid="`msg-${n.id}`"
              @click="openItem(n)"
            >
              <span class="msg-dot" :class="{ 'msg-dot--unread': !n.read_at }" aria-hidden="true" />
              <button type="button" class="msg-title" @click.stop="openItem(n)">{{ n.title }}</button>
              <el-button v-if="n.delivery_id" link type="primary" size="small" @click.stop="openDelivery(n.delivery_id)">查询投递状态</el-button>
              <el-tag v-if="n.biz_type" size="small" type="info" class="mr-2">{{ n.biz_type }}</el-tag>
              <span class="text-xs text-gray-400">{{ timeText(n.created_at) }}</span>
            </div>
            <el-empty v-if="!inboxQuery.isLoading.value && !inboxError && !inboxRows.length" description="暂无消息" />
          </div>
          <div v-if="inboxTotal !== null && !inboxError" class="mt-2 flex justify-end">
            <el-pagination
              v-model:current-page="page.current" v-model:page-size="page.size"
              :total="inboxTotal" layout="total, prev, pager, next"
            />
          </div>
        </el-tab-pane>

        <el-tab-pane :label="todoError ? '待办' : `待办（${todosQuery.data.value?.total ?? 0}）`" name="todos" lazy>
          <div v-loading="todosQuery.isLoading.value" class="min-h-[300px]">
            <el-alert v-if="todoError" :title="todoError" type="error" :closable="false"><el-button size="small" @click="todosQuery.refetch()">重试</el-button></el-alert>
            <div v-for="t in todoRows" :key="t.id" class="msg-row" @click="goTodo(t)">
              <span class="flex-1">#{{ t.id }} {{ t.title }}</span>
              <el-tag size="small" class="mr-2">{{ STATUS_LABEL[t.status] ?? t.status }}</el-tag>
              <span class="text-xs text-gray-400">{{ timeText(t.created_at) }}</span>
            </div>
            <el-empty v-if="!todosQuery.isLoading.value && !todoError && !todoRows.length" description="暂无待办" />
            <el-pagination
              v-if="(todosQuery.data.value?.total ?? 0) > TODO_PAGE_SIZE"
              class="mt-2 justify-end"
              layout="prev, pager, next"
              :total="todosQuery.data.value?.total ?? 0"
              :page-size="TODO_PAGE_SIZE"
              :current-page="todoPage"
              @current-change="(p: number) => (todoPage = p)"
            />
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>
    <el-drawer
      :model-value="!!delivery.id"
      title="消息投递状态"
      size="min(560px, 100vw)"
      @update:model-value="!$event && closeDelivery()"
    >
      <el-alert v-if="delivery.error" :title="delivery.error" type="error" :closable="false" class="mb-2" />
      <div role="status" :aria-busy="delivery.loading">
        <p v-if="delivery.loading">正在查询原投递记录</p>
        <dl v-else-if="delivery.result" class="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-2">
          <dt>状态</dt><dd class="m-0 font-semibold">{{ deliveryLabel }}</dd>
          <dt>投递编号</dt><dd class="m-0 break-all">{{ delivery.id }}</dd>
          <dt>最近更新</dt><dd class="m-0">{{ timeText(delivery.result.updated_at) }}</dd>
        </dl>
        <p v-if="!delivery.loading && delivery.result?.state === 'accepted'">渠道已受理，等待送达凭证。</p>
        <p v-if="!delivery.loading && delivery.result?.state === 'unknown'">暂时无法确认投递结果。</p>
      </div>
      <el-button class="mt-4" :loading="delivery.loading" @click="loadDelivery">查询原记录</el-button>
    </el-drawer>
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
.msg-title {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  overflow-wrap: anywhere;
  cursor: pointer;
  text-align: left;
}
.msg-dot { width: 8px; height: 8px; border-radius: 50%; background: transparent; flex-shrink: 0; }
.msg-dot--unread { background: var(--el-color-danger); }
@media (max-width: 600px) {
  .msg-row { flex-wrap: wrap; }
  .msg-title { flex-basis: calc(100% - 16px); }
}
</style>

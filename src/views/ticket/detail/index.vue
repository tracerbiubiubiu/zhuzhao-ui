<script setup lang="ts">
/**
 * 工单详情（P4-W4 首批=只读基础展示；完整批扩评论/备注/关联/流转——03 S10/S11：
 * 评论无分页按全部展示、三态经 API 不可达流转只做分派/取消/关闭/更新/删除、
 * 状态机从 transitions JSONB 构建勿写死、勿规划事件轴）
 * 静态路由（§3.2④，菜单外——入口在列表页「详情」按钮，挂 ticket:read 码）
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { ElButton, ElCard, ElDescriptions, ElDescriptionsItem, ElTag } from 'element-plus'
import { useQuery } from '@tanstack/vue-query'
import { getTicketApi, listTicketTypesApi, STATUS_LABEL } from '@/api/ticket'

// keep-alive 契约：name=静态路由名（参数路由——同工单不同 ID 依赖 :key 路由 fullPath 分实例）
defineOptions({ name: 'TicketDetail' })

const route = useRoute()
const ticketId = computed(() => String(route.params.id ?? ''))

// 路由参数变化时按新 ID 拉取（queryKey 随 id）
const ticketQuery = useQuery({
  queryKey: computed(() => ['ticket', 'detail', ticketId.value]),
  queryFn: () => getTicketApi(ticketId.value),
  enabled: computed(() => ticketId.value !== '' && ticketId.value !== 'new'),
})
const typesQuery = useQuery({ queryKey: ['ticket', 'types'], queryFn: listTicketTypesApi })

const ticket = computed(() => ticketQuery.data.value)
const typeLabel = computed(
  () => typesQuery.data.value?.find((t) => t.code === ticket.value?.type_code)?.name ?? ticket.value?.type_code ?? '—',
)

function formatTime(iso?: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

</script>

<template>
  <div class="p-4" v-loading="ticketQuery.isLoading.value">
    <el-card shadow="never" class="mb-4">
      <template #header>
        <div class="flex items-center gap-3">
          <span class="font-semibold">#{{ ticketId }} {{ ticket?.title ?? '…' }}</span>
          <el-tag v-if="ticket" size="small">{{ STATUS_LABEL[ticket.status] ?? ticket.status }}</el-tag>
          <el-button link size="small" @click="$router.back()">返回</el-button>
        </div>
      </template>
      <el-descriptions :column="3" border>
        <el-descriptions-item label="类型">{{ typeLabel }}</el-descriptions-item>
        <el-descriptions-item label="优先级">{{ ticket?.priority ?? '—' }}</el-descriptions-item>
        <el-descriptions-item label="SLA 截止">
          <span :class="ticket?.sla_due_at && ticket.status !== 'closed' ? 'text-[var(--el-color-danger)]' : ''">
            {{ formatTime(ticket?.sla_due_at) }}
          </span>
        </el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ formatTime(ticket?.created_at) }}</el-descriptions-item>
        <el-descriptions-item label="更新时间">{{ formatTime(ticket?.updated_at) }}</el-descriptions-item>
        <el-descriptions-item label="处理人">{{ ticket?.assigned_to ?? '未分派' }}</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card shadow="hover">
      <template #header><span class="font-semibold">描述</span></template>
      <pre class="whitespace-pre-wrap text-sm">{{ ticket?.description || '（无描述）' }}</pre>
    </el-card>
  </div>
</template>

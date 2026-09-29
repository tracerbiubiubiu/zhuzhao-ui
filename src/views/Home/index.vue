<script setup lang="ts">
/**
 * 首页工作台（01 §8-W2 拍板：简单仪表盘）
 *
 * 首版 = 可见工单状态统计卡（按 status 各拉一次 total——权宜，聚合端点=触发驱动）
 * + 最近工单列表（前 10 条）
 * 待办/已办卡已随 P4-W4 `assignee=me` 后端参数点亮（02 §2-W4 随批件）：
 * 待办=分派给我且未关闭（assigned+in_progress），已办=分派给我且已关闭（closed）
 */

import { ref, onMounted } from 'vue'
import { ElCard, ElCol, ElRow, ElTable, ElTableColumn, ElTag, ElEmpty } from 'element-plus'
import request from '@vea/request'

// keep-alive 契约：name=最深匹配路由名（home 菜单为 type=1 带 component 特例——
// §3.2③ 渲染子路由名 `${code}_page`，tagsView.cachedViews 存的即它）
defineOptions({ name: 'home_page' })

interface TicketSummary {
  id: string
  title: string
  status: string
  priority: number
  created_at: string
}

const STATUS_LABELS: Record<string, string> = {
  open: '待处理', assigned: '已分派', in_progress: '进行中',
  pending_verify: '待验证', closed: '已关闭', rejected: '已驳回',
}
const PRIORITY_LABELS = ['', '紧急', '高', '中', '低']
const PRIORITY_TYPES: Array<'primary' | 'success' | 'info' | 'warning' | 'danger'> = ['info', 'danger', 'warning', 'info', 'success']

const stats = ref<Record<string, number>>({})
const recent = ref<TicketSummary[]>([])
const myTodo = ref(0)
const myDone = ref(0)
const loading = ref(true)

const statusCardDefs = [
  { key: 'open', label: '待处理', icon: '🔔', color: '#e6a23c' },
  { key: 'assigned', label: '已分派', icon: '👤', color: '#409eff' },
  { key: 'in_progress', label: '进行中', icon: '⚙️', color: '#909399' },
  { key: 'closed', label: '已关闭', icon: '✅', color: '#67c23a' },
]

onMounted(async () => {
  loading.value = true
  try {
    // 并行拉状态统计（权宜：每状态一次 total——后端无聚合端点）
    const statResults = await Promise.allSettled(
      statusCardDefs.map(({ key }) =>
        request.get(`/api/v1/tickets`, { params: { status: key, page: 1, page_size: 1 } })
      )
    )
    statResults.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        const data = result.value as { total?: number }
        stats.value[statusCardDefs[i].key] = data?.total ?? 0
      } else {
        stats.value[statusCardDefs[i].key] = 0
      }
    })
    // 我的待办/已办（W4 P1-c：assignee=me——待办=assigned+in_progress，已办=closed）
    const meQueries = ['assigned', 'in_progress', 'closed']
    const meResults = await Promise.allSettled(
      meQueries.map((status) =>
        request.get('/api/v1/tickets', { params: { status, assignee: 'me', page: 1, page_size: 1 } })
      )
    )
    const meTotals = meResults.map((r) =>
      r.status === 'fulfilled' ? ((r.value as { total?: number })?.total ?? 0) : 0
    )
    myTodo.value = meTotals[0] + meTotals[1]
    myDone.value = meTotals[2]
    // 最近工单
    const recentResult = await Promise.allSettled([
      request.get('/api/v1/tickets', { params: { page: 1, page_size: 10 } }),
    ])
    const recentData = recentResult[0].status === 'fulfilled' ? recentResult[0].value : null
    recent.value = ((recentData as { list?: TicketSummary[] })?.list ?? []).map((t) => ({
      ...t,
    }))
  } finally {
    loading.value = false
  }
})

function formatTime(iso: string): string {
  return iso?.replace('T', ' ').slice(0, 16) ?? ''
}
</script>

<template>
  <div class="p-4">
    <el-row :gutter="16" class="mb-4">
      <el-col v-for="card in statusCardDefs" :key="card.key" :span="6">
        <el-card shadow="hover" class="cursor-pointer">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-2xl font-bold" :style="{ color: card.color }">
                {{ loading ? '—' : (stats[card.key] ?? 0) }}
              </div>
              <div class="text-sm text-gray-500 mt-1">{{ card.label }}</div>
            </div>
            <span class="text-3xl">{{ card.icon }}</span>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 我的待办/已办（W4 P1-c assignee=me 点亮） -->
    <el-row :gutter="16" class="mb-4">
      <el-col :span="12">
        <el-card shadow="hover">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-2xl font-bold" style="color: var(--el-color-danger)">
                {{ loading ? '—' : myTodo }}
              </div>
              <div class="text-sm text-gray-500 mt-1">我的待办（分派给我，未关闭）</div>
            </div>
            <span class="text-3xl">📋</span>
          </div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="hover">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-2xl font-bold" style="color: var(--el-color-success)">
                {{ loading ? '—' : myDone }}
              </div>
              <div class="text-sm text-gray-500 mt-1">我的已办（分派给我，已关闭）</div>
            </div>
            <span class="text-3xl">✅</span>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="hover">
      <template #header>
        <span class="font-semibold">最近工单</span>
      </template>
      <el-table v-if="recent.length" :data="recent" stripe size="default">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 'closed' ? 'success' : row.status === 'open' ? 'warning' : 'info'" size="small">
              {{ STATUS_LABELS[row.status] ?? row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="优先级" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="PRIORITY_TYPES[row.priority]" size="small">{{ PRIORITY_LABELS[row.priority] ?? '中' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="160">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="暂无工单" />
    </el-card>
  </div>
</template>

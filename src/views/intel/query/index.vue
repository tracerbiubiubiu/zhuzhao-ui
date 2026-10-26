<script setup lang="ts">
/**
 * 情报查询页（S9 B9-1 菜单行落成页面——viewNames 守卫要求 visible 种子须有
 * 视图文件；B9-1 只交付了查询端点，页面=查询表单+结果 JSON 展示+本机查询历史）。
 *
 * 历史列表为**本机 localStorage 记录**（按 employee_no 隔离、上限 100 条、
 * 同键去重置顶、时间降序）——后端 intel_cache 仅缓存代理无列表端点，跨端
 * 查询史待后端补端点后切换。
 */
import { computed, ref } from 'vue'
import {
  ElButton, ElCard, ElEmpty, ElInput, ElMessage, ElMessageBox, ElOption, ElSelect,
  ElTable, ElTableColumn, ElTag,
} from 'element-plus'
import { useTableFit } from '@vea/hooks'
import { queryIntelApi } from '@/api/intel'
import { useUserStore } from '@/store/modules/user'

// keep-alive 契约：name=动态路由名（菜单 code intel_query）
defineOptions({ name: 'intel_query_page' })

const TYPE_LABELS: Record<string, string> = { ip: 'IP', domain: '域名', hash: 'Hash', url: 'URL' }

const intelType = ref('ip')
const value = ref('')
const loading = ref(false)
const result = ref<unknown>(null)
const stale = ref(false)
const fetchedAt = ref('')
/** 最近一次成功查询的值（结果摘要行展示用——回填历史时与输入框可能不同步） */
const lastValue = ref('')

// ─── 本机查询历史（localStorage 按 employee_no 隔离；时间降序、同键去重置顶）───

interface IntelHistoryEntry {
  type: string
  value: string
  /** 查询时间戳（ms）——列表按此降序 */
  ts: number
  stale: boolean
  hit_count: number
}

const HISTORY_CAP = 100
const userStore = useUserStore()
const historyKey = computed(() => `intel-history:${userStore.profile?.employee_no || 'anonymous'}`)
const historyTable = ref()

function loadHistory(): IntelHistoryEntry[] {
  try {
    const raw = localStorage.getItem(historyKey.value)
    const arr = raw ? (JSON.parse(raw) as IntelHistoryEntry[]) : []
    // 结构不合法的存量数据静默丢弃（本地缓存语义，不阻塞页面）
    return Array.isArray(arr)
      ? arr.filter((e) => e && typeof e.type === 'string' && typeof e.value === 'string' && typeof e.ts === 'number')
      : []
  } catch {
    return []
  }
}

const history = ref<IntelHistoryEntry[]>(loadHistory())

function persistHistory() {
  try {
    localStorage.setItem(historyKey.value, JSON.stringify(history.value))
  } catch {
    // 配额满等写入失败静默忽略——内存列表仍可用，下次成功写入覆盖
  }
}

function recordHistory(entry: IntelHistoryEntry) {
  const idx = history.value.findIndex((e) => e.type === entry.type && e.value === entry.value)
  if (idx >= 0) history.value.splice(idx, 1)
  history.value.unshift(entry)
  if (history.value.length > HISTORY_CAP) history.value.length = HISTORY_CAP
  persistHistory()
}

async function onClearHistory() {
  await ElMessageBox.confirm('确认清空本机查询历史？', '提示', { type: 'warning' })
  history.value = []
  persistHistory()
}

/** 历史行点击/行内按钮 → 回填表单并发起查询（查看型列表行点击直达惯例） */
function rerun(row: IntelHistoryEntry) {
  intelType.value = row.type
  value.value = row.value
  query()
}

useTableFit(historyTable, () => history.value)

// ─── 查询 ───

async function query() {
  const v = value.value.trim()
  if (!v) {
    ElMessage.warning('请输入查询值')
    return
  }
  loading.value = true
  try {
    const data = await queryIntelApi(intelType.value, v)
    result.value = data.result
    stale.value = data.stale
    fetchedAt.value = data.fetched_at
    lastValue.value = v
    recordHistory({ type: intelType.value, value: v, ts: Date.now(), stale: data.stale, hit_count: data.hit_count ?? 0 })
  } catch {
    // 错误 toast 由拦截器统一处理
  } finally {
    loading.value = false
  }
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <div class="fill-page">
    <el-card shadow="never" class="mb-4 !flex-none">
      <template #header><span class="font-semibold">威胁情报查询（缓存代理——先本地缓存后上游）</span></template>
      <div class="flex items-center gap-2 mb-3">
        <el-select v-model="intelType" class="!w-[120px]">
          <el-option label="IP" value="ip" />
          <el-option label="域名" value="domain" />
          <el-option label="Hash" value="hash" />
          <el-option label="URL" value="url" />
        </el-select>
        <el-input
          v-model="value" :placeholder="`查询值（${TYPE_LABELS[intelType] ?? 'IP/域名/hash/url'}）`"
          class="!w-[320px]" maxlength="200" data-testid="intel-value" @keyup.enter="query"
        />
        <el-button type="primary" :loading="loading" data-testid="intel-query" @click="query">查询</el-button>
      </div>
      <template v-if="result">
        <div class="flex items-center gap-2 mb-2 text-xs text-gray-500">
          <el-tag size="small">{{ TYPE_LABELS[intelType] ?? intelType }} · {{ lastValue }}</el-tag>
          <el-tag v-if="stale" type="warning" size="small">陈旧缓存（上游配额耗尽降级）</el-tag>
          <span>数据时间：{{ fetchedAt }}</span>
        </div>
        <pre class="text-xs bg-gray-50 dark:bg-gray-800 p-3 rounded overflow-auto max-h-[360px]">{{ JSON.stringify(result, null, 2) }}</pre>
      </template>
      <el-empty v-else description="输入查询值开始" :image-size="60" />
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-semibold">
            查询历史
            <span class="text-xs text-gray-400 font-normal">本机记录 · 按时间降序 · 点击行重新查询</span>
          </span>
          <el-button v-if="history.length" type="danger" plain size="small" @click="onClearHistory">清空历史</el-button>
        </div>
      </template>
      <div class="min-h-0 flex-initial">
        <el-table
          ref="historyTable" :data="history" height="100%" row-key="ts"
          class="history-table" @row-click="(row: IntelHistoryEntry) => rerun(row)"
        >
          <el-table-column label="查询时间" width="170">
            <template #default="{ row }">{{ formatTs(row.ts) }}</template>
          </el-table-column>
          <el-table-column label="类型" width="90">
            <template #default="{ row }">
              <el-tag size="small" effect="plain">{{ TYPE_LABELS[row.type] ?? row.type }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="查询值" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">{{ row.value }}</template>
          </el-table-column>
          <el-table-column label="缓存状态" width="130">
            <template #default="{ row }">
              <el-tag v-if="row.stale" type="warning" size="small">陈旧缓存</el-tag>
              <span v-else-if="row.hit_count > 0" class="text-xs text-gray-500">命中 {{ row.hit_count }} 次</span>
              <span v-else class="text-xs text-gray-400">首次查询</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="80" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click.stop="rerun(row as IntelHistoryEntry)">查询</el-button>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty description="暂无查询记录——在上方发起首笔查询" :image-size="60" />
          </template>
        </el-table>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
/* 行点击重查——查看型列表行指针样式惯例 */
.history-table :deep(.el-table__row) {
  cursor: pointer;
}
</style>

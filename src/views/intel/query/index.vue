<script setup lang="ts">
/**
 * 情报查询页（S9 B9-1 菜单行落成页面——viewNames 守卫要求 visible 种子须有
 * 视图文件；B9-1 只交付了查询端点，页面=查询表单+结果展示+本机查询流水）。
 *
 * 查询流水为**本机 localStorage 追加式日志**（按 employee_no 隔离、每笔一条、
 * 时间降序、不可删除、上限 500 条滚动淘汰最旧）——后端 intel_cache 仅缓存
 * 代理无列表端点，跨端查询史待后端补端点后切换。附：今日/周/月/累计查询
 * 次数徽标 + 趋势抽屉（日粒度柱状图，近 7/14/30 天可切）、类型/关键字/
 * 日期范围即时筛选、结果「结构化 / 原始 JSON」双视图（原始便于复制粘贴）。
 */
import { formatDateTime, formatDateTimeShort } from '@/utils/datetime'
import { computed, ref } from 'vue'
import {
  ElButton, ElCard, ElDatePicker, ElDrawer, ElEmpty, ElInput, ElMessage, ElOption,
  ElRadioButton, ElRadioGroup, ElSelect, ElTable, ElTableColumn, ElTag,
ElPagination, ElTabPane, ElTabs,
} from 'element-plus'
import { useTableFit, useDatePresetRange} from '@vea/hooks'
import { queryIntelApi } from '@/api/intel'
import { useUserStore } from '@/store/modules/user'
import IntelResult from './IntelResult.vue'

// keep-alive 契约：name=动态路由名（菜单 code intel_query）
defineOptions({ name: 'intel_query_page' })

const TYPE_LABELS: Record<string, string> = { ip: 'IP', domain: '域名', hash: 'Hash', url: 'URL' }

const intelType = ref('ip')
const value = ref('')
const loading = ref(false)
const result = ref<unknown>(null)
const stale = ref(false)
const fetchedAt = ref('')
const expiresAt = ref('')
const hitCount = ref(0)
/** 最近一次成功查询的值（结果摘要行展示用——回填历史时与输入框可能不同步） */
const lastValue = ref('')
/** 结果展示形态：结构化键值树 / 原始 JSON（复制粘贴友好） */
const resultView = ref<'pretty' | 'raw'>('pretty')
/** 页内双 Tab（2026-10-28 走查批）：查询页聚焦表单+结果；历史页独立承载分组/分页/筛选 */
const activeTab = ref<'query' | 'history'>('query')
/** 组表时间列标签（组行=最近一次；子行=该次） */
const dateLabel = '查询时间（组=最近）'

// ─── 本机查询流水（localStorage 按 employee_no 隔离；追加式、时间降序）───

interface IntelHistoryEntry {
  type: string
  value: string
  /** 查询时间戳（ms）——列表按此降序、统计按此聚合 */
  ts: number
  stale: boolean
  hit_count: number
}

const HISTORY_CAP = 500
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

/** 追加式流水：每笔查询一条记录（不去重——查询次数统计依赖逐笔留痕）。
 *  不存 result 快照（09 号 A.6 定论）：同键重查命中缓存近零成本覆盖「回看」诉求；
 *  取证/审计诉求走服务端查询日志端点（触发驱动登记）——本机快照自证无效。 */
function recordHistory(entry: IntelHistoryEntry) {
  history.value.unshift(entry)
  if (history.value.length > HISTORY_CAP) history.value.length = HISTORY_CAP
  persistHistory()
}

/** 历史（组/次）行点击或按钮 → 回填表单并发起查询（查看型列表行点击直达惯例） */
function rerun(row: { type: string; value: string }) {
  intelType.value = row.type
  value.value = row.value
  query()
}

// ─── 查询次数统计（今日/本周/本月/累计 + 近 14 天逐日柱图）───

function dayStart(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 本周周一 00:00（zh-CN 口径：周一为一周之始） */
function weekStartTs(): number {
  const d = new Date(dayStart(Date.now()))
  return d.getTime() - ((d.getDay() + 6) % 7) * 86400000
}

function monthStartTs(): number {
  const d = new Date(dayStart(Date.now()))
  d.setDate(1)
  return d.getTime()
}

const stats = computed(() => {
  const today = dayStart(Date.now())
  const week = weekStartTs()
  const month = monthStartTs()
  let day = 0
  let wk = 0
  let mo = 0
  for (const e of history.value) {
    if (e.ts >= today) day += 1
    if (e.ts >= week) wk += 1
    if (e.ts >= month) mo += 1
  }
  return [
    { label: '今日', count: day },
    { label: '本周', count: wk },
    { label: '本月', count: mo },
    { label: '累计', count: history.value.length },
  ]
})

/** 近 N 天逐日查询次数（含今日；本地日历日切日）——趋势抽屉数据源 */
function dailyCounts(n: number): number[] {
  const today = dayStart(Date.now())
  const counts = new Array<number>(n).fill(0)
  for (const e of history.value) {
    const offset = Math.floor((dayStart(e.ts) - (today - (n - 1) * 86400000)) / 86400000)
    if (offset >= 0 && offset < n) counts[offset] += 1
  }
  return counts
}

// ─── 查询趋势抽屉（日粒度柱状图，范围近 7/14/30 天可切）───
// 周粒度/月粒度分桶暂不做：本机流水上限 500 条撑不起跨月深度（柱大多为零），
// 周/月总量已由卡片头徽标覆盖；后端补跨端查询史端点后再评估。

const trendOpen = ref(false)
const trendRange = ref<7 | 14 | 30>(14)
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const BAR_MAX_H = 200

const trendDays = computed(() => {
  const n = trendRange.value
  const today = dayStart(Date.now())
  const pad = (x: number) => String(x).padStart(2, '0')
  const counts = dailyCounts(n)
  const max = Math.max(1, ...counts)
  // 日期轴抽稀：7 天全显 / 14 天隔一 / 30 天隔三（末日恒显）
  const step = n <= 7 ? 1 : n <= 14 ? 2 : 4
  return counts.map((count, i) => {
    const d = new Date(today - (n - 1 - i) * 86400000)
    return {
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      full: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 周${WEEKDAYS[d.getDay()]}`,
      count,
      h: count ? Math.max(8, Math.round((count / max) * BAR_MAX_H)) : 2,
      showLabel: i % step === 0 || i === n - 1,
    }
  })
})

const trendSummary = computed(() => {
  const days = trendDays.value
  const total = days.reduce((s, d) => s + d.count, 0)
  const peak = days.reduce((m, d) => (d.count > m.count ? d : m), days[0])
  return { total, avg: (total / days.length).toFixed(1), peak: `${peak.label}（${peak.count} 次）` }
})

// ─── 历史筛选（本机即时过滤，客户端口径——不走路由/请求）───

const filterType = ref('')
const filterKeyword = ref('')
// 快捷段+自定义（2026-10-29 升格公共 composable——三页统一形态）
const { preset: datePreset, range: filterRange, apply: applyDatePreset, reset: presetReset } = useDatePresetRange()

/** 时间戳 → 本地日期 YYYY-MM-DD（与 daterange value-format 对齐比较） */
function localDay(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const filteredHistory = computed(() => {
  const kw = filterKeyword.value.trim().toLowerCase()
  return history.value.filter((e) => {
    if (filterType.value && e.type !== filterType.value) return false
    if (kw && !e.value.toLowerCase().includes(kw)) return false
    if (filterRange.value) {
      const day = localDay(e.ts)
      if (day < filterRange.value[0] || day > filterRange.value[1]) return false
    }
    return true
  })
})

function resetFilters() {
  filterType.value = ''
  filterKeyword.value = ''
  presetReset()
  groupedPage.value = 1
}


// ─── 历史分组视图（2026-10-28 走查批：同查询值合并、组为单位分页+点开明细）───
// 存储仍为追加式流水（统计依赖）；展示层按 类型+值 聚合——组行=汇总（次数/最近），
// children=逐次记录（默认收起，展开见明细）。
interface HistoryGroupRow {
  isGroup: true
  key: string
  type: string
  value: string
  count: number
  lastTs: number
  lastStale: boolean
  lastHit: number
  children: IntelHistoryEntry[]
}

const groupedHistory = computed<HistoryGroupRow[]>(() => {
  const map = new Map<string, HistoryGroupRow>()
  // filteredHistory 本身时间降序（追加式 unshift）——首见即最近
  for (const e of filteredHistory.value) {
    const key = `${e.type}|${e.value}`
    let g = map.get(key)
    if (!g) {
      g = { isGroup: true, key, type: e.type, value: e.value, count: 0, lastTs: e.ts, lastStale: e.stale, lastHit: e.hit_count, children: [] }
      map.set(key, g)
    }
    g.count += 1
    g.children.push(e)
  }
  return [...map.values()].sort((a, b) => b.lastTs - a.lastTs)
})

// 客户端分页（组为单位，面板型 20/页——数据全量在内存）
const groupedPageSize = ref(20)
const groupedPage = ref(1)
const pagedGroups = computed(() =>
  groupedHistory.value.slice((groupedPage.value - 1) * groupedPageSize.value, groupedPage.value * groupedPageSize.value),
)

useTableFit(historyTable, () => pagedGroups.value)

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
    expiresAt.value = data.expires_at ?? ''
    hitCount.value = data.hit_count ?? 0
    lastValue.value = v
    recordHistory({ type: intelType.value, value: v, ts: Date.now(), stale: data.stale, hit_count: data.hit_count ?? 0 })
  } catch {
    // 错误 toast 由拦截器统一处理
  } finally {
    loading.value = false
  }
}

/** 复制原始 JSON（等宽视图内容同源——复制即所得） */
async function copyRaw() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(result.value, null, 2))
    ElMessage.success('已复制结果 JSON')
  } catch {
    ElMessage.error('复制失败，请在 JSON 视图内手动选择复制')
  }
}

function formatTs(ts: number): string {
  return formatDateTime(ts)
}

/** 缓存 TTL 剩余的粗粒度人话表述（一次性快照不计时——刷新/重查即更新） */
function ttlText(iso: string): string {
  if (!iso) return ''
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return '已到期'
  const h = ms / 3600000
  if (h >= 48) return `剩 ${Math.floor(h / 24)} 天`
  if (h >= 1) return `剩 ${Math.floor(h)} 小时`
  return `剩 ${Math.max(1, Math.floor(ms / 60000))} 分钟`
}

/** ISO 时间戳的分钟级短展示（缓存至 …） */
function formatIsoMin(iso: string): string {
  return formatDateTimeShort(iso)
}
</script>

<template>
  <div class="fill-page">
    <el-card shadow="never">
      <el-tabs v-model="activeTab" class="fill-tabs">
        <el-tab-pane label="查询" name="query">
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
        <div class="flex flex-wrap items-center gap-2 mb-2 text-xs text-gray-500">
          <el-tag size="small">{{ TYPE_LABELS[intelType] ?? intelType }} · {{ lastValue }}</el-tag>
          <el-tag v-if="stale" type="warning" size="small">陈旧缓存（上游配额耗尽降级）</el-tag>
          <span>数据时间：{{ fetchedAt }}</span>
          <span v-if="hitCount > 0" class="text-gray-400">缓存命中 {{ hitCount }} 次</span>
          <span v-if="expiresAt" class="text-gray-400">缓存至 {{ formatIsoMin(expiresAt) }}（{{ ttlText(expiresAt) }}）</span>
          <div class="ml-auto flex items-center gap-2">
            <el-radio-group v-model="resultView" size="small">
              <el-radio-button value="pretty">结构化</el-radio-button>
              <el-radio-button value="raw">JSON</el-radio-button>
            </el-radio-group>
            <el-button size="small" @click="copyRaw">复制</el-button>
          </div>
        </div>
        <div
          v-if="resultView === 'pretty'" class="overflow-auto max-h-[360px] rounded p-1"
          style="background: var(--el-fill-color-light)"
        >
          <IntelResult :data="result" />
        </div>
        <pre v-else class="text-xs bg-gray-50 dark:bg-gray-800 p-3 rounded overflow-auto max-h-[360px]">{{ JSON.stringify(result, null, 2) }}</pre>
      </template>
        <el-empty v-else description="输入查询值开始" :image-size="60" />
        </el-tab-pane>

        <el-tab-pane label="查询历史" name="history" lazy>
        <!-- 统计徽标（聚合口径；逐日趋势在「趋势」抽屉） -->
        <div class="flex flex-wrap items-center gap-3 mb-3">
          <span v-for="s in stats" :key="s.label" class="text-xs text-gray-500">
            {{ s.label }} <span class="font-semibold text-sm">{{ s.count }}</span> 次
          </span>
          <el-button link type="primary" size="small" @click="trendOpen = true">趋势</el-button>
        </div>

        <!-- 筛选栏（客户端即时过滤）：类型/关键字 + 快捷日期段（自定义按需弹出，省常驻宽） -->
        <div class="flex flex-wrap items-center gap-3 mb-3">
          <el-select v-model="filterType" class="!w-[110px]" @change="groupedPage = 1">
            <el-option label="全部类型" value="" />
            <el-option v-for="(l, t) in TYPE_LABELS" :key="t" :label="l" :value="t" />
          </el-select>
          <el-input v-model="filterKeyword" placeholder="查询值关键字" class="!w-[160px]" clearable @input="groupedPage = 1" />
          <el-radio-group
            :model-value="datePreset" size="small"
            @update:model-value="(v: string | number | boolean | undefined) => applyDatePreset(v)"
          >
            <el-radio-button value="">全部</el-radio-button>
            <el-radio-button value="7d">近 7 天</el-radio-button>
            <el-radio-button value="30d">近 30 天</el-radio-button>
            <el-radio-button value="custom">自定义</el-radio-button>
          </el-radio-group>
          <el-date-picker
            v-if="datePreset === 'custom'"
            v-model="filterRange" type="daterange" value-format="YYYY-MM-DD" format="MM-DD"
            start-placeholder="起" end-placeholder="止" class="intel-daterange !flex-none"
            :style="{ '--el-date-editor-width': '210px' }"
            @change="groupedPage = 1"
          />
          <el-button class="ml-auto !mr-0" size="small" @click="resetFilters">重置</el-button>
        </div>

        <!-- 分组树表：组行=同查询值合并（次数/最近），展开见逐次记录；组为单位客户端分页 -->
        <div class="min-h-0 flex-1">
          <el-table
            ref="historyTable" :data="pagedGroups" height="100%" row-key="key"
            :tree-props="{ children: 'children' }" default-expand-all
            class="history-table"
            :row-class-name="({ row }: { row: { isGroup?: boolean } }) => (row.isGroup ? 'history-group-row' : 'history-child-row')"
          >
            <el-table-column label="查询值" min-width="240" show-overflow-tooltip>
              <template #default="{ row }">
                <el-tag v-if="row.isGroup" size="small" effect="plain" class="mr-1">{{ TYPE_LABELS[row.type as string] ?? row.type }}</el-tag>
                <span :class="row.isGroup ? 'font-medium' : 'text-gray-400'">{{ row.value }}</span>
              </template>
            </el-table-column>
            <el-table-column label="次数" width="80" align="center">
              <template #default="{ row }">
                <el-tag v-if="row.isGroup" size="small" type="info" effect="plain">{{ row.count }} 次</el-tag>
                <span v-else class="text-xs text-gray-400">—</span>
              </template>
            </el-table-column>
            <el-table-column :label="dateLabel" width="170">
              <template #default="{ row }">
                {{ row.isGroup ? formatTs(row.lastTs as number) : formatTs(row.ts as number) }}
              </template>
            </el-table-column>
            <el-table-column label="缓存状态" width="130">
              <template #default="{ row }">
                <template v-if="row.isGroup">
                  <el-tag v-if="row.lastStale" type="warning" size="small">陈旧缓存</el-tag>
                  <span v-else-if="row.lastHit > 0" class="text-xs text-gray-500">命中 {{ row.lastHit }} 次</span>
                  <span v-else class="text-xs text-gray-400">首次查询</span>
                </template>
                <template v-else>
                  <el-tag v-if="row.stale" type="warning" size="small">陈旧缓存</el-tag>
                  <span v-else-if="row.hit_count > 0" class="text-xs text-gray-500">命中 {{ row.hit_count }} 次</span>
                  <span v-else class="text-xs text-gray-400">首次查询</span>
                </template>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click.stop="rerun(row as { type: string; value: string })">查询</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <el-empty v-if="!history.length" description="暂无查询记录——在「查询」页发起首笔查询" :image-size="60" />
              <el-empty v-else description="无匹配记录——调整或重置筛选条件" :image-size="60" />
            </template>
          </el-table>
        </div>

        <!-- 分组分页（面板型：钉右+total 必显——分页统一约定） -->
        <div class="mt-3 flex justify-end">
          <el-pagination
            v-model:current-page="groupedPage" v-model:page-size="groupedPageSize"
            :page-sizes="[20, 50, 100]" :total="groupedHistory.length"
            layout="total, sizes, prev, pager, next"
          />
        </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <!-- 查询趋势抽屉：日粒度柱状图（近 7/14/30 天）——周/月分桶见 script 注记 -->
    <el-drawer v-model="trendOpen" title="查询趋势" size="560px">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <el-radio-group v-model="trendRange" size="small">
          <el-radio-button :value="7">近 7 天</el-radio-button>
          <el-radio-button :value="14">近 14 天</el-radio-button>
          <el-radio-button :value="30">近 30 天</el-radio-button>
        </el-radio-group>
        <span class="text-xs text-gray-500">
          共 {{ trendSummary.total }} 次 · 日均 {{ trendSummary.avg }} · 峰值 {{ trendSummary.peak }}
        </span>
      </div>
      <!-- 纯 CSS 柱状图（无 canvas 时序依赖，任意视口/暗色直渲染） -->
      <div class="flex items-end gap-[6px] h-[268px] border-b pb-0" style="border-color: var(--el-border-color-lighter)">
        <div
          v-for="d in trendDays" :key="d.full"
          class="flex-1 flex flex-col items-center justify-end h-full group"
          :title="`${d.full}：${d.count} 次`"
        >
          <span class="text-[10px] leading-[14px] h-[14px]" :class="d.count ? 'text-gray-500' : 'invisible'">{{ d.count || '0' }}</span>
          <div
            class="w-full max-w-[26px] rounded-t"
            :class="d.count ? 'bar-on group-hover:opacity-80' : 'bar-off'"
            :style="{ height: d.h + 'px' }"
          />
          <span class="text-[10px] leading-[16px] h-[16px] text-gray-400">{{ d.showLabel ? d.label : '' }}</span>
        </div>
      </div>
      <div class="text-xs text-gray-400 mt-3">口径：本机流水按本地日历日聚合，含今日；悬停柱体查看逐日次数。</div>
    </el-drawer>
  </div>
</template>

<style scoped>
/* 行点击重查——查看型列表行指针样式惯例 */
.history-table :deep(.el-table__row) {
  cursor: pointer;
}

/* 自定义日期窄形态（2026-10-28 走查二批）：EP daterange 默认内宽 534px 覆盖宽度类——
   强制 210px + 内嵌 input 收缩 + 短格式 MM-DD（值仍 YYYY-MM-DD，逻辑不变） */
/* 内嵌 input 收缩（宽度本体走 --el-date-editor-width 变量注入——EP 官方覆盖路径） */
:deep(.intel-daterange .el-range-input) {
  min-width: 0;
}

/* 趋势柱状图配色（EP 变量，暗色自适应） */
.bar-on {
  background: var(--el-color-primary-light-3);
}

.bar-off {
  background: var(--el-fill-color-darker);
}
</style>

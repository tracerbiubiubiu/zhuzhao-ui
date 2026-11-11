<template>
  <div class="fill-page">
    <!-- 一屏一卡：不立卡头（面包屑+菜单已定位）；分组语义以卡内小节标题承载（ui-card-header 纪律） -->
    <el-card shadow="never" class="!flex-none">
      <div class="mb-2">
        <span class="text-13px font-medium">存储与上传</span>
        <span class="text-xs text-gray-400 ml-2">
          影响所有用户的上传行为 · 保存后立即生效 · 仅超级管理员可修改
        </span>
      </div>

      <!-- 内联控件形态（业界设置页主流：控件直接在行上，无逐行按钮/对话框）——
           脏状态由底部保存条统一提交；描述收 ? 悬停 -->
      <el-form label-position="left" label-width="200px" class="!mt-1" :disabled="!canEdit">
        <el-form-item v-for="row in viewRows" :key="row.key" class="!mb-2 !py-1">
          <template #label>
            <span class="inline-flex items-center gap-1">
              {{ row.meta.title }}
              <el-tooltip
                :content="`${row.meta.desc}${row.meta.hardLimit ? `（范围：${row.meta.hardLimit}）` : ''}`"
                placement="top"
              >
                <Icon icon="mdi:help-circle-outline" :height="14" class="text-gray-300 hover:text-gray-400 cursor-help" />
              </el-tooltip>
            </span>
          </template>
          <div class="flex items-center justify-between gap-3 w-full">
            <div class="flex items-center gap-2 min-w-0 flex-wrap">
              <!-- bytes：数字输入 + 实时换算 -->
              <template v-if="row.meta.control === 'bytes'">
                <el-input-number
                  v-model="drafts[row.key]!.num"
                  :min="1" :max="104857600" :controls="false" size="small" style="width: 130px"
                  :data-testid="`setting-input-${row.key}`"
                />
                <span class="text-xs text-gray-400">≈ {{ fmtBytes(drafts[row.key]!.num) }}</span>
              </template>
              <!-- 个数/天数：数字输入 -->
              <el-input-number
                v-else-if="row.meta.control === 'count' || row.meta.control === 'days'"
                v-model="drafts[row.key]!.num"
                :min="1" :max="row.meta.control === 'days' ? 365 : (row.meta.maxCount ?? 100)"
                :controls="false" size="small" style="width: 110px"
                :data-testid="`setting-input-${row.key}`"
              />
              <!-- MIME 白名单：多选 -->
              <el-select
                v-else-if="row.meta.control === 'mime'"
                v-model="drafts[row.key]!.mime"
                multiple filterable collapse-tags collapse-tags-tooltip allow-create
                default-first-option placeholder="输入或从预设选择"
                size="small" style="width: 320px" class="!w-[320px]"
                :data-testid="`setting-input-${row.key}`"
              >
                <el-option v-for="m in presetMimes" :key="m" :label="m" :value="m" />
              </el-select>
              <span v-else class="text-14px">{{ drafts[row.key]!.text }}</span>

              <span class="text-xs text-gray-300">/ 初始 {{ row.meta.formatPrimary(row.default_value) }}</span>

              <!-- 恢复默认：有覆盖且值≠出厂时出现 -->
              <el-tooltip content="删除运行时覆盖，回到系统出厂值" placement="top">
                <el-button
                  v-if="row.source === 'kv' && row.isCustomized"
                  link type="warning" size="small"
                  data-testid="setting-reset"
                  @click="resetRow(row)"
                >恢复默认</el-button>
              </el-tooltip>

              <el-tag v-if="row.source === 'kv' && row.isCustomized" type="success" size="small" effect="plain">已自定义</el-tag>
              <el-tag v-else size="small" effect="plain" type="info">默认</el-tag>
            </div>
            <el-tooltip v-if="!canEdit" content="需超级管理员权限" placement="top">
              <span class="text-xs text-gray-400">只读</span>
            </el-tooltip>
          </div>
        </el-form-item>
      </el-form>

      <!-- 脏状态保存条：内联改动统一提交（业界脏保存条惯例） -->
      <div
        v-if="dirtyKeys.length"
        class="sticky bottom-0 -mx-4 px-4 py-2 flex items-center justify-between bg-[var(--el-color-primary-light-9)] dark:bg-gray-800 border-t border-[var(--el-color-primary-light-7)] rounded-b-[var(--el-card-border-radius)]"
      >
        <span class="text-xs" data-testid="setting-dirty-bar">
          {{ dirtyKeys.length }} 项未保存（{{ dirtyTitles }}）
        </span>
        <div class="flex items-center gap-2">
          <el-button size="small" @click="discardDrafts">放弃更改</el-button>
          <el-button type="primary" size="small" :loading="saving" data-testid="setting-save" @click="saveDirty">
            保存更改
          </el-button>
        </div>
      </div>

      <el-empty v-if="!loading && !settings.length" description="未读取到设置项" :image-size="60" />
      <div v-if="settings.length" class="text-xs text-gray-300 mt-2">
        设置键：{{ settings.map((s) => s.key).join(' · ') }}
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
/**
 * 系统设置管理页（B5-6 建；2026-11-03 重设计二轮——水平表单的值区改「内联控件+
 * 脏保存条」：控件直接在行上，改动经底部保存条统一提交，废除逐行按钮+对话框
 * ——业界设置页主流（Vercel/Linear/GitHub Developer settings）。
 * 语义修正：「默认/已自定义」标签按 value↔default_value 深比较（后端本批暴露
 * default_value——原 source=kv 恒显已自定义，值改回默认也误导）；「恢复默认」
 * 调 reset 端点删覆盖行回出厂值。
 * 元信息映射 META=展示层 SSOT（标题/描述/控件类型/格式化）；新增 catalog 键须
 * 同步补行（缺省优雅降级=显示 key+后端描述）。raw key 集中卡底脚注。
 */
import { ref, computed, reactive, onMounted } from 'vue'
import {
  ElCard, ElForm, ElFormItem, ElTag, ElButton, ElTooltip, ElMessageBox,
  ElInputNumber, ElSelect, ElOption, ElMessage, ElEmpty,
} from 'element-plus'
import { Icon } from '@iconify/vue/offline'
import request from '@vea/request'
import { useUserStoreWithOut } from '@/store/modules/user'

defineOptions({ name: 'system_setting' })

interface SettingRow {
  key: string
  value: unknown
  default_value?: unknown
  source: string
  min_editor_tier: string
  description: string
  updated_by?: string
  updated_at?: string
  version?: number
}

type Control = 'bytes' | 'count' | 'days' | 'mime' | 'text'

/** 人话元信息映射（展示层 SSOT） */
interface SettingMeta {
  title: string
  desc: string
  control: Control
  maxCount?: number
  hardLimit?: string
  formatPrimary: (v: unknown) => string
}

function fmtBytes(n: number): string {
  if (n >= 1048576) return `${(n / 1048576).toFixed(n % 1048576 === 0 ? 0 : 1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

const META: Record<string, SettingMeta> = {
  'storage.max_upload_bytes': {
    title: '单文件大小上限',
    desc: '每个上传文件的最大体积。调小可防止超大文件占满存储空间；上传超过此大小的文件会被直接拒绝。',
    control: 'bytes',
    hardLimit: '1 字节 – 100 MB（硬顶，无法调更高）',
    formatPrimary: (v) => fmtBytes(Number(v)),
  },
  'storage.max_attachments_per_ticket': {
    title: '单个工单附件数上限',
    desc: '一张工单最多可以附带多少个文件。超出后需先删除已有附件才能继续添加。',
    control: 'count',
    maxCount: 100,
    hardLimit: '1 – 100 个（硬顶）',
    formatPrimary: (v) => `${v} 个`,
  },
  'storage.max_presign_batch': {
    title: '单次批量上传数上限',
    desc: '用户一次操作（如批量添加附件）最多能同时发起多少个文件的上传请求。数值越大，单次批量上传越方便，但服务端瞬时压力也越大。',
    control: 'count',
    maxCount: 100,
    hardLimit: '1 – 100 个（硬顶）',
    formatPrimary: (v) => `${v} 个/次`,
  },
  'storage.allowed_mime_types': {
    title: '允许上传的文件类型',
    desc: '白名单机制：只有列表中的文件类型允许上传。可执行程序、HTML、SVG 属于服务端硬黑名单，任何人都无法放行。',
    control: 'mime',
    hardLimit: '至少 1 种；黑名单类型不可加入',
    formatPrimary: (v) => `${Array.isArray(v) ? v.length : 0} 种类型`,
  },
  'storage.orphan_gc_days': {
    title: '未确认文件的自动清理天数',
    desc: '用户点了上传、但最终没有提交保存的文件（如上传附件后放弃提交工单），会先以「待确认」状态暂存；超过此天数仍无人认领的，系统自动删除以回收存储空间。',
    control: 'days',
    hardLimit: '1 – 365 天',
    formatPrimary: (v) => `${v} 天`,
  },
}

const presetMimes = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf', 'text/plain', 'application/zip',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

const userStore = useUserStoreWithOut()
const canEdit = userStore.hasPermission('system:setting:update')

const settings = ref<SettingRow[]>([])
const loading = ref(false)
const saving = ref(false)

/** 草稿：每键一份可编辑副本（num=数值类/text=兜底/mime=列表） */
const drafts = reactive<Record<string, { num: number; text: string; mime: string[] }>>({})

const viewRows = computed(() =>
  settings.value.map((r) => {
    const meta = META[r.key] ?? {
      title: r.key,
      desc: r.description,
      control: 'text' as Control,
      formatPrimary: (v: unknown) => String(v),
    }
    const isCustomized = r.default_value !== undefined
      && JSON.stringify(normalize(r.value)) !== JSON.stringify(normalize(r.default_value))
    return { ...r, meta, isCustomized }
  }),
)

/** 归一化比较（JSON 深比较——数组排序后比较，MIME 顺序无语义） */
function normalize(v: unknown): unknown {
  if (Array.isArray(v)) return [...v].sort()
  return v
}

const dirtyKeys = computed(() =>
  settings.value
    .filter((r) => {
      const d = drafts[r.key]
      if (!d) return false
      const meta = META[r.key]
      if (!meta) return false
      if (meta.control === 'mime') return JSON.stringify(normalize(d.mime)) !== JSON.stringify(normalize(r.value))
      if (meta.control === 'text') return d.text !== String(r.value)
      return d.num !== Number(r.value)
    })
    .map((r) => r.key),
)

const dirtyTitles = computed(() =>
  dirtyKeys.value.map((k) => META[k]?.title ?? k).join('、'),
)

function seedDrafts() {
  for (const r of settings.value) {
    const meta = META[r.key]
    if (meta?.control === 'mime') {
      drafts[r.key] = { num: 0, text: '', mime: Array.isArray(r.value) ? [...r.value] : [] }
    } else if (meta && meta.control !== 'text') {
      drafts[r.key] = { num: Number(r.value) || 0, text: '', mime: [] }
    } else {
      drafts[r.key] = { num: 0, text: String(r.value ?? ''), mime: [] }
    }
  }
}

function discardDrafts() {
  seedDrafts()
  ElMessage.info('已放弃未保存的更改')
}

async function refresh() {
  loading.value = true
  try {
    const data = await request.get('/api/v1/system/settings')
    settings.value = data as unknown as SettingRow[]
    seedDrafts()
  } catch {
    ElMessage.error('读取设置失败')
  } finally {
    loading.value = false
  }
}

async function saveDirty() {
  if (!dirtyKeys.value.length) return
  saving.value = true
  let failed = 0
  try {
    // 逐键顺序提交（后端键级校验——单键失败不阻断其余键，失败计数后统一报错）
    for (const key of dirtyKeys.value) {
      const meta = META[key]
      const d = drafts[key]
      try {
        const value = meta?.control === 'mime' ? d.mime : meta?.control === 'text' ? d.text : d.num
        await request.post('/api/v1/system/settings/update', { key, value })
      } catch {
        failed++
      }
    }
    if (failed) ElMessage.error(`${failed} 项保存失败，其余已生效（失败项请检查取值后重试）`)
    else ElMessage.success('设置已保存，立即生效')
    await refresh()
  } finally {
    saving.value = false
  }
}

async function resetRow(row: SettingRow) {
  try {
    await ElMessageBox.confirm(
      `将「${META[row.key]?.title ?? row.key}」恢复为系统出厂值？当前的运行时覆盖将被删除。`,
      '恢复默认',
      { type: 'warning', confirmButtonText: '恢复默认', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await request.post('/api/v1/system/settings/reset', { key: row.key })
    ElMessage.success('已恢复出厂默认值')
    await refresh()
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      || (e instanceof Error ? e.message : '恢复失败')
    ElMessage.error(msg)
  }
}

onMounted(refresh)
</script>

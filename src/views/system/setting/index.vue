<template>
  <div class="fill-page">
    <el-card shadow="never" class="!flex-none">
      <template #header>
        <div>
          <div class="font-semibold">存储与上传</div>
          <div class="text-xs text-gray-400 mt-1">
            影响所有用户的文件上传行为；改动保存后立即生效，无需重启。仅超级管理员可修改。
          </div>
        </div>
      </template>

      <div v-loading="loading">
        <div
          v-for="row in viewRows"
          :key="row.key"
          class="flex items-start justify-between gap-6 py-16px border-b border-gray-100 dark:border-gray-700 last:border-b-0"
        >
          <!-- 左：人话标题 + 通俗描述；raw key 降为悬停辅助信息（排障用） -->
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-14px font-medium">{{ row.meta.title }}</span>
              <el-tag v-if="row.source === 'kv'" type="success" size="small" effect="plain">已自定义</el-tag>
              <el-tooltip v-else content="系统内置默认值，尚未修改过" placement="top">
                <el-tag size="small" effect="plain" type="info">默认值</el-tag>
              </el-tooltip>
            </div>
            <div class="text-xs text-gray-500 mt-4px leading-relaxed">{{ row.meta.desc }}</div>
            <div v-if="row.meta.hardLimit" class="text-xs text-gray-400 mt-2px">
              可设范围：{{ row.meta.hardLimit }}
            </div>
          </div>

          <!-- 右：当前值（人话主显示 + 原始值辅助）+ 操作 -->
          <div class="flex items-center gap-3 flex-none pt-1 max-w-[280px]">
            <div class="text-right">
              <div class="text-14px font-600">{{ row.meta.formatPrimary(row.value) }}</div>
              <div v-if="row.meta.formatSecondary" class="text-xs text-gray-400">
                {{ row.meta.formatSecondary(row.value) }}
              </div>
            </div>
            <el-button
              v-if="canEdit"
              type="primary"
              plain
              size="small"
              @click="openEdit(row)"
            >修改</el-button>
            <el-tooltip v-else content="需超级管理员权限" placement="top">
              <span class="text-xs text-gray-400">只读</span>
            </el-tooltip>
          </div>
        </div>

        <el-empty v-if="!loading && !settings.length" description="未读取到设置项" :image-size="60" />
      </div>
    </el-card>

    <el-dialog v-model="editVisible" :title="`修改「${editing?.meta.title}」`" width="520">
      <el-alert
        v-if="editing"
        :title="editing.meta.desc"
        type="info"
        :closable="false"
        class="mb-4"
        show-icon
      />
      <div v-if="editing" class="mb-2 text-xs text-gray-400">
        当前值：{{ editing.meta.formatPrimary(editing.value) }}
        <span v-if="editing.meta.formatSecondary">（{{ editing.meta.formatSecondary(editing.value) }}）</span>
      </div>

      <el-form label-width="90">
        <el-form-item label="新值">
          <!-- bytes：数字输入 + 实时 MB 换算预览 -->
          <template v-if="editing!.control === 'bytes'">
            <div>
              <el-input-number v-model="editNumberValue" :min="1" :max="104857600" style="width: 220px" />
              <div class="text-xs text-gray-400 mt-1">≈ {{ fmtBytes(editNumberValue) }}（硬顶 100 MB）</div>
            </div>
          </template>
          <!-- 个数类：按各键硬顶钳制 -->
          <template v-else-if="editing!.control === 'count'">
            <div>
              <el-input-number v-model="editNumberValue" :min="1" :max="editing!.maxCount" style="width: 220px" />
              <div class="text-xs text-gray-400 mt-1">最大 {{ editing!.maxCount }}</div>
            </div>
          </template>
          <!-- 天数类 -->
          <template v-else-if="editing!.control === 'days'">
            <div>
              <el-input-number v-model="editNumberValue" :min="1" :max="365" style="width: 220px" />
              <div class="text-xs text-gray-400 mt-1">1–365 天</div>
            </div>
          </template>
          <!-- MIME 白名单 -->
          <el-select
            v-else-if="editing!.control === 'mime'"
            v-model="editMimeList"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="输入或从预设选择"
            style="width: 100%"
          >
            <el-option v-for="m in presetMimes" :key="m" :label="m" :value="m" />
          </el-select>
          <el-input v-else v-model="editValue" placeholder="输入值" />
        </el-form-item>
        <el-form-item v-if="editing!.control === 'mime'" label="">
          <div class="text-xs text-gray-400">
            可执行文件与 HTML/SVG 为服务端硬黑名单，加入白名单会被拒绝；至少保留一种图片格式，否则头像无法上传。
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
/**
 * 系统设置管理页（B5-6 建；2026-11-03 重设计——键值表格改「人话卡片行」：
 * 标题/描述/范围走前端元信息映射（展示层人话化，后端 catalog description
 * 保留为 API 层原文），raw key 降为悬停辅助；值双显（人话主值+原始值辅助）；
 * 控件类型由映射表 control 显式声明（原 key.includes 字符串猜测废除）。
 * 新增 catalog 键时须同步补 META 行（缺省优雅降级=显示 key+后端描述）。
 */
import { ref, computed, onMounted } from 'vue'
import {
  ElCard, ElTag, ElButton, ElTooltip, ElAlert,
  ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber,
  ElSelect, ElOption, ElMessage, ElEmpty,
} from 'element-plus'
import request from '@vea/request'
import { useUserStoreWithOut } from '@/store/modules/user'

defineOptions({ name: 'system_setting' })

interface SettingRow {
  key: string
  value: unknown
  source: string
  min_editor_tier: string
  description: string
  updated_by?: string
  updated_at?: string
}

type Control = 'bytes' | 'count' | 'days' | 'mime' | 'text'

/** 人话元信息映射（展示层 SSOT——后端 description 仅作无映射时的降级显示） */
interface SettingMeta {
  title: string
  desc: string
  control: Control
  /** 个数类硬顶（el-input-number max） */
  maxCount?: number
  hardLimit?: string
  formatPrimary: (v: unknown) => string
  formatSecondary?: (v: unknown) => string
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
    formatSecondary: (v) => `${Number(v).toLocaleString()} 字节`,
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
    formatSecondary: (v) => (Array.isArray(v) ? `${v.slice(0, 2).join('、')} 等` : ''),
  },
  'storage.orphan_gc_days': {
    title: '未确认文件的自动清理天数',
    desc: '用户点了上传、但最终没有提交保存的文件（如上传附件后放弃提交工单），会先以「待确认」状态暂存；超过此天数仍无人认领的，系统自动删除以回收存储空间。',
    control: 'days',
    hardLimit: '1 – 365 天',
    formatPrimary: (v) => `${v} 天`,
  },
}

const userStore = useUserStoreWithOut()
const settings = ref<SettingRow[]>([])
const loading = ref(false)
const editVisible = ref(false)
const editing = ref<(SettingRow & { meta: SettingMeta; control: Control; maxCount?: number }) | null>(null)
const editValue = ref<number | string>(0)
/** el-input-number 需纯 number——computed 代理双向绑定 */
const editNumberValue = computed({
  get: () => (typeof editValue.value === 'number' ? editValue.value : Number(editValue.value) || 0),
  set: (v: number) => { editValue.value = v },
})
const editMimeList = ref<string[]>([])
const saving = ref(false)

const presetMimes = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf', 'text/plain', 'application/zip',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

const canEdit = userStore.hasPermission('system:setting:update')

/** 展示行 = 数据行 + 元信息（无映射键优雅降级：标题显示 key、描述用后端原文） */
const viewRows = computed(() =>
  settings.value.map((r) => {
    const meta = META[r.key] ?? {
      title: r.key,
      desc: r.description,
      control: 'text' as Control,
      formatPrimary: (v: unknown) => String(v),
    }
    return { ...r, meta, control: meta.control, maxCount: meta.maxCount }
  }),
)

async function refresh() {
  loading.value = true
  try {
    const data = await request.get('/api/v1/system/settings')
    settings.value = data as unknown as SettingRow[]
  } catch {
    ElMessage.error('读取设置失败')
  } finally {
    loading.value = false
  }
}

function openEdit(row: SettingRow & { meta: SettingMeta; control: Control; maxCount?: number }) {
  editing.value = row
  if (row.control === 'mime') {
    editMimeList.value = Array.isArray(row.value) ? [...row.value] : []
  } else if (typeof row.value === 'number') {
    editValue.value = row.value
  } else {
    editValue.value = String(row.value)
  }
  editVisible.value = true
}

async function save() {
  if (!editing.value) return
  saving.value = true
  try {
    const value = editing.value.control === 'mime' ? editMimeList.value : editValue.value
    await request.post('/api/v1/system/settings/update', {
      key: editing.value.key,
      value,
    })
    ElMessage.success('设置已更新，立即生效')
    editVisible.value = false
    await refresh()
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      || (e instanceof Error ? e.message : '保存失败')
    ElMessage.error(msg)
  } finally {
    saving.value = false
  }
}

onMounted(refresh)
</script>

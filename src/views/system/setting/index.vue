<template>
  <div class="fill-page p-4">
    <el-card shadow="hover">
      <template #header><span class="font-semibold">系统设置</span></template>
      <el-table ref="settingsTable" :data="settings" v-loading="loading" border>
        <el-table-column prop="key" label="设置键" width="280" />
        <el-table-column label="当前值" min-width="200">
          <template #default="{ row }">
            <code v-if="typeof row.value === 'number'" class="text-sm">{{ row.value }}</code>
            <span v-else-if="Array.isArray(row.value)" class="text-xs text-gray-500">
              {{ row.value.join(', ') }}
            </span>
            <code v-else class="text-sm">{{ row.value }}</code>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="80">
          <template #default="{ row }">
            <el-tag :type="row.source === 'kv' ? 'success' : 'info'" size="small">
              {{ row.source === 'kv' ? '运行时' : '默认' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="说明" min-width="200" />
        <el-table-column label="编辑层级" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.min_editor_tier === 'superadmin'" type="warning" size="small">超管</el-tag>
            <el-tag v-else type="success" size="small">管理员</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="canEdit()"
              size="small" type="primary" link
              @click="openEdit(row as unknown as SettingRow)"
            >编辑</el-button>
            <el-tooltip v-else content="需超级管理员权限" placement="top">
              <span class="text-xs text-gray-400">只读</span>
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="editVisible" :title="`编辑：${editing?.key || ''}`" width="480">
      <el-form label-width="100">
        <el-form-item :label="editing?.description || '值'">
          <el-input-number
            v-if="editing?.key.includes('bytes') || editing?.key.includes('per_ticket') || editing?.key.includes('batch')"
            v-model="editNumberValue"
            :min="1"
            :max="editing?.key.includes('bytes') ? 104857600 : 100"
            style="width: 200px"
          />
          <el-select
            v-else-if="editing?.key.includes('mime')"
            v-model="editMimeList"
            multiple
            filterable
            allow-create
            placeholder="输入 MIME 类型后回车"
            style="width: 100%"
          >
            <el-option v-for="m in presetMimes" :key="m" :label="m" :value="m" />
          </el-select>
          <el-input v-else v-model="editValue" placeholder="输入值" />
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
 * 系统设置管理页（B5-6——05 号 §3/A.4 #6）。
 * catalog 四键（存储限制类全 superadmin-only）；tier 分层在服务端校验，
 * UI 只读展示低层级不可编辑提示。
 */
import { ref, computed, onMounted } from 'vue'
import {
  ElCard, ElTable, ElTableColumn, ElTag, ElButton, ElTooltip,
  ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber,
  ElSelect, ElOption, ElMessage,
} from 'element-plus'
import request from '@vea/request'
import { useUserStoreWithOut } from '@/store/modules/user'
import { useTableFit } from '@vea/hooks'

interface SettingRow {
  key: string
  value: unknown
  source: string
  min_editor_tier: string
  description: string
  updated_by?: string
  updated_at?: string
}

const userStore = useUserStoreWithOut()
const settings = ref<SettingRow[]>([])
const settingsTable = ref()
useTableFit(settingsTable, () => settings.value)
const loading = ref(false)
const editVisible = ref(false)
const editing = ref<SettingRow | null>(null)
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

const canEditSettings = userStore.hasPermission('system:setting:update')

function canEdit(): boolean {
  return canEditSettings
}

async function refresh() {
  loading.value = true
  try {
    const data = await request.get('/api/v1/system/settings')
    settings.value = data as unknown as SettingRow[]
  } catch (e: unknown) {
    ElMessage.error('读取设置失败')
  } finally {
    loading.value = false
  }
}

function openEdit(row: SettingRow) {
  editing.value = row
  if (row.key.includes('mime')) {
    editMimeList.value = Array.isArray(row.value) ? row.value : []
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
    let value: unknown
    if (editing.value.key.includes('mime')) {
      value = editMimeList.value
    } else {
      value = editValue.value
    }
    await request.post('/api/v1/system/settings/update', {
      key: editing.value.key,
      value,
    })
    ElMessage.success('设置已更新')
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

<style scoped>
.fill-page {
  height: 100%;
  overflow-y: auto;
}
</style>

<script setup lang="ts">
/**
 * 名单类型管理（P4-W5——al_types 菜单页，activelist:type:read 可见/管理操作挂 type:manage）
 *
 * - 类型列表全量小列表（{list,total} 无分页）；注册/演进共用字段行编辑器（四类型枚举封闭）
 * - 演进带 version 乐观锁（10006 冲突→提示重拉）；破坏性变更服务端放行（旧数据懒执行）——
 *   编辑器不拦破坏性操作，仅提示语义
 * - 废弃=幂等危险操作（deprecated 后数据写门关闭）；历史抽屉按 op/version 展示
 */
import { computed, reactive, ref } from 'vue'
import {
  ElButton, ElCard, ElDrawer, ElForm, ElFormItem, ElInput, ElMessage, ElMessageBox,
  ElSwitch, ElTable, ElTableColumn, ElTag, ElSelect, ElOption, ElAlert,
} from 'element-plus'
import type { FormInstance } from 'element-plus'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  deprecateAlTypeApi, evolveAlTypeApi, listAlTypeHistoryApi, listAlTypesApi,
  registerAlTypeApi, type AlFieldDef, type AlTypeDef, type AlTypeHistoryRow,
} from '@/api/al'

// keep-alive 契约：name=动态路由名（菜单 code al_types，组件路径 al/types/index）
defineOptions({ name: 'al_types' })

const queryClient = useQueryClient()
const typesQuery = useQuery({ queryKey: ['al', 'types'], queryFn: listAlTypesApi })
const rows = computed(() => typesQuery.data.value?.list ?? [])

function refresh() {
  queryClient.invalidateQueries({ queryKey: ['al', 'types'] })
}

// ─── 字段行编辑器（注册/演进共用）───
const FIELD_TYPES: AlFieldDef['type'][] = ['string', 'int', 'string_list', 'int_list']

const editorVisible = ref(false)
const editorMode = ref<'create' | 'evolve'>('create')
const editorError = ref('')
const editorSaving = ref(false)
const editorForm = reactive({
  type_name: '',
  version: 0, // evolve 乐观锁（create 不用）
  fields: [] as AlFieldDef[],
})
const formRef = ref<FormInstance>()

const editorRules = {
  type_name: [
    { required: true, message: '请输入类型名', trigger: 'blur' },
    { pattern: /^[a-z][a-z0-9_]*$/, message: '小写字母开头，仅小写字母/数字/下划线（=物理表名后缀）', trigger: 'blur' },
  ],
}

function openCreate() {
  editorMode.value = 'create'
  editorError.value = ''
  editorForm.type_name = ''
  editorForm.version = 0
  editorForm.fields = [{ name: '', type: 'string', required: false }]
  editorVisible.value = true
}

function openEvolve(row: AlTypeDef) {
  editorMode.value = 'evolve'
  editorError.value = ''
  editorForm.type_name = row.type_name
  editorForm.version = row.version
  editorForm.fields = row.fields.map((f) => ({ ...f }))
  editorVisible.value = true
}

function addFieldRow() {
  editorForm.fields.push({ name: '', type: 'string', required: false })
}

function removeFieldRow(i: number) {
  editorForm.fields.splice(i, 1)
}

async function submitEditor() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  const fields = editorForm.fields.filter((f) => f.name.trim())
  if (!fields.length) {
    editorError.value = '至少定义一个字段'
    return
  }
  editorSaving.value = true
  editorError.value = ''
  try {
    if (editorMode.value === 'create') {
      await registerAlTypeApi({ type_name: editorForm.type_name.trim(), fields })
      ElMessage.success(`类型「${editorForm.type_name}」已注册`)
    } else {
      await evolveAlTypeApi({ type_name: editorForm.type_name, fields, version: editorForm.version })
      ElMessage.success(`类型「${editorForm.type_name}」schema 已演进（v${editorForm.version + 1}）`)
    }
    editorVisible.value = false
    refresh()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { code?: number; message?: string } } })?.response?.data
    if (resp?.code === 100008) {
      // activelist 跨服务码段（≠zhuzhao 10006）——版本冲突统一 409+100008
      editorError.value = '版本冲突：类型已被他人变更，关闭后重新打开编辑（乐观锁）'
    } else {
      editorError.value = resp?.message ?? '保存失败，请稍后重试'
    }
  } finally {
    editorSaving.value = false
  }
}

// ─── 废弃 ───
async function onDeprecate(row: AlTypeDef) {
  try {
    await ElMessageBox.confirm(
      `废弃后「${row.type_name}」的写入操作将被关闭（数据保留可读）。确认废弃？`,
      '废弃类型',
      { type: 'warning', confirmButtonText: '废弃', cancelButtonText: '取消' },
    )
  } catch { return }
  try {
    await deprecateAlTypeApi(row.type_name)
    ElMessage.success(`类型「${row.type_name}」已废弃`)
    refresh()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    ElMessage.error(resp?.message ?? '废弃失败，请稍后重试')
  }
}

// ─── 历史抽屉 ───
const historyVisible = ref(false)
const historyLoading = ref(false)
const historyRows = ref<AlTypeHistoryRow[]>([])
const historyType = ref('')

async function openHistory(row: AlTypeDef) {
  historyType.value = row.type_name
  historyVisible.value = true
  historyLoading.value = true
  try {
    const res = await listAlTypeHistoryApi(row.type_name)
    historyRows.value = res.list ?? []
  } catch {
    historyRows.value = []
  } finally {
    historyLoading.value = false
  }
}

function fieldSummary(fields: AlFieldDef[] | undefined): string {
  return (fields ?? []).map((f) => f.name).join('、') || '—'
}

function formatTime(iso?: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <div class="p-4">
    <el-card shadow="never">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-semibold">名单类型</span>
          <el-button v-permission="'activelist:type:manage'" type="primary" @click="openCreate">注册类型</el-button>
        </div>
      </template>

      <el-table :data="rows" v-loading="typesQuery.isLoading.value" row-key="type_name">
        <el-table-column prop="type_name" label="类型名" min-width="160" />
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
              {{ row.status === 'active' ? '使用中' : '已废弃' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="版本" prop="version" width="80" align="center" />
        <el-table-column label="字段" min-width="240">
          <template #default="{ row }">{{ fieldSummary(row.fields) }}</template>
        </el-table-column>
        <el-table-column label="更新时间" width="170">
          <template #default="{ row }">{{ formatTime(row.updated_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button
              v-permission="'activelist:type:manage'" link type="primary" size="small"
              :disabled="row.status === 'deprecated'" @click="openEvolve(row as AlTypeDef)"
            >演进</el-button>
            <el-button link type="primary" size="small" @click="openHistory(row as AlTypeDef)">历史</el-button>
            <el-button
              v-permission="'activelist:type:manage'" link type="danger" size="small"
              :disabled="row.status === 'deprecated'" @click="onDeprecate(row as AlTypeDef)"
            >废弃</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 注册/演进共用编辑器 -->
    <el-dialog
      v-model="editorVisible"
      :title="editorMode === 'create' ? '注册类型' : `演进「${editorForm.type_name}」（当前 v${editorForm.version}）`"
      width="640px"
    >
      <el-alert v-if="editorError" :title="editorError" type="error" show-icon class="mb-4" :closable="false" />
      <el-form ref="formRef" :model="editorForm" :rules="editorRules" label-width="80px">
        <el-form-item label="类型名" prop="type_name">
          <el-input
            v-model="editorForm.type_name"
            :disabled="editorMode === 'evolve'"
            placeholder="如 ip_blocklist（小写字母开头）"
          />
        </el-form-item>
        <el-form-item label="字段定义">
          <div class="w-full">
            <div v-for="(f, i) in editorForm.fields" :key="i" class="flex items-center gap-2 mb-2">
              <el-input v-model="f.name" placeholder="字段名" class="!w-40" />
              <el-select v-model="f.type" class="!w-32">
                <el-option v-for="t in FIELD_TYPES" :key="t" :label="t" :value="t" />
              </el-select>
              <el-switch v-model="f.required" active-text="必填" inline-prompt class="mr-1" />
              <el-switch v-model="f.sensitive" active-text="敏感" inline-prompt />
              <el-button link type="danger" :disabled="editorForm.fields.length <= 1" @click="removeFieldRow(i)">删</el-button>
            </div>
            <el-button size="small" @click="addFieldRow">+ 添加字段</el-button>
            <div class="text-xs text-gray-400 mt-2">
              演进为全量替换：兼容变更（加可选/放宽）零迁移；破坏性变更（删字段/收紧）允许提交、旧数据懒执行
            </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editorVisible = false">取消</el-button>
        <el-button type="primary" :loading="editorSaving" @click="submitEditor">
          {{ editorMode === 'create' ? '注册' : '提交演进' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 变更历史 -->
    <el-drawer v-model="historyVisible" :title="`「${historyType}」变更历史（新→旧）`" size="480px">
      <div v-loading="historyLoading">
        <div v-for="(h, i) in historyRows" :key="i" class="mb-3 pb-3 border-b border-gray-100 last:border-0">
          <div class="flex items-center gap-2 text-sm">
            <el-tag size="small" :type="h.op === 'register' ? 'success' : 'warning'">{{ h.op }}</el-tag>
            <span class="text-gray-500">v{{ h.version }}</span>
            <span class="text-xs text-gray-400 ml-auto">{{ formatTime(h.created_at) }}</span>
          </div>
          <div class="text-xs text-gray-500 mt-1">{{ fieldSummary(h.fields) }}</div>
        </div>
        <div v-if="!historyLoading && !historyRows.length" class="text-sm text-gray-400">无历史记录</div>
      </div>
    </el-drawer>
  </div>
</template>

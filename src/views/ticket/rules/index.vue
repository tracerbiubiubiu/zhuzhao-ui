<script setup lang="ts">
/**
 * 自动分派规则管理（S3a B3-2——类型管理页族扩展，权限沿用 ticket:type:manage）。
 * 规则=type_code+keyword LIKE → 按 priority 升序首个命中 → 自动 Assign。
 * 决议③：target_user 须属 target_org（后端写侧校验，前端表单提示）。
 */
import { computed, reactive, ref } from 'vue'
import {
  ElAlert, ElButton, ElCard, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber,
  ElOption, ElSelect,
  ElMessage, ElMessageBox, ElSwitch, ElTable, ElTableColumn, ElTag,
  ElEmpty,
} from 'element-plus'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  createAssignmentRuleApi, deleteAssignmentRuleApi, listAssignmentRulesApi,
  updateAssignmentRuleEnabledApi, listTicketTypesApi, type AssignmentRuleRow,
} from '@/api/ticket'
import { getOrgTreeApi, type OrgTreeNode } from '@/api/system/org'
import UserPicker from '@/components/UserPicker/index.vue'
import { useTableFit } from '@vea/hooks'

// keep-alive 契约：name=动态路由名
defineOptions({ name: 'ticket_assignment_rules' })

const queryClient = useQueryClient()
const ruleTable = ref()
useTableFit(ruleTable, () => rulesQuery.data.value)
const rulesQuery = useQuery({ queryKey: ['ticket', 'assignment-rules'], queryFn: listAssignmentRulesApi })
const typesQuery = useQuery({ queryKey: ['ticket', 'types'], queryFn: listTicketTypesApi })
const orgTreeQuery = useQuery({ queryKey: ['system', 'orgs'], queryFn: () => getOrgTreeApi() })

// computed 而非 IIFE：冷加载时 orgTreeQuery 在途、data 为 undefined——快照一次即永久空选项，
// 「目标组织」必填无可选项=UI 建不了规则（仅其他页先预热 ['system','orgs'] 缓存时才"偶然可用"）
const orgOptions = computed(() => {
  const flat: Array<{ value: string; label: string }> = []
  const walk = (nodes: OrgTreeNode[] | undefined) => {
    for (const n of nodes ?? []) {
      flat.push({ value: n.id, label: n.is_virtual ? `${n.name}（虚拟组）` : n.name })
      walk(n.children)
    }
  }
  walk(orgTreeQuery.data.value as OrgTreeNode[] | undefined)
  return flat
})

const dialog = reactive({ visible: false, loading: false, error: '' })
const form = reactive({ type_code: '', keyword: '', priority: 100, target_org: '', target_user: '', enabled: true })

function openCreate() {
  Object.assign(dialog, { visible: true, loading: false, error: '' })
  Object.assign(form, { type_code: '', keyword: '', priority: 100, target_org: '', target_user: '', enabled: true })
}

async function submit() {
  if (!form.type_code || !form.target_org) {
    dialog.error = '工单类型与目标组织必填'
    return
  }
  dialog.loading = true
  dialog.error = ''
  try {
    await createAssignmentRuleApi({
      type_code: form.type_code,
      priority: form.priority,
      keyword: form.keyword || undefined,
      target_org: form.target_org,
      target_user: form.target_user || undefined,
      enabled: form.enabled,
    })
    ElMessage.success('规则已创建')
    dialog.visible = false
    await queryClient.invalidateQueries({ queryKey: ['ticket', 'assignment-rules'] })
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    dialog.error = resp?.message ?? '创建失败'
  } finally {
    dialog.loading = false
  }
}

async function onDelete(row: AssignmentRuleRow) {
  try {
    await ElMessageBox.confirm(`确认删除规则 #${row.id}（${row.type_code}${row.keyword ? ` / ${row.keyword}` : ''}）？`, '危险操作', {
      type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger',
    })
  } catch { return }
  try {
    await deleteAssignmentRuleApi(row.id)
    ElMessage.success('已删除')
    await queryClient.invalidateQueries({ queryKey: ['ticket', 'assignment-rules'] })
  } catch (err: unknown) {
    ElMessage.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '删除失败')
  }
}

async function onToggle(row: AssignmentRuleRow) {
  try {
    await updateAssignmentRuleEnabledApi(row.id, !row.enabled)
    ElMessage.success(row.enabled ? '已停用' : '已启用')
    await queryClient.invalidateQueries({ queryKey: ['ticket', 'assignment-rules'] })
  } catch {
    ElMessage.error('操作失败')
  }
}
</script>

<template>
  <div class="fill-page p-4">
    <el-card shadow="never">
      <!-- 工具行（卡片头收敛批 2026-10-30）：说明+计数左、新建钉右 -->
      <div class="flex flex-wrap items-center gap-2 mb-2">
        <span class="text-xs text-gray-400">
          共 {{ rulesQuery.data.value?.length ?? 0 }} 条 · 工单创建后按 priority 升序遍历——首个 keyword 命中的规则自动分派到 target_user（须属 target_org）；无命中保持 open
        </span>
        <el-button v-permission="'ticket:type:manage'" type="primary" size="small" class="ml-auto !mr-0" data-testid="add-rule" @click="openCreate">新建规则</el-button>
      </div>
      <el-table ref="ruleTable" v-loading="rulesQuery.isLoading.value" :data="rulesQuery.data.value ?? []" stripe>
        <template #empty>
          <el-empty description="暂无规则——新建后按关键词自动分派" :image-size="60">
            <el-button v-permission="'ticket:type:manage'" type="primary" @click="openCreate">新建首个规则</el-button>
          </el-empty>
        </template>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="type_code" label="工单类型" width="120" />
        <el-table-column prop="keyword" label="关键词（LIKE）" min-width="120">
          <template #default="{ row }">
            <el-tag v-if="row.keyword" size="small">{{ row.keyword }}</el-tag>
            <span v-else class="text-gray-400">不限</span>
          </template>
        </el-table-column>
        <el-table-column prop="priority" label="优先级" width="80" align="center" />
        <el-table-column label="目标组织" min-width="120">
          <template #default="{ row }">{{ orgOptions.find((o) => o.value === row.target_org)?.label ?? row.target_org }}</template>
        </el-table-column>
        <el-table-column label="目标处理人" min-width="100">
          <template #default="{ row }">{{ row.target_user ?? '仅分组织' }}</template>
        </el-table-column>
        <el-table-column label="启用" width="80" align="center">
          <template #default="{ row }">
            <el-switch v-permission="'ticket:type:manage'" :model-value="row.enabled" @change="onToggle(row as AssignmentRuleRow)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button v-permission="'ticket:type:manage'" link type="danger" size="small" @click="onDelete(row as AssignmentRuleRow)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialog.visible" title="新建分派规则" width="520px">
      <el-form label-width="110px" @submit.prevent>
        <el-form-item label="工单类型" required>
          <el-select v-model="form.type_code" filterable placeholder="选择类型" class="!w-full">
            <el-option v-for="t in typesQuery.data.value ?? []" :key="t.code" :label="`${t.name}（${t.code}）`" :value="t.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键词">
          <el-input v-model="form.keyword" placeholder="标题包含匹配（可选）" maxlength="100" />
        </el-form-item>
        <el-form-item label="优先级">
          <el-input-number v-model="form.priority" :min="1" :max="9999" controls-position="right" />
          <span class="text-xs text-gray-400 ml-2">值越小越先匹配</span>
        </el-form-item>
        <el-form-item label="目标组织" required>
          <el-select v-model="form.target_org" filterable placeholder="选择组织" class="!w-full">
            <el-option v-for="o in orgOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="目标处理人">
          <UserPicker v-model="form.target_user" />
          <span class="text-xs text-gray-400 ml-2">可选；须属目标组织（决议③）；空=仅分组织不指定人</span>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
      </el-form>
      <el-alert v-if="dialog.error" :title="dialog.error" type="error" show-icon :closable="false" />
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="dialog.loading" @click="submit">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

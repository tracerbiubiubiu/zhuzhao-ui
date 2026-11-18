<script setup lang="ts">
/**
 * 「我的组织」自服务面（P4-W3 收口件——§3.2④ 静态路由，非 admin 委托者唯一可达入口）
 *
 * - 数据源 GET /user/orgs（SelfService 富化行）；选中组织后拉名册
 *   GET /orgs/members/list（L3 owner/admin/全局可读）——**403 即普通成员 → 降级只读视图**
 *   （前端显隐只是体验层，真实边界在后端 L3——§6）
 * - owner/admin 控件：组内角色 member↔admin（SetMemberRole）、数据范围（SetMemberScope）、
 *   移除成员（RemoveMember——不可移除 owner）
 */
import { formatDateTime } from '@/utils/datetime'
import { computed, onActivated, onDeactivated, onScopeDispose, ref } from 'vue'
import { useTableFit } from '@vea/hooks'
import {
  ElButton, ElCard, ElEmpty, ElMessage, ElMessageBox, ElOption, ElPagination, ElSelect,
  ElTable, ElTableColumn, ElTag,
  ElAlert,
} from 'element-plus'
import {
  getMyOrgsApi, getOrgRosterApi, removeMemberApi, setMemberRoleApi, setMemberScopeApi, setOwnersApi,
  type MyOrgItem, type OrgMemberRosterItem,
} from '@/api/org/selfService'

import { createRosterSession, ownersWithMember } from './rosterSession'

defineOptions({ name: 'MyOrg' })

const roster = createRosterSession({
  load: getOrgRosterApi,
  success: (message) => ElMessage.success(message),
  failure: (message) => ElMessage.error(message),
})
const { state, pageSize, canEdit } = roster
onActivated(roster.resume)
onDeactivated(roster.pause)
onScopeDispose(roster.pause)

// ─── 我的组织列表 ───
const orgs = ref<MyOrgItem[]>([])
const orgsLoading = ref(true)
const selectedOrg = computed(() => orgs.value.find((o) => o.org_id === state.orgId))
const readonlyMode = computed(() => state.status === 'readonly')

async function loadOrgs() {
  try {
    orgs.value = await getMyOrgsApi()
    const orgId = orgs.value[0]?.org_id
    if (orgId) void roster.selectOrg(orgId)
  } finally {
    orgsLoading.value = false
  }
}
void loadOrgs()

// ─── 委托操作（owner/admin）───
const ROLE_LABELS: Record<string, string> = { owner: '负责人', admin: '管理员', member: '成员' }
const SCOPE_LABELS: Record<string, string> = { assigned: '仅指派', group: '本组', all: '全部' }

function onRoleChange(row: OrgMemberRosterItem, role: string) {
  if (role === row.org_member_role || (role !== 'member' && role !== 'admin')) return
  return roster.write(row, async ({ orgId, userId, username, send }) => {
    await send(() => setMemberRoleApi({ org_id: orgId, user_id: userId, org_member_role: role }))
    return `已将「${username}」设为${ROLE_LABELS[role]}`
  })
}

function onScopeChange(row: OrgMemberRosterItem, scope: string) {
  if (scope === row.ticket_scope || (scope !== 'assigned' && scope !== 'group' && scope !== 'all')) return
  return roster.write(row, async ({ orgId, userId, username, send }) => {
    await send(() => setMemberScopeApi({ org_id: orgId, user_id: userId, ticket_scope: scope }))
    return `已更新「${username}」的数据范围`
  })
}

function onRemove(row: OrgMemberRosterItem) {
  if (row.org_member_role === 'owner') return
  return roster.write(row, async ({ orgId, userId, username, send }) => {
    const confirmed = await ElMessageBox.confirm(
      `确认将「${username}」移出「${selectedOrg.value?.org_name ?? ''}」？`, '提示', { type: 'warning' },
    ).catch(() => false)
    if (!confirmed) return
    await send(() => removeMemberApi(orgId, userId))
    return '已移除'
  })
}

// ─── 设为负责人（仅 owner 可见；SetOwners 整体替换语义需全量 owner 预取）───
const iAmOwner = computed(() => selectedOrg.value?.org_member_role === 'owner')

function onPromoteOwner(row: OrgMemberRosterItem) {
  if (!iAmOwner.value || row.org_member_role === 'owner') return
  return roster.write(row, async ({ orgId, userId, username, current, send }) => {
    const confirmed = await ElMessageBox.confirm(
      `确认将「${username}」设为「${selectedOrg.value?.org_name ?? ''}」负责人？其将与现有负责人并存（SetOwners 整体替换语义，已保留全部现任）。`,
      '设为负责人', { type: 'warning', confirmButtonText: '确认' },
    ).catch(() => false)
    if (!confirmed || !current()) return

    // 读取与写入使用同一个组织快照。名册超过一页上限时禁止替换负责人。
    const all = await getOrgRosterApi(orgId, 1, 100)
    if (!current()) return
    const owners = ownersWithMember(all, userId)
    await send(() => setOwnersApi(orgId, owners))
    return `已将「${username}」设为负责人`
  })
}

const rosterTable = ref()
useTableFit(rosterTable, () => state.rows)
</script>

<template>
  <!-- 填充链(docs/design/frontend-ui.md):组织卡 flex-none 不参与拉伸,名册卡吃满剩余高度内滚 -->
  <div class="fill-page p-4">
    <el-card shadow="never" class="mb-4 !flex-none">
      <template #header><span class="font-semibold">我的组织</span></template>
      <div v-loading="orgsLoading">
        <el-empty v-if="!orgsLoading && !orgs.length" description="你尚未加入任何组织" />
        <div v-else class="flex flex-wrap gap-3">
          <div
            v-for="org in orgs" :key="org.org_id"
            class="border rounded p-3 cursor-pointer min-w-[220px]"
            :class="org.org_id === state.orgId ? 'border-[var(--el-color-primary)]' : 'border-gray-200'"
            @click="roster.selectOrg(org.org_id ?? '')"
          >
            <div class="flex items-center gap-2">
              <span class="font-semibold">{{ org.org_name }}</span>
              <el-tag v-if="org.is_virtual" size="small" type="warning">虚拟组</el-tag>
              <el-tag v-if="org.is_primary" size="small" type="success">主组织</el-tag>
            </div>
            <div class="text-xs text-gray-400 mt-1">
              我的角色：{{ ROLE_LABELS[org.org_member_role ?? ''] ?? org.org_member_role }}
              · 数据范围：{{ SCOPE_LABELS[org.ticket_scope ?? ''] ?? org.ticket_scope }}
            </div>
          </div>
        </div>
      </div>
    </el-card>

    <el-card v-if="selectedOrg" shadow="never">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-semibold">成员名册 — {{ selectedOrg.org_name }}</span>
          <el-tag v-if="readonlyMode" type="info" size="small">只读（普通成员视图）</el-tag>
        </div>
      </template>
      <el-alert
        v-if="readonlyMode" type="info" :closable="false" class="mb-3"
        title="你是本组织普通成员：仅可见组织信息，成员管理与组内授权由组织负责人/管理员操作。"
      />
      <el-alert v-else-if="state.status === 'error'" :title="state.error" type="error" :closable="false" class="mb-3">
        <el-button size="small" @click="roster.load()">重新读取</el-button>
      </el-alert>
      <div v-else class="min-h-0 flex-initial">
        <el-table ref="rosterTable" v-loading="state.status === 'loading'" :data="state.rows" row-key="user_id" stripe height="100%">
        <template #empty>
          <el-empty description="该组织暂无成员" :image-size="60" />
        </template>
        <el-table-column prop="username" label="用户名" min-width="110" />
        <el-table-column prop="real_name" label="姓名" min-width="90" />
        <el-table-column prop="employee_no" label="工号" width="100" />
        <el-table-column label="组内角色" width="130">
          <template #default="{ row }">
            <el-tag v-if="row.org_member_role === 'owner'" size="small">负责人</el-tag>
            <el-select
              v-else :model-value="row.org_member_role" :disabled="!canEdit" size="small"
              @change="(v: string) => onRoleChange(row, v)"
            >
              <el-option label="成员" value="member" />
              <el-option label="管理员" value="admin" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="数据范围" width="130">
          <template #default="{ row }">
            <el-select :model-value="row.ticket_scope" :disabled="!canEdit" size="small" @change="(v: string) => onScopeChange(row, v)">
              <el-option label="仅指派" value="assigned" />
              <el-option label="本组" value="group" />
              <el-option label="全部" value="all" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column prop="joined_at" label="加入时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.joined_at) || '—' }}</template>
        </el-table-column>
        <el-table-column v-if="!readonlyMode" label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="iAmOwner && row.org_member_role !== 'owner'" link type="primary" size="small"
              :disabled="!canEdit" @click="onPromoteOwner(row)"
            >设为负责人</el-button>
            <el-button
              v-if="row.org_member_role !== 'owner'" link type="danger" size="small"
              :disabled="!canEdit" @click="onRemove(row)"
            >移除</el-button>
          </template>
        </el-table-column>
      </el-table>
      </div>
      <!-- P2-7：名册翻页（后端 PageData 带 total；切换回首页随组织切换） -->
      <div v-if="!readonlyMode" class="mt-3 flex justify-end">
        <el-pagination
          :total="state.total"
          :current-page="state.page"
          :page-size="pageSize"
          layout="total, prev, pager, next"
          @current-change="roster.selectPage"
        />
      </div>
    </el-card>
  </div>
</template>

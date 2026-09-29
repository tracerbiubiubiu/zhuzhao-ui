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
import { computed, ref } from 'vue'
import {
  ElButton, ElCard, ElEmpty, ElMessage, ElMessageBox, ElOption, ElSelect,
  ElTable, ElTableColumn, ElTag,
  ElAlert,
} from 'element-plus'
import {
  getMyOrgsApi, getOrgRosterApi, removeMemberApi, setMemberRoleApi, setMemberScopeApi,
  type MyOrgItem, type OrgMemberRosterItem,
} from '@/api/org/selfService'

defineOptions({ name: 'MyOrg' })

// ─── 我的组织列表 ───
const orgs = ref<MyOrgItem[]>([])
const orgsLoading = ref(true)
const selectedOrgId = ref('')

const selectedOrg = computed(() => orgs.value.find((o) => o.org_id === selectedOrgId.value))

async function loadOrgs() {
  orgsLoading.value = true
  try {
    orgs.value = await getMyOrgsApi()
    selectedOrgId.value = orgs.value[0]?.org_id ?? ''
    if (selectedOrgId.value) await loadRoster()
  } finally {
    orgsLoading.value = false
  }
}
void loadOrgs()

// ─── 名册（L3 判定驱动可见性）───
const roster = ref<OrgMemberRosterItem[]>([])
const rosterLoading = ref(false)
/** 普通成员：名册 403 → 只读组织信息（owner/admin 控件不渲染） */
const readonlyMode = ref(false)

async function loadRoster() {
  if (!selectedOrgId.value) return
  rosterLoading.value = true
  readonlyMode.value = false
  try {
    const resp = await getOrgRosterApi(selectedOrgId.value)
    roster.value = resp.list ?? []
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status
    if (status === 403) {
      readonlyMode.value = true // 普通成员——L3 判定结果，非错误
      roster.value = []
    } else {
      throw err // 其他错误走全局 toast
    }
  } finally {
    rosterLoading.value = false
  }
}

function onSelectOrg(id: string) {
  selectedOrgId.value = id
  void loadRoster()
}

// ─── 委托操作（owner/admin）───
const ROLE_LABELS: Record<string, string> = { owner: '负责人', admin: '管理员', member: '成员' }
const SCOPE_LABELS: Record<string, string> = { assigned: '仅指派', group: '本组', all: '全部' }

async function onRoleChange(row: OrgMemberRosterItem, role: string) {
  if (role === row.org_member_role || role === 'owner') return
  try {
    await setMemberRoleApi({ org_id: selectedOrgId.value, user_id: String(row.user_id), org_member_role: role as 'member' | 'admin' })
    ElMessage.success(`已将「${row.username}」设为${ROLE_LABELS[role]}`)
    await loadRoster()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    ElMessage.error(resp?.message ?? '操作失败')
    await loadRoster() // 失败回显当前值
  }
}

async function onScopeChange(row: OrgMemberRosterItem, scope: string) {
  try {
    await setMemberScopeApi({ org_id: selectedOrgId.value, user_id: String(row.user_id), ticket_scope: scope as 'assigned' | 'group' | 'all' })
    ElMessage.success(`已更新「${row.username}」的数据范围`)
    await loadRoster()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    ElMessage.error(resp?.message ?? '操作失败（scope=all 仅全局管理员可授）')
    await loadRoster()
  }
}

async function onRemove(row: OrgMemberRosterItem) {
  try {
    await ElMessageBox.confirm(`确认将「${row.username}」移出组织？`, '提示', { type: 'warning' })
  } catch {
    return
  }
  await removeMemberApi(selectedOrgId.value, String(row.user_id))
  ElMessage.success('已移除')
  await loadRoster()
}
</script>

<template>
  <div class="p-4">
    <el-card shadow="never" class="mb-4">
      <template #header><span class="font-semibold">我的组织</span></template>
      <div v-loading="orgsLoading">
        <el-empty v-if="!orgsLoading && !orgs.length" description="你尚未加入任何组织" />
        <div v-else class="flex flex-wrap gap-3">
          <div
            v-for="org in orgs" :key="org.org_id"
            class="border rounded p-3 cursor-pointer min-w-[220px]"
            :class="org.org_id === selectedOrgId ? 'border-[var(--el-color-primary)]' : 'border-gray-200'"
            @click="onSelectOrg(org.org_id ?? '')"
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
      <el-table v-else v-loading="rosterLoading" :data="roster" row-key="user_id" stripe>
        <el-table-column prop="username" label="用户名" min-width="110" />
        <el-table-column prop="real_name" label="姓名" min-width="90" />
        <el-table-column prop="employee_no" label="工号" width="100" />
        <el-table-column label="组内角色" width="130">
          <template #default="{ row }">
            <el-tag v-if="row.org_member_role === 'owner'" size="small">负责人</el-tag>
            <el-select
              v-else :model-value="row.org_member_role" size="small"
              @change="(v: string) => onRoleChange(row, v)"
            >
              <el-option label="成员" value="member" />
              <el-option label="管理员" value="admin" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="数据范围" width="130">
          <template #default="{ row }">
            <el-select :model-value="row.ticket_scope" size="small" @change="(v: string) => onScopeChange(row, v)">
              <el-option label="仅指派" value="assigned" />
              <el-option label="本组" value="group" />
              <el-option label="全部" value="all" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column prop="joined_at" label="加入时间" width="170">
          <template #default="{ row }">{{ row.joined_at ? new Date(row.joined_at).toLocaleString('zh-CN', { hour12: false }) : '—' }}</template>
        </el-table-column>
        <el-table-column v-if="!readonlyMode" label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.org_member_role !== 'owner'" link type="danger" size="small"
              @click="onRemove(row)"
            >移除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

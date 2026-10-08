<script setup lang="ts">
/**
 * 用户管理（P4-W3 列表范例页——01 §5 范式载体）
 *
 * 范式约定（后续列表页照此）：
 * - ProTable 封装（禁手搓 el-table+分页）；搜索区严格按端点参数——username 模糊/
 *   employee_no 精确/role 精确/status（无 org/real_name 项，不假搜索）
 * - 按钮权限码 = menus.permission 字面值（user:create/update/delete/status/
 *   reset_password/assign_role/assign_org——B13 域 4）
 * - 乐观锁：update 回传行内 version；10006 冲突 → 关对话框+刷新列表提示重试（§3.3 非 toast 路径）
 * - 时间本地化渲染（new Date + toLocaleString——后端 RFC3339 带时区）
 * - 服务端态走 vue-query（角色字典 queryKey=['system','roles']）；列表态归 ProTable/useCrud
 */
import { computed, reactive, ref } from 'vue'
import {
  ElAlert, ElButton, ElCard, ElDialog, ElForm, ElFormItem, ElInput, ElMessage,
  ElMessageBox, ElOption, ElSelect, ElTag, ElTree,
} from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { getOrgTreeApi, type OrgTreeNode } from '@/api/system/org'
import { useQuery } from '@tanstack/vue-query'
import ProTable from '@/components/ProTable/index.vue'
import type { ProTableColumn } from '@/components/ProTable/types'
import { listRolesApi } from '@/api/system/role'
import {
  createUserApi, deleteUserApi, getUserOrgsApi, getUserRoleIdsApi, listUsersApi, resetUserPasswordApi,
  setUserOrgsApi, setUserRolesApi, updateUserApi, updateUserStatusApi, type UserRow,
} from '@/api/system/user'

// keep-alive 契约：name=动态路由名（tagsView.cachedViews 存路由名，include 按组件名匹配）
defineOptions({ name: 'system_user' })

const tableRef = ref<InstanceType<typeof ProTable>>()

// ─── 角色字典（vue-query：queryKey=[域,资源]，写后按前缀 invalidate）───
const rolesQuery = useQuery({ queryKey: ['system', 'roles'], queryFn: listRolesApi })
const roleOptions = computed(() => rolesQuery.data.value ?? [])

// ─── 搜索（严格对齐 GET /users 四参数）───
const search = reactive({ username: '', employee_no: '', role: '', status: undefined as number | undefined })

function onSearch() {
  tableRef.value?.refresh({ resetPage: true })
}

function onReset() {
  search.username = ''
  search.employee_no = ''
  search.role = ''
  search.status = undefined
  tableRef.value?.refresh({ resetPage: true })
}

/** fetcher：空串参数不发送（后端空串语义未定义，防误过滤） */
function fetcher(params: { page: number; page_size: number }) {
  return listUsersApi({
    page: params.page,
    page_size: params.page_size,
    ...(search.username ? { username: search.username } : {}),
    ...(search.employee_no ? { employee_no: search.employee_no } : {}),
    ...(search.role ? { role: search.role } : {}),
    ...(search.status !== undefined ? { status: search.status } : {}),
  })
}

const columns: ProTableColumn[] = [
  { prop: 'username', label: '用户名', minWidth: 120 },
  { prop: 'employee_no', label: '工号', width: 110 },
  { prop: 'real_name', label: '姓名', minWidth: 100 },
  { prop: 'email', label: '邮箱', minWidth: 160 },
  { prop: 'phone', label: '手机号', width: 120 },
  { prop: 'status', label: '状态', width: 80, align: 'center', slot: 'status' },
  { prop: 'created_at', label: '创建时间', width: 170, slot: 'created_at' },
  { prop: 'actions', label: '操作', width: 320, fixed: 'right', slot: 'actions', wrap: true },
]

function formatTime(iso: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

// ─── 新建/编辑对话框 ───
const editVisible = ref(false)
const editIsCreate = ref(true)
const editLoading = ref(false)
const editError = ref('')
const editFormRef = ref<FormInstance>()
const editForm = reactive({
  id: '',
  version: 0,
  username: '',
  employee_no: '',
  password: '',
  real_name: '',
  email: '',
  phone: '',
})

const editRules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }, { max: 50, message: '不超过 50 字', trigger: 'blur' }],
  password: [{ required: true, message: '请输入初始密码', trigger: 'blur' }, { min: 8, message: '至少 8 位', trigger: 'blur' }],
  email: [{ type: 'email', message: '邮箱格式不正确', trigger: 'blur' }],
}

function openCreate() {
  editIsCreate.value = true
  editError.value = ''
  Object.assign(editForm, { id: '', version: 0, username: '', employee_no: '', password: '', real_name: '', email: '', phone: '' })
  editVisible.value = true
}

function openEdit(row: UserRow) {
  editIsCreate.value = false
  editError.value = ''
  Object.assign(editForm, {
    id: row.id, version: row.version, username: row.username,
    employee_no: row.employee_no, password: '',
    real_name: row.real_name, email: row.email, phone: row.phone,
  })
  editVisible.value = true
}

async function submitEdit() {
  const valid = await editFormRef.value?.validate().catch(() => false)
  if (!valid) return
  editLoading.value = true
  editError.value = ''
  try {
    if (editIsCreate.value) {
      await createUserApi({
        username: editForm.username,
        password: editForm.password,
        employee_no: editForm.employee_no || undefined,
        real_name: editForm.real_name || undefined,
        email: editForm.email || undefined,
        phone: editForm.phone || undefined,
      })
      ElMessage.success('用户已创建')
    } else {
      await updateUserApi({
        id: editForm.id,
        version: editForm.version, // 乐观锁回传（列表行取）
        employee_no: editForm.employee_no || undefined,
        real_name: editForm.real_name || undefined,
        email: editForm.email || undefined,
        phone: editForm.phone || undefined,
      })
      ElMessage.success('用户已更新')
    }
    editVisible.value = false
    tableRef.value?.refresh({ resetPage: editIsCreate.value })
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { code?: number; message?: string } } })?.response?.data
    if (resp?.code === 10006) {
      // 乐观锁冲突范式（01 §3.3：重拉让用户重填，非 toast）——列表行 version 已过期
      editVisible.value = false
      await tableRef.value?.refresh()
      ElMessage.warning('该用户已被他人修改，列表已刷新，请重新编辑')
    } else {
      editError.value = resp?.message ?? '保存失败，请稍后重试'
    }
  } finally {
    editLoading.value = false
  }
}

// ─── 状态启停 ───
async function toggleStatus(row: UserRow) {
  const target = row.status === 1 ? '禁用' : '启用'
  try {
    await ElMessageBox.confirm(`确认${target}用户「${row.username}」？`, '提示', { type: 'warning' })
  } catch {
    return
  }
  await updateUserStatusApi(row.id, (row.status === 1 ? 0 : 1) as 0 | 1)
  ElMessage.success(`已${target}`)
  tableRef.value?.refresh()
}

// ─── 重置密码 ───
const resetVisible = ref(false)
const resetLoading = ref(false)
const resetError = ref('')
const resetFormRef = ref<FormInstance>()
const resetForm = reactive({ userId: '', username: '', password: '' })
const resetRules: FormRules = { password: [{ required: true, message: '请输入新密码', trigger: 'blur' }, { min: 8, message: '至少 8 位', trigger: 'blur' }] }

function openReset(row: UserRow) {
  resetError.value = ''
  Object.assign(resetForm, { userId: row.id, username: row.username, password: '' })
  resetVisible.value = true
}

async function submitReset() {
  const valid = await resetFormRef.value?.validate().catch(() => false)
  if (!valid) return
  resetLoading.value = true
  resetError.value = ''
  try {
    await resetUserPasswordApi(resetForm.userId, resetForm.password)
    ElMessage.success(`已重置「${resetForm.username}」的密码`)
    resetVisible.value = false
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    resetError.value = resp?.message ?? '重置失败，请稍后重试'
  } finally {
    resetLoading.value = false
  }
}

// ─── 分配角色（整体替换语义）───
const rolesVisible = ref(false)
const rolesLoading = ref(false)
const rolesChecking = ref(false)
/** 回显竞态守卫序号（P2-5）：连开多行对话框时仅最后一次打开的响应生效 */
let rolesCheckSeq = 0
const rolesForm = reactive({ userId: '', username: '', employeeNo: '', selected: [] as string[] })

function openRoles(row: UserRow) {
  Object.assign(rolesForm, { userId: row.id, username: row.username, employeeNo: row.employee_no, selected: [] })
  rolesVisible.value = true
  // 初始勾选回显：GET /users/:id/roles 单发反查（P2-5 新端点——替代「工号精确+
  // 角色过滤」N+1 反查；无工号用户自此也可回显）。竞态守卫：快速连开多行对话框时
  // 仅最后一次打开的响应生效（audit 指出的对话框竞态面）
  rolesChecking.value = true
  const seq = ++rolesCheckSeq
  getUserRoleIdsApi(row.id)
    .then((ids) => { if (seq === rolesCheckSeq) rolesForm.selected = ids })
    .catch(() => { /* 403/404 静默——留空勾选集，保存仍为显式整体替换 */ })
    .finally(() => { if (seq === rolesCheckSeq) rolesChecking.value = false })
}

async function submitRoles() {
  rolesLoading.value = true
  try {
    await setUserRolesApi(rolesForm.userId, rolesForm.selected) // string[] 直传（P3-6：ID 数组发送侧勿 Number 化）
    ElMessage.success(`已更新「${rolesForm.username}」的角色（整体替换）`)
    rolesVisible.value = false
    tableRef.value?.refresh()
  } finally {
    rolesLoading.value = false
  }
}

// ─── 分配组织（P2-12：树勾选全量替换 + 主组织可选）───
const orgsVisible = ref(false)
const orgsLoading = ref(false)
const orgsChecking = ref(false)
const orgsError = ref('')
const orgTreeRef = ref<OrgTreeInstance>()
const orgTreeData = ref<OrgTreeNode[]>([])
const orgsForm = reactive({ userId: '', username: '' })
const primaryOrgId = ref('')
/** 树勾选态（el-tree 勾选非响应式——经 @check 事件镜像，供主组织下拉与校验用） */
const checkedOrgIds = ref<string[]>([])

/** id → 组织名（树扁平化；含虚拟组标注） */
const orgNameMap = computed(() => {
  const map = new Map<string, OrgTreeNode>()
  const walk = (nodes: OrgTreeNode[] | undefined) => {
    for (const n of nodes ?? []) {
      map.set(String(n.id), n)
      walk(n.children)
    }
  }
  walk(orgTreeData.value)
  return map
})
const orgLabelOf = (id: string): string => {
  const n = orgNameMap.value.get(id)
  return n ? (n.is_virtual ? `${n.name}（虚拟组）` : n.name) : id
}

function onOrgCheck() {
  checkedOrgIds.value = (orgTreeRef.value?.getCheckedKeys(false) ?? []).map(String)
  // 主组织被取消勾选 → 同步清空，防提交悬空引用
  if (primaryOrgId.value && !checkedOrgIds.value.includes(primaryOrgId.value)) primaryOrgId.value = ''
}

/** el-tree 最小接口（role 页同款，避开组件类型体操） */
interface OrgTreeInstance {
  setCheckedKeys: (keys: Array<string | number>, leafOnly?: boolean) => void
  getCheckedKeys: (leafOnly?: boolean) => Array<string | number>
}

async function openOrgs(row: UserRow) {
  Object.assign(orgsForm, { userId: row.id, username: row.username })
  orgsVisible.value = true
  orgsError.value = ''
  orgsChecking.value = true
  try {
    const [tree, userOrgs] = await Promise.all([getOrgTreeApi(), getUserOrgsApi(row.id)])
    orgTreeData.value = tree
    primaryOrgId.value = userOrgs.find((o) => o.is_primary)?.org_id ?? ''
    // 等树渲染后回填勾选（树数据同帧到，直接 set）
    orgTreeRef.value?.setCheckedKeys(userOrgs.map((o) => o.org_id), false)
    checkedOrgIds.value = userOrgs.map((o) => o.org_id)
  } catch (err: unknown) {
    orgsError.value = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '加载组织信息失败'
  } finally {
    orgsChecking.value = false
  }
}

async function submitOrgs() {
  const keys = checkedOrgIds.value
  if (primaryOrgId.value && !keys.includes(primaryOrgId.value)) {
    orgsError.value = '主组织须在已勾选组织内'
    return
  }
  try {
    await ElMessageBox.confirm(`保存将整体替换「${orgsForm.username}」的组织归属（勾选 ${keys.length} 个）。确认？`, '整体替换', {
      type: 'warning', confirmButtonText: '保存',
    })
  } catch {
    return
  }
  orgsLoading.value = true
  orgsError.value = ''
  try {
    await setUserOrgsApi(orgsForm.userId, keys, primaryOrgId.value || null)
    ElMessage.success('组织归属已更新（整体替换）')
    orgsVisible.value = false
    tableRef.value?.refresh()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { code?: number; message?: string } } })?.response?.data
    orgsError.value = resp?.message ?? '保存失败，请稍后重试'
  } finally {
    orgsLoading.value = false
  }
}

// ─── 删除 ───
async function onDelete(row: UserRow) {
  try {
    await ElMessageBox.confirm(`确认删除用户「${row.username}」？该操作不可恢复。`, '危险操作', {
      type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger',
    })
  } catch {
    return
  }
  await deleteUserApi(row.id)
  ElMessage.success('已删除')
  tableRef.value?.refresh()
}
</script>

<template>
  <div class="p-4">
    <el-card shadow="never">
      <ProTable ref="tableRef" :columns="columns" :fetcher="fetcher">
        <template #search>
          <el-form inline @submit.prevent>
            <el-form-item label="用户名">
              <el-input v-model="search.username" placeholder="用户名（模糊）" clearable class="!w-[180px]" @keyup.enter="onSearch" />
            </el-form-item>
            <el-form-item label="工号">
              <el-input v-model="search.employee_no" placeholder="工号（精确）" clearable class="!w-[160px]" @keyup.enter="onSearch" />
            </el-form-item>
            <el-form-item label="角色">
              <el-select v-model="search.role" placeholder="全部" clearable class="!w-[140px]">
                <el-option v-for="r in roleOptions" :key="r.id" :label="r.name" :value="r.code" />
              </el-select>
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="search.status" placeholder="全部" clearable class="!w-[100px]">
                <el-option label="启用" :value="1" />
                <el-option label="禁用" :value="0" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="onSearch">查询</el-button>
              <el-button @click="onReset">重置</el-button>
            </el-form-item>
          </el-form>
        </template>

        <template #toolbar>
          <div>
            <el-button v-permission="'user:create'" type="primary" @click="openCreate">新建用户</el-button>
          </div>
          <div />
        </template>

        <template #status="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'danger'" size="small">
            {{ row.status === 1 ? '启用' : '禁用' }}
          </el-tag>
        </template>

        <template #created_at="{ row }">{{ formatTime(row.created_at) }}</template>

        <template #actions="{ row }">
          <el-button v-permission="'user:update'" link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button v-permission="'user:status'" link :type="row.status === 1 ? 'warning' : 'success'" size="small" @click="toggleStatus(row)">
            {{ row.status === 1 ? '禁用' : '启用' }}
          </el-button>
          <el-button v-permission="'user:reset_password'" link type="primary" size="small" @click="openReset(row)">重置密码</el-button>
          <el-button v-permission="'user:assign_role'" link type="primary" size="small" @click="openRoles(row)">分配角色</el-button>
          <el-button v-permission="'user:assign_org'" link type="primary" size="small" @click="openOrgs(row)">分配组织</el-button>
          <el-button v-permission="'user:delete'" link type="danger" size="small" @click="onDelete(row)">删除</el-button>
        </template>
      </ProTable>
    </el-card>

    <!-- 新建/编辑 -->
    <el-dialog v-model="editVisible" :title="editIsCreate ? '新建用户' : '编辑用户'" width="480px">
      <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-width="80px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="editForm.username" :disabled="!editIsCreate" />
        </el-form-item>
        <el-form-item v-if="editIsCreate" label="初始密码" prop="password">
          <el-input v-model="editForm.password" type="password" show-password placeholder="至少 8 位" />
        </el-form-item>
        <el-form-item label="工号">
          <el-input v-model="editForm.employee_no" placeholder="如 E000010" />
        </el-form-item>
        <el-form-item label="姓名">
          <el-input v-model="editForm.real_name" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="editForm.email" />
        </el-form-item>
        <el-form-item label="手机号">
          <el-input v-model="editForm.phone" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editLoading" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 重置密码 -->
    <el-dialog :model-value="resetVisible" title="重置密码" width="420px" @update:model-value="resetVisible = $event">
      <el-form ref="resetFormRef" :model="resetForm" :rules="resetRules" label-width="80px">
        <el-form-item label="用户">
          <el-input :model-value="resetForm.username" disabled />
        </el-form-item>
        <el-form-item label="新密码" prop="password">
          <el-input v-model="resetForm.password" type="password" show-password placeholder="至少 8 位" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resetVisible = false">取消</el-button>
        <el-button type="primary" :loading="resetLoading" @click="submitReset">确认重置</el-button>
      </template>
    </el-dialog>

    <!-- 分配角色 -->
    <el-dialog :model-value="rolesVisible" title="分配角色" width="480px" @update:model-value="rolesVisible = $event">
      <el-form :model="rolesForm" label-width="80px">
        <el-form-item label="用户">
          <el-input :model-value="rolesForm.username" disabled />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="rolesForm.selected" multiple :loading="rolesChecking" class="!w-full" placeholder="选择角色">
            <el-option v-for="r in roleOptions" :key="r.id" :label="r.name" :value="r.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <p class="text-xs text-gray-400 px-4">保存将整体替换该用户的全部角色。</p>
      <template #footer>
        <el-button @click="rolesVisible = false">取消</el-button>
        <el-button type="primary" :loading="rolesLoading" @click="submitRoles">保存</el-button>
      </template>
    </el-dialog>

    <!-- 分配组织（P2-12：全量替换 + 主组织） -->
    <el-dialog :model-value="orgsVisible" title="分配组织" width="520px" @update:model-value="orgsVisible = $event">
      <el-form label-width="80px" @submit.prevent>
        <el-form-item label="用户">
          <el-input :model-value="orgsForm.username" disabled />
        </el-form-item>
        <el-form-item label="组织">
          <el-tree
            ref="orgTreeRef"
            v-loading="orgsChecking"
            :data="orgTreeData"
            node-key="id"
            :props="{ label: 'name', children: 'children' }"
            show-checkbox
            check-strictly
            default-expand-all
            class="max-h-[300px] overflow-auto border rounded p-2 w-full"
            @check="onOrgCheck"
          >
            <template #default="{ data }">
              <span class="flex items-center gap-2">
                <span>{{ data.name }}</span>
                <el-tag v-if="data.is_virtual" size="small" type="info">虚拟组</el-tag>
              </span>
            </template>
          </el-tree>
        </el-form-item>
        <el-form-item label="主组织">
          <el-select v-model="primaryOrgId" clearable placeholder="（不指定）" class="!w-full">
            <el-option v-for="id in checkedOrgIds" :key="id" :label="orgLabelOf(id)" :value="id" />
          </el-select>
        </el-form-item>
      </el-form>
      <p class="text-xs text-gray-400 px-4">保存将整体替换该用户的全部组织归属；主组织须在勾选内。</p>
      <el-alert v-if="orgsError" :title="orgsError" type="error" show-icon class="mt-2" :closable="false" />
      <template #footer>
        <el-button @click="orgsVisible = false">取消</el-button>
        <el-button type="primary" :loading="orgsLoading" @click="submitOrgs">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

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
import { apiErrorBody } from '@/utils/apiError'
import { formatDateTime } from '@/utils/datetime'
import { computed, nextTick, onDeactivated, onScopeDispose, reactive, ref } from 'vue'
import { assignmentIds } from '@/api/system/assignmentPayload'
import { createOrgsEditor, createRolesEditor } from './assignmentEditors'
import { createStatusOperation } from './statusOperation'
import { getSessionGeneration } from '@/common/auth/tokenStorage'
import { useUserStore } from '@/store/modules/user'
import {
  ElAlert, ElButton, ElCard, ElDialog, ElDropdown, ElDropdownItem, ElDropdownMenu,
  ElForm, ElFormItem, ElInput, ElMessage, ElMessageBox, ElOption, ElSelect, ElTag, ElTree,
} from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { usePermission } from '@/common/auth'
import { useAutoFilterRun } from '@vea/hooks'
import { getOrgTreeApi, type OrgTreeNode } from '@/api/system/org'
import { useQuery } from '@tanstack/vue-query'
import ProTable from '@/components/ProTable/index.vue'
import type { ProTableColumn } from '@/components/ProTable/types'
import { listRolesApi } from '@/api/system/role'
import {
  createUserApi, deleteUserApi, getUserOrgsApi, getUserRoleIdsApi, listUsersApi, resetUserPasswordApi,
  setUserOrgsApi, setUserRolesApi, updateUserApi, updateUserStatusApi, getUserStatusResultApi, type UserRow,
} from '@/api/system/user'

// keep-alive 契约：name=动态路由名（tagsView.cachedViews 存路由名，include 按组件名匹配）
defineOptions({ name: 'system_user' })

const tableRef = ref<InstanceType<typeof ProTable>>()

// ─── 角色字典（vue-query：queryKey=[域,资源]，写后按前缀 invalidate）───
const rolesQuery = useQuery({ queryKey: ['system', 'roles'], queryFn: listRolesApi })
const roleOptions = computed(() => rolesQuery.data.value ?? [])

// ─── 搜索（严格对齐 GET /users 四参数）───
const search = reactive({ username: '', employee_no: '', role: '', status: undefined as number | undefined })

// 筛选即时生效（筛选栏配方触发口径：控件变更即查，文本防抖 300ms 收敛）
useAutoFilterRun(
  () => ({ ...search }),
  () => tableRef.value?.refresh({ resetPage: true }),
)

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
  { prop: 'actions', label: '操作', width: 250, fixed: 'right', slot: 'actions', wrap: true },
]

// ─── 操作列「更多」下拉（业界主操作+收尾模式）：低频动作收进菜单，列宽 320→250 单行放下；
// 删除入菜单顺带多一层防误触。四项全无权限则整个下拉不渲染（防空菜单）。
const { hasAny, hasPerm } = usePermission()
const hasUserMore = computed(() =>
  hasAny('user:reset_password', 'user:assign_role', 'user:assign_org', 'user:delete'),
)

type UserMoreCommand = 'reset' | 'roles' | 'orgs' | 'delete'
function onMoreCommand(cmd: UserMoreCommand, row: UserRow) {
  if (cmd === 'reset') openReset(row)
  else if (cmd === 'roles') openRoles(row)
  else if (cmd === 'orgs') openOrgs(row)
  else onDelete(row)
}

function formatTime(iso: string): string {
  if (!iso) return '—'
  return formatDateTime(iso)
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
    const resp = apiErrorBody(err)
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
const statusOperation = createStatusOperation({
  principalId: useUserStore().profile?.id ?? '',
  // 延迟访问：浏览器禁用存储时由控制器停止写入，不能先发请求再补操作号。
  storage: { getItem: (key) => sessionStorage.getItem(key), setItem: (key, value) => sessionStorage.setItem(key, value) },
  generation: getSessionGeneration,
  hasPermission: () => hasPerm('user:status'),
  newKey: () => crypto.randomUUID(),
  write: updateUserStatusApi,
  read: getUserStatusResultApi,
})
const statusState = statusOperation.state
const statusResultVisible = ref(false)
const statusQueryKey = ref(statusState.operation?.operationId ?? '')
const statusPreparing = ref(false)
const statusUnresolved = computed(() => !!statusState.operation && !['completed', 'superseded', 'rejected'].includes(statusState.operation.phase))
const statusSummary = computed(() => {
  switch (statusState.operation?.phase) {
    case 'unknown': return '结果待核查：响应丢失或服务故障不能证明是否提交，请按原操作号查询，勿重复启停。'
    case 'submitted': return '状态操作提交成功；当前响应未包含同步结果，请按原操作号查询。'
    case 'pending': return '状态操作已提交，会话同步待恢复。请保留原操作号，待受权恢复并确认同步完成后再另行启用。'
    case 'completed': return '原状态操作已提交，会话同步已完成。此回执不代表目标账号此后的当前状态。'
    case 'superseded': return '原状态操作已提交，后续账号变更已取代其会话同步。请刷新查看当前状态。'
    case 'rejected': return '本次操作被明确拒绝，未执行本次状态变更。请核对输入和当前权限。'
    default: return '输入首次提交前保留的操作号，按当前权限查询原结果。查询失败或暂未查到不代表原操作没有提交。'
  }
})
function openStatusResult() {
  statusQueryKey.value = statusState.operation?.operationId ?? ''
  statusResultVisible.value = true
}
async function toggleStatus(row: UserRow) {
  if (statusPreparing.value || statusOperation.blocked() || !hasPerm('user:status')) return
  statusPreparing.value = true
  const generation = getSessionGeneration()
  const target = row.status === 1 ? '禁用' : '启用'
  try {
    await ElMessageBox.confirm(`确认${target}用户「${row.username}」？`, '提示', { type: 'warning' })
    if (generation !== getSessionGeneration() || !hasPerm('user:status')) return
    const pending = statusOperation.submit(row.id, row.status === 1 ? 0 : 1)
    openStatusResult()
    await pending
    if (generation === getSessionGeneration()) tableRef.value?.refresh()
  } catch {
    // 取消确认不产生安全写。
  } finally {
    statusPreparing.value = false
  }
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

// ─── 全量替换编辑：只用绑定本次目标/世代的成功快照，读取失败禁止提交 ───
const rolesEditor = createRolesEditor({
  loadIds: getUserRoleIdsApi,
  loadOptions: listRolesApi, // 每次打开重新取字典，失败不借用搜索区的旧cache。
  hasPermission: () => hasPerm('user:assign_role'),
  save: setUserRolesApi,
  success: (target) => {
    ElMessage.success(`已更新「${target.username}」的直接角色（整体替换）`)
    tableRef.value?.refresh()
  },
})
const rolesState = rolesEditor.state
const rolesDraft = computed(() => rolesState.draft)
const openRoles = (row: UserRow) => rolesEditor.open(row)
const submitRoles = () => rolesEditor.submit()

interface OrgTreeInstance {
  setCheckedKeys: (keys: Array<string | number>, leafOnly?: boolean) => void
  getCheckedKeys: (leafOnly?: boolean) => Array<string | number>
}
const orgTreeRef = ref<OrgTreeInstance>()
const orgsEditor = createOrgsEditor({
  loadTree: () => getOrgTreeApi({ _silentError: true }),
  loadMemberships: getUserOrgsApi,
  hasPermission: () => hasPerm('user:assign_org'),
  async prepareTree(draft, current) {
    await nextTick() // 数据交给树并渲染后再回填；旧世代不得触碰新树。
    if (!current()) return
    const tree = orgTreeRef.value
    if (!tree) throw new Error('组织树尚未就绪，请重试')
    tree.setCheckedKeys([...draft.selected], false)
    const checked = assignmentIds(tree.getCheckedKeys(false))
    if (checked.length !== draft.selected.length || draft.selected.some((id) => !checked.includes(id))) throw new Error('已有组织未完整回填，请重试或由受权管理员核查')
  },
  async confirm(target, payload) {
    try {
      await ElMessageBox.confirm(`保存将整体替换「${target.username}」的组织归属（勾选 ${payload.ids.length} 个）。确认？`, '整体替换', { type: 'warning', confirmButtonText: '保存' })
      return true
    } catch {
      return false
    }
  },
  save: setUserOrgsApi,
  success: () => {
    ElMessage.success('组织归属已更新（整体替换）')
    tableRef.value?.refresh()
  },
})
const orgsState = orgsEditor.state
const orgsDraft = computed(() => orgsState.draft)
const openOrgs = (row: UserRow) => orgsEditor.open(row)
const submitOrgs = () => orgsEditor.submit()
const orgNameMap = computed(() => {
  const map = new Map<string, OrgTreeNode>()
  const walk = (nodes: OrgTreeNode[]) => nodes.forEach((node) => { map.set(node.id, node); walk(node.children ?? []) })
  walk(orgsDraft.value?.tree ?? [])
  return map
})
const orgLabelOf = (id: string) => {
  const node = orgNameMap.value.get(id)
  return node ? `${node.name}${node.is_virtual ? '（虚拟组）' : ''}` : id
}
function onOrgCheck() {
  if (!orgsEditor.editable() || !orgsDraft.value || !orgTreeRef.value) return
  try {
    const checked = assignmentIds(orgTreeRef.value.getCheckedKeys(false))
    orgsDraft.value.selected = checked
    if (orgsDraft.value.primary && !checked.includes(orgsDraft.value.primary)) orgsDraft.value.primary = ''
  } catch {
    orgsState.ready = false
    orgsState.error = '组织勾选数据异常，请重试或由受权管理员核查'
  }
}
function closeAssignments() {
  rolesEditor.close()
  orgsEditor.close()
}
onDeactivated(closeAssignments)
onScopeDispose(closeAssignments)

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
  <div class="fill-page p-4">
    <el-card shadow="never">
      <ProTable ref="tableRef" :columns="columns" :fetcher="fetcher" fill>
        <template #search>
          <el-form inline @submit.prevent>
            <el-form-item label="用户名">
              <el-input v-model="search.username" placeholder="用户名（模糊）" clearable class="!w-[180px]" />
            </el-form-item>
            <el-form-item label="工号">
              <el-input v-model="search.employee_no" placeholder="工号（精确）" clearable class="!w-[160px]" />
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
            <el-form-item class="ml-auto !mr-0">
              <el-button @click="onReset">重置</el-button>
            </el-form-item>
          </el-form>
        </template>

        <template #toolbar>
          <div>
            <el-button v-permission="'user:create'" type="primary" @click="openCreate">新建用户</el-button>
            <el-button v-permission="'user:status'" @click="openStatusResult">启停操作结果</el-button>
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
          <el-button v-permission="'user:status'" link :type="row.status === 1 ? 'warning' : 'success'" size="small" :disabled="statusPreparing || statusOperation.blocked()" @click="toggleStatus(row)">
            {{ row.status === 1 ? '禁用' : '启用' }}
          </el-button>
          <el-dropdown
            v-if="hasUserMore"
            class="user-more"
            @command="(cmd: UserMoreCommand) => onMoreCommand(cmd, row as UserRow)"
          >
            <el-button link type="primary" size="small">更多</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-permission="'user:reset_password'" command="reset">重置密码</el-dropdown-item>
                <el-dropdown-item v-permission="'user:assign_role'" command="roles">分配角色</el-dropdown-item>
                <el-dropdown-item v-permission="'user:assign_org'" command="orgs">分配组织</el-dropdown-item>
                <el-dropdown-item v-permission="'user:delete'" command="delete" class="user-more-danger">删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </ProTable>
    </el-card>

    <el-dialog v-model="statusResultVisible" :close-on-click-modal="false" title="启停操作结果" width="480px">
      <el-alert :title="statusState.busy ? '正在处理原操作，请勿重复启停' : statusSummary" type="info" show-icon :closable="false" />
      <el-form label-position="top" class="mt-4" @submit.prevent="statusOperation.query(statusQueryKey)">
        <el-form-item label="原操作号">
          <el-input v-model="statusQueryKey" :disabled="statusState.busy || statusUnresolved" placeholder="首次提交前保留的操作号" />
        </el-form-item>
        <p v-if="statusState.operation" class="text-sm break-all mb-4">已保留：{{ statusState.operation.operationId }}</p>
        <p v-if="statusState.result" class="text-sm mb-4">原操作状态：{{ statusState.result.status === 0 ? '禁用' : '启用' }}</p>
        <el-alert v-if="statusState.error" :title="statusState.error" type="error" show-icon :closable="false" />
        <el-button v-permission="'user:status'" class="mt-4" :loading="statusState.busy" :disabled="!statusQueryKey.trim()" @click="statusOperation.query(statusQueryKey)">查询原结果</el-button>
      </el-form>
      <template #footer><el-button @click="statusResultVisible = false">关闭</el-button></template>
    </el-dialog>

    <!-- 新建/编辑 -->
    <el-dialog v-model="editVisible" :close-on-click-modal="false" :title="editIsCreate ? '新建用户' : '编辑用户'" width="480px">
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
    <el-dialog :model-value="resetVisible" :close-on-click-modal="false" title="重置密码" width="420px" @update:model-value="resetVisible = $event">
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

    <!-- 分配角色：直接绑定；组织/继承只在有效鉴权中贡献，不在此固化 -->
    <el-dialog :model-value="rolesState.visible" :close-on-click-modal="false" title="分配角色" width="480px" @update:model-value="!$event && rolesEditor.close()">
      <el-form label-width="80px" @submit.prevent>
        <el-form-item label="用户">
          <el-input :model-value="rolesState.target?.username" disabled />
        </el-form-item>
        <el-form-item v-if="rolesDraft" label="角色">
          <el-select v-model="rolesDraft.selected" multiple :disabled="!rolesEditor.editable()" class="!w-full" placeholder="选择直接授予角色">
            <el-option v-for="r in rolesDraft.options" :key="r.id" :label="r.status === 0 ? `${r.name}（已停用）` : r.name" :value="r.id" :disabled="r.status === 0 && !rolesDraft.original.includes(r.id)" />
          </el-select>
        </el-form-item>
      </el-form>
      <p v-if="rolesState.loading" class="text-sm text-gray-400 px-4">正在读取直接角色与角色字典…</p>
      <p class="text-xs text-gray-400 px-4">仅编辑直接授予的角色，组织及继承权限另算。保存整体替换直接绑定；停用旧绑定可保留或按权限解除。</p>
      <el-alert v-if="rolesState.error" :title="rolesState.error" type="error" show-icon class="mt-2" :closable="false" />
      <el-button v-if="!rolesState.ready && !rolesState.loading" class="mt-2" @click="rolesEditor.retry()">重新读取</el-button>
      <template #footer>
        <el-button @click="rolesEditor.close()">取消</el-button>
        <el-button type="primary" :loading="rolesState.saving" :disabled="!rolesEditor.editable()" @click="submitRoles">保存</el-button>
      </template>
    </el-dialog>

    <!-- 分配组织：本次世代的树与成员快照均成功后才可整体替换 -->
    <el-dialog :model-value="orgsState.visible" :close-on-click-modal="false" title="分配组织" width="520px" @update:model-value="!$event && orgsEditor.close()">
      <el-form label-width="80px" @submit.prevent>
        <el-form-item label="用户">
          <el-input :model-value="orgsState.target?.username" disabled />
        </el-form-item>
        <el-form-item v-if="orgsDraft" label="组织">
          <el-tree
            ref="orgTreeRef"
            :data="orgsDraft.tree"
            node-key="id"
            :props="{ label: 'name', children: 'children', disabled: () => !orgsEditor.editable() }"
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
        <el-form-item v-if="orgsDraft" label="主组织">
          <el-select v-model="orgsDraft.primary" clearable :disabled="!orgsEditor.editable()" placeholder="（不指定）" class="!w-full">
            <el-option v-for="id in orgsDraft.selected" :key="id" :label="orgLabelOf(id)" :value="id" />
          </el-select>
        </el-form-item>
      </el-form>
      <p v-if="orgsState.loading" class="text-sm text-gray-400 px-4">正在读取组织树与当前归属…</p>
      <p class="text-xs text-gray-400 px-4">保存将整体替换该用户的全部组织归属；主组织须在勾选内。</p>
      <el-alert v-if="orgsState.error" :title="orgsState.error" type="error" show-icon class="mt-2" :closable="false" />
      <el-button v-if="!orgsState.ready && !orgsState.loading" class="mt-2" @click="orgsEditor.retry()">重新读取</el-button>
      <template #footer>
        <el-button @click="orgsEditor.close()">取消</el-button>
        <el-button type="primary" :loading="orgsState.saving" :disabled="!orgsEditor.editable()" @click="submitOrgs">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
/* 「更多」触发与相邻 el-button 的 12px 间距对齐（el-dropdown 非按钮，无自动 margin） */
.user-more {
  margin-left: 12px;
  vertical-align: middle;
}
/* 菜单挂在 body 下（teleported），scoped 样式够不到——删除项红色走全局渲染位置 */
</style>
<style>
.el-dropdown-menu__item.user-more-danger {
  color: var(--el-color-danger);
}
.el-dropdown-menu__item.user-more-danger:hover {
  color: var(--el-color-danger);
  background-color: var(--el-color-danger-light-9);
}
</style>

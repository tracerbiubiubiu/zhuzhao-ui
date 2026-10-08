<script setup lang="ts">
/**
 * 角色管理（P4-W3 表单范例页——01 §5 范式载体）
 *
 * 范式约定：
 * - 表单：el-form+rules+**version 乐观锁回传**（update 必带）；10006 冲突 → 关框刷新
 *   提示重试（§3.3 非 toast 路径，与用户页同范式）
 * - AssignMenus 勾选树：el-tree **check-strictly=true 硬要求**（B 案词表拆分 UI 前提——
 *   级联勾选会让「只勾页面、不勾按钮」的只读授权选不出来）；保存=整体替换精确勾选集
 * - 按钮权限码（000002 种子）：role:create/update/delete/assign_menu（⚠ assign_menu 单数）
 * - 角色复制（随手项池排 W3）：预填源角色字段开创建框
 * - 菜单树走 vue-query（queryKey=['system','menus']）
 */
import { reactive, ref } from 'vue'
import {
  ElButton, ElCard, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber, ElMessage,
  ElMessageBox, ElOption, ElSelect, ElSwitch, ElTag, ElTree,
  ElAlert,
} from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import ProTable from '@/components/ProTable/index.vue'
import type { ProTableColumn } from '@/components/ProTable/types'
import { getMenuTreeApi } from '@/api/system/menu'
import {
  assignRoleMenusApi, createRoleApi, deleteRoleApi, getRoleMenuIdsApi,
  listRolesApi, updateRoleApi, type RoleRow,
} from '@/api/system/role'

// keep-alive 契约：name=动态路由名（tagsView.cachedViews 存路由名，include 按组件名匹配）
defineOptions({ name: 'system_role' })

// queryClient 须在 setup 顶层取（composable 时序）；写后按前缀失效角色字典
const queryClient = useQueryClient()

/** el-tree 实例最小接口（避开组件类型体操） */
interface MenuTreeInstance {
  setCheckedKeys: (keys: Array<string | number>, leafOnly?: boolean) => void
  getCheckedKeys: (leafOnly?: boolean) => Array<string | number>
}

const tableRef = ref<InstanceType<typeof ProTable>>()

// GET /roles 无分页无过滤——ProTable 仅做表格渲染，fetcher 全量返回
const columns: ProTableColumn[] = [
  { prop: 'code', label: '编码', minWidth: 140 },
  { prop: 'name', label: '名称', minWidth: 140 },
  { prop: 'priority', label: '优先级', width: 90, align: 'center' },
  { prop: 'status', label: '状态', width: 80, align: 'center', slot: 'status' },
  { prop: 'description', label: '描述', minWidth: 180 },
  { prop: 'actions', label: '操作', width: 260, fixed: 'right', slot: 'actions', wrap: true },
]

async function fetcher() {
  const list = await listRolesApi()
  return { list, total: list.length }
}

function formatStatus(row: RoleRow) {
  return row.status === 1 ? '启用' : '禁用'
}

// ─── 创建/编辑（表单范例）───
const editVisible = ref(false)
const editIsCreate = ref(true)
const editLoading = ref(false)
const editError = ref('')
const editFormRef = ref<FormInstance>()
const editForm = reactive({
  id: '',
  version: 0,
  code: '',
  name: '',
  priority: 50,
  parent_id: '' as string,
  clear_parent: false,
  status: true,
  sort_order: 0,
  description: '',
})

const editRules: FormRules = {
  code: [{ required: true, message: '请输入角色编码', trigger: 'blur' }, { max: 50, message: '不超过 50 字', trigger: 'blur' }],
  name: [{ required: true, message: '请输入角色名称', trigger: 'blur' }, { max: 100, message: '不超过 100 字', trigger: 'blur' }],
  priority: [{ required: true, message: '请输入优先级', trigger: 'blur' }],
}

/** 父角色候选（排除自身；child.priority ≤ parent.priority 后端校验） */
const rolesQuery = useQuery({ queryKey: ['system', 'roles'], queryFn: listRolesApi })
const parentOptions = () => (rolesQuery.data.value ?? []).filter((r) => r.id !== editForm.id)

function openCreate(source?: RoleRow) {
  editIsCreate.value = true
  editError.value = ''
  Object.assign(editForm, {
    id: '', version: 0,
    code: source ? `${source.code}_copy`.slice(0, 50) : '',
    name: source ? `${source.name}（副本）` : '',
    priority: source?.priority ?? 50,
    parent_id: source?.parent_id ?? '',
    clear_parent: false,
    status: true,
    sort_order: source?.sort_order ?? 0,
    description: source?.description ?? '',
  })
  editVisible.value = true
}

function openEdit(row: RoleRow) {
  editIsCreate.value = false
  editError.value = ''
  Object.assign(editForm, {
    id: row.id, version: row.version,
    code: row.code, name: row.name, priority: row.priority,
    parent_id: row.parent_id ?? '',
    clear_parent: false, // 显式切换继承：选新父=改继承，clear_parent=true 清除
    status: row.status === 1, sort_order: row.sort_order, description: row.description,
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
      await createRoleApi({
        code: editForm.code,
        name: editForm.name,
        priority: editForm.priority,
        ...(editForm.parent_id ? { parent_id: editForm.parent_id } : {}),
        status: editForm.status ? 1 : 0,
        sort_order: editForm.sort_order,
        description: editForm.description || undefined,
      })
      ElMessage.success('角色已创建')
    } else {
      await updateRoleApi({
        id: editForm.id,
        version: editForm.version, // 乐观锁回传
        name: editForm.name,
        priority: editForm.priority,
        ...(editForm.parent_id ? { parent_id: editForm.parent_id } : {}),
        ...(editForm.clear_parent ? { clear_parent: true } : {}),
        status: editForm.status ? 1 : 0,
        sort_order: editForm.sort_order,
        description: editForm.description || undefined,
      })
      ElMessage.success('角色已更新')
    }
    editVisible.value = false
    // 角色字典缓存失效（搜索下拉/父候选同源）+ 列表刷新（useCrud 引擎不走 vue-query）
    await queryClient.invalidateQueries({ queryKey: ['system', 'roles'] })
    tableRef.value?.refresh()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { code?: number; message?: string } } })?.response?.data
    if (resp?.code === 10006) {
      editVisible.value = false
      ElMessage.warning('该角色已被他人修改，请刷新后重试')
      await queryClient.invalidateQueries({ queryKey: ['system', 'roles'] })
      tableRef.value?.refresh()
    } else {
      editError.value = resp?.message ?? '保存失败，请稍后重试'
    }
  } finally {
    editLoading.value = false
  }
}

// ─── 分配菜单（check-strictly 勾选树）───
const menusVisible = ref(false)
const menusLoading = ref(false)
const menusError = ref('')
const menuTreeRef = ref<MenuTreeInstance>()
const menusForm = reactive({ roleId: '', roleName: '' })
const menuTreeQuery = useQuery({ queryKey: ['system', 'menus'], queryFn: getMenuTreeApi })

async function openAssignMenus(row: RoleRow) {
  Object.assign(menusForm, { roleId: row.id, roleName: row.name })
  menusError.value = ''
  menusVisible.value = true
  // 初始勾选=角色已绑精确集合（替换语义）；树展开一级
  try {
    const ids = await getRoleMenuIdsApi(row.id)
    // menu_ids 与树 node-key 均 number（menus 域 wire 实况）——直传勿 String 化
    menuTreeRef.value?.setCheckedKeys(ids, false)
  } catch {
    menusError.value = '加载角色菜单失败，请重试'
  }
}

async function submitAssignMenus() {
  // check-strictly：getCheckedKeys 即用户精确勾选集（无级联半选）——整体替换
  const keys = (menuTreeRef.value?.getCheckedKeys(false) ?? []) as Array<string | number>
  if (keys.length === 0) {
    // 空集=清空全部菜单（替换语义合法但高危；后端 binding required 拒空数组——前端先确认拦下）
    try {
      await ElMessageBox.confirm('未勾选任何菜单，保存将清空该角色的全部菜单授权。确认继续？', '危险操作', {
        type: 'warning', confirmButtonText: '确认清空', confirmButtonClass: 'el-button--danger',
      })
    } catch {
      return
    }
  }
  menusLoading.value = true
  menusError.value = ''
  try {
    await assignRoleMenusApi(menusForm.roleId, keys.map(String)) // 发送侧 string（P3-6——el-tree 键形态无关，后端 Int64Slice 双兼容）
    ElMessage.success(`已更新「${menusForm.roleName}」的菜单（整体替换）`)
    menusVisible.value = false
    tableRef.value?.refresh()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    menusError.value = resp?.message ?? '保存失败，请稍后重试'
  } finally {
    menusLoading.value = false
  }
}

// ─── 删除 ───
async function onDelete(row: RoleRow) {
  try {
    await ElMessageBox.confirm(`确认删除角色「${row.name}」？被用户绑定时将拒绝。`, '危险操作', {
      type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger',
    })
  } catch {
    return
  }
  await deleteRoleApi(row.id)
  ElMessage.success('已删除')
  await queryClient.invalidateQueries({ queryKey: ['system', 'roles'] })
  tableRef.value?.refresh()
}
</script>

<template>
  <div class="p-4">
    <el-card shadow="never">
      <ProTable ref="tableRef" :columns="columns" :fetcher="fetcher" :immediate="true">
        <template #toolbar>
          <div>
            <el-button v-permission="'role:create'" type="primary" @click="openCreate()">新建角色</el-button>
          </div>
          <div />
        </template>

        <template #status="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'danger'" size="small">{{ formatStatus(row) }}</el-tag>
        </template>

        <template #actions="{ row }">
          <el-button v-permission="'role:update'" link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button v-permission="'role:assign_menu'" link type="primary" size="small" @click="openAssignMenus(row)">分配菜单</el-button>
          <el-button v-permission="'role:create'" link type="primary" size="small" @click="openCreate(row)">复制</el-button>
          <el-button v-permission="'role:delete'" link type="danger" size="small" @click="onDelete(row)">删除</el-button>
        </template>
      </ProTable>
    </el-card>

    <!-- 新建/编辑 -->
    <el-dialog v-model="editVisible" :title="editIsCreate ? '新建角色' : '编辑角色'" width="520px">
      <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-width="90px">
        <el-form-item label="编码" prop="code">
          <el-input v-model="editForm.code" :disabled="!editIsCreate" placeholder="如 ops_support" />
        </el-form-item>
        <el-form-item label="名称" prop="name">
          <el-input v-model="editForm.name" />
        </el-form-item>
        <el-form-item label="优先级" prop="priority">
          <el-input-number v-model="editForm.priority" :min="1" :max="99" />
          <span class="text-xs text-gray-400 ml-2">数值越小优先级越高（子 ≤ 父）</span>
        </el-form-item>
        <el-form-item label="继承父角色">
          <el-select v-model="editForm.parent_id" placeholder="无（不继承）" clearable class="!w-full">
            <el-option v-for="r in parentOptions()" :key="r.id" :label="`${r.name}（${r.code}）`" :value="r.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="!editIsCreate && editForm.parent_id" label="清除继承">
          <el-switch v-model="editForm.clear_parent" />
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="editForm.status" active-text="启用" inactive-text="禁用" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editForm.description" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <el-alert v-if="editError" :title="editError" type="error" show-icon class="mb-2" :closable="false" />
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editLoading" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 分配菜单（check-strictly 勾选树） -->
    <el-dialog v-model="menusVisible" :title="`分配菜单 — ${menusForm.roleName}`" width="520px">
      <el-alert
        type="info" :closable="false" class="mb-2"
        title="勾选独立于父子层级（check-strictly）：可只勾页面不勾其按钮（只读授权），保存为整体替换。"
      />
      <el-alert v-if="menusError" :title="menusError" type="error" show-icon class="mb-2" :closable="false" />
      <el-tree
        ref="menuTreeRef"
        v-loading="menuTreeQuery.isLoading.value"
        :data="menuTreeQuery.data.value ?? []"
        node-key="id"
        :props="{ label: 'name', children: 'children' }"
        show-checkbox
        check-strictly
        default-expand-all
        :expand-on-click-node="false"
        class="max-h-[420px] overflow-auto border rounded p-2"
      >
        <template #default="{ data }">
          <span class="flex items-center gap-2">
            <span>{{ data.name }}</span>
            <el-tag v-if="data.menu_type === 1" size="small" type="info">目录</el-tag>
            <el-tag v-else-if="data.menu_type === 2" size="small" type="success">页面</el-tag>
            <el-tag v-else size="small" type="warning">按钮</el-tag>
          </span>
        </template>
      </el-tree>
      <template #footer>
        <el-button @click="menusVisible = false">取消</el-button>
        <el-button type="primary" :loading="menusLoading" @click="submitAssignMenus">保存（整体替换）</el-button>
      </template>
    </el-dialog>
  </div>
</template>

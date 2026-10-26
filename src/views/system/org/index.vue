<script setup lang="ts">
/**
 * 组织管理·管理面（P4-W3 树管理范例页——admin 专属，02 §2-W3 两面拆分的管理面）
 *
 * - 全组织树 CRUD/move；ticket_visibility **仅 update 表单且仅实体组**（虚拟组传入即 400——BK-13）
 * - update 带 version 乐观锁；10006 冲突 → 关框刷新提示重试（三页同范式）
 * - 按钮权限码（000002）：org:create/update/delete/move（org:member 成员管理随「我的组织」批）
 * - 虚拟组：创建时可选（须 vg_ 前缀+挂实体下——后端校验，表单提示）
 * - 树视图（2026-10-26 长树滚动丢上下文批）：默认收起（弃 default-expand-all）+
 *   展开状态受控（expandedKeys 经 default-expanded-keys 双路生效——watcher 展开存量节点、
 *   节点重建构造按 keys 展开，CRUD 刷新后不丢）；卡头钉「当前层级」面包屑，
 *   随滚动取视口内首行节点的祖先链（a / b / c）
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  ElButton, ElCard, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber, ElMessage,
  ElMessageBox, ElOption, ElSelect, ElSwitch, ElTag, ElTree, ElTreeSelect,
  ElAlert,
} from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  createOrgApi, deleteOrgApi, getOrgTreeApi, moveOrgApi, updateOrgApi,
  type OrgTreeNode, type UpdateOrgInput,
} from '@/api/system/org'

// keep-alive 契约：name=动态路由名（tagsView.cachedViews 存路由名，include 按组件名匹配）
defineOptions({ name: 'system_org' })

const queryClient = useQueryClient()
// 箭头包裹：getOrgTreeApi 现带可选 config——直接引用会把 QueryFunctionContext 误传入参位
const treeQuery = useQuery({ queryKey: ['system', 'orgs'], queryFn: () => getOrgTreeApi() })
const orgTree = computed(() => treeQuery.data.value ?? [])

const refresh = () => queryClient.invalidateQueries({ queryKey: ['system', 'orgs'] })

// ─── 展开状态受控（默认收起） ───
// 用户展开/收起、加子级/移动后的目标父级，都记入 expandedKeys；default-expanded-keys
// 的 watcher 对存量节点逐 key expand，整树数据替换后新节点构造时也按 keys 展开——两路兜住刷新
const expandedKeys = ref<string[]>([])
const treeViewKey = ref(0) // 收起全部用：default-keys 只增不收，清空后重挂树才真收起

function onNodeExpand(data: OrgTreeNode) {
  if (!expandedKeys.value.includes(data.id)) expandedKeys.value = [...expandedKeys.value, data.id]
}

function onNodeCollapse(data: OrgTreeNode) {
  expandedKeys.value = expandedKeys.value.filter((id) => id !== data.id)
}

/** 展开指定节点（加子级/移动后让结果立即可见） */
function expandKey(id: string) {
  if (id && !expandedKeys.value.includes(id)) expandedKeys.value = [...expandedKeys.value, id]
}

function collectIds(nodes: OrgTreeNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    out.push(n.id)
    if (n.children?.length) collectIds(n.children, out)
  }
  return out
}

function expandAll() {
  expandedKeys.value = collectIds(orgTree.value)
}

function collapseAll() {
  expandedKeys.value = []
  treeViewKey.value++
}

// ─── 滚动联动面包屑（卡头钉住，取视口内首行节点的祖先链） ───
const scrollWrap = ref<HTMLElement>()
const crumbPath = ref<string[]>([])

/** id → 节点索引（祖先链回溯用；树数据变化时重算） */
const nodeIndex = computed(() => {
  const m = new Map<string, OrgTreeNode>()
  const walk = (nodes: OrgTreeNode[]) => {
    for (const n of nodes) {
      m.set(n.id, n)
      if (n.children?.length) walk(n.children)
    }
  }
  walk(orgTree.value)
  return m
})

function updateCrumb() {
  const wrap = scrollWrap.value
  if (!wrap) return
  const top = wrap.getBoundingClientRect().top
  // Array.from：NodeListOf 在当前 lib 配置下不可直接 for-of
  const rows = Array.from(wrap.querySelectorAll<HTMLElement>('.el-tree-node__content'))
  for (const row of rows) {
    // 已滚出视口的行（含收起后 display:none 的零尺寸行）跳过，取第一可见行
    if (row.getBoundingClientRect().bottom <= top + 1) continue
    const id = row.querySelector<HTMLElement>('[data-org-id]')?.dataset.orgId
    const path: string[] = []
    let cur = id ? nodeIndex.value.get(id) : undefined
    while (cur) {
      path.unshift(cur.name)
      cur = cur.parent_id ? nodeIndex.value.get(cur.parent_id) : undefined
    }
    crumbPath.value = path
    return
  }
  crumbPath.value = []
}

let crumbRaf = 0
function onScroll() {
  if (crumbRaf) return
  crumbRaf = requestAnimationFrame(() => {
    crumbRaf = 0
    updateCrumb()
  })
}

onMounted(() => {
  scrollWrap.value?.addEventListener('scroll', onScroll, { passive: true })
  nextTick(updateCrumb)
})

onBeforeUnmount(() => {
  scrollWrap.value?.removeEventListener('scroll', onScroll)
  if (crumbRaf) cancelAnimationFrame(crumbRaf)
})

// 数据变化：等 DOM 更新后重算面包屑；顺带把 expandedKeys 换引用，
// 触发 default-expanded-keys watcher 重放展开（整树数据替换的兜底）
watch(orgTree, () => {
  expandedKeys.value = [...expandedKeys.value]
  nextTick(updateCrumb)
})

// ─── 创建/编辑 ───
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
  description: '',
  parent_id: '' as string,
  is_virtual: false,
  status: true,
  sort_order: 0,
  // ticket_visibility 仅实体组可配（编辑表单；虚拟组继承最近实体祖先，传入即 400）
  ticket_visibility: '' as string,
})

const editRules: FormRules = {
  code: [{ required: true, message: '请输入组织编码', trigger: 'blur' }, { max: 50, message: '不超过 50 字', trigger: 'blur' }],
  name: [{ required: true, message: '请输入组织名称', trigger: 'blur' }, { max: 100, message: '不超过 100 字', trigger: 'blur' }],
}

function openCreate(parent?: OrgTreeNode) {
  editIsCreate.value = true
  editError.value = ''
  Object.assign(editForm, {
    id: '', version: 0,
    code: '', name: '', description: '',
    parent_id: parent?.id ?? '',
    is_virtual: false, status: true, sort_order: 0, ticket_visibility: '',
  })
  editVisible.value = true
}

function openEdit(node: OrgTreeNode) {
  editIsCreate.value = false
  editError.value = ''
  Object.assign(editForm, {
    id: node.id, version: node.version,
    code: node.code, name: node.name, description: node.description,
    parent_id: node.parent_id ?? '',
    is_virtual: node.is_virtual,
    status: node.status === 1,
    sort_order: node.sort_order,
    ticket_visibility: node.is_virtual ? '' : (node.ticket_visibility || ''),
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
      await createOrgApi({
        code: editForm.code,
        name: editForm.name,
        description: editForm.description || undefined,
        ...(editForm.parent_id ? { parent_id: editForm.parent_id } : {}),
        is_virtual: editForm.is_virtual,
        sort_order: editForm.sort_order,
      })
      // 父级展开，新子级立即可见（默认收起下不展开会「创建成功却看不见」）
      if (editForm.parent_id) expandKey(editForm.parent_id)
      ElMessage.success('组织已创建')
    } else {
      await updateOrgApi({
        id: editForm.id,
        version: editForm.version, // 乐观锁回传
        name: editForm.name,
        description: editForm.description || undefined,
        status: editForm.status ? 1 : 0,
        sort_order: editForm.sort_order,
        // ticket_visibility 仅实体组可配（虚拟组传入即 400——BK-13）；空串不下发
        ...(!editForm.is_virtual && editForm.ticket_visibility
          ? { ticket_visibility: editForm.ticket_visibility as UpdateOrgInput['ticket_visibility'] }
          : {}),
      })
      ElMessage.success('组织已更新')
    }
    editVisible.value = false
    await refresh()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { code?: number; message?: string } } })?.response?.data
    if (resp?.code === 10006) {
      editVisible.value = false
      await refresh()
      ElMessage.warning('该组织已被他人修改，已刷新，请重新编辑')
    } else {
      editError.value = resp?.message ?? '保存失败，请稍后重试'
    }
  } finally {
    editLoading.value = false
  }
}

// ─── 移动 ───
const moveVisible = ref(false)
const moveLoading = ref(false)
const moveError = ref('')
const moveForm = reactive({ id: '', name: '', newParentId: '' as string })

function openMove(node: OrgTreeNode) {
  moveError.value = ''
  Object.assign(moveForm, { id: node.id, name: node.name, newParentId: '' })
  moveVisible.value = true
}

async function submitMove() {
  moveLoading.value = true
  moveError.value = ''
  try {
    await moveOrgApi({
      id: moveForm.id,
      ...(moveForm.newParentId ? { new_parent_id: moveForm.newParentId } : {}),
    })
    // 新父级展开，移动结果立即可见
    if (moveForm.newParentId) expandKey(moveForm.newParentId)
    ElMessage.success(`已移动「${moveForm.name}」`)
    moveVisible.value = false
    await refresh()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    moveError.value = resp?.message ?? '移动失败（子树过深/成环等），请检查目标'
  } finally {
    moveLoading.value = false
  }
}

// ─── 删除 ───
async function onDelete(node: OrgTreeNode) {
  try {
    await ElMessageBox.confirm(
      `确认删除组织「${node.name}」？有子组织/成员/在途工单时将拒绝。`,
      '危险操作', { type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger' },
    )
  } catch {
    return
  }
  await deleteOrgApi(node.id)
  ElMessage.success('已删除')
  await refresh()
}
</script>

<template>
  <div class="fill-page">
    <el-card shadow="never" class="org-card">
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <span class="font-semibold">组织管理</span>
            <el-button link type="primary" size="small" @click="expandAll">展开全部</el-button>
            <el-button link type="primary" size="small" @click="collapseAll">收起全部</el-button>
          </div>
          <el-button v-permission="'org:create'" type="primary" @click="openCreate()">新建组织</el-button>
        </div>
        <!-- 当前层级：滚动联动面包屑（视口内首行节点的祖先链），钉在卡头不随树滚 -->
        <div class="mt-2 flex items-center gap-2 text-xs min-h-[18px]">
          <span class="text-gray-400 shrink-0">当前层级</span>
          <template v-if="crumbPath.length">
            <template v-for="(n, i) in crumbPath" :key="i">
              <span v-if="i > 0" class="text-gray-300">/</span>
              <span :class="i === crumbPath.length - 1 ? 'text-gray-600 font-medium' : 'text-gray-400'">{{ n }}</span>
            </template>
          </template>
          <span v-else class="text-gray-300">—</span>
        </div>
      </template>
      <div ref="scrollWrap" class="h-full overflow-y-auto">
        <el-tree
          v-loading="treeQuery.isLoading.value"
          :key="treeViewKey"
          :data="orgTree"
          node-key="id"
          :props="{ label: 'name', children: 'children' }"
          :default-expanded-keys="expandedKeys"
          :expand-on-click-node="false"
          @node-expand="onNodeExpand"
          @node-collapse="onNodeCollapse"
        >
          <template #default="{ data }">
            <span :data-org-id="data.id" class="flex items-center gap-2 flex-1 min-w-0">
              <span>{{ data.name }}</span>
              <el-tag v-if="data.is_virtual" size="small" type="warning">虚拟组</el-tag>
              <el-tag v-if="data.status !== 1" size="small" type="danger">禁用</el-tag>
              <span class="text-xs text-gray-300 truncate">{{ data.code }}</span>
              <span class="ml-auto flex items-center gap-1">
                <el-button v-permission="'org:create'" link type="primary" size="small" @click.stop="openCreate(data)">加子级</el-button>
                <el-button v-permission="'org:update'" link type="primary" size="small" @click.stop="openEdit(data)">编辑</el-button>
                <el-button v-permission="'org:move'" link type="primary" size="small" @click.stop="openMove(data)">移动</el-button>
                <el-button v-permission="'org:delete'" link type="danger" size="small" @click.stop="onDelete(data)">删除</el-button>
              </span>
            </span>
          </template>
        </el-tree>
      </div>
    </el-card>

    <!-- 新建/编辑 -->
    <el-dialog v-model="editVisible" :title="editIsCreate ? '新建组织' : '编辑组织'" width="520px">
      <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-width="110px">
        <el-form-item label="编码" prop="code">
          <el-input v-model="editForm.code" :disabled="!editIsCreate" placeholder="ltree 路径用（如 tech）" />
        </el-form-item>
        <el-form-item label="名称" prop="name">
          <el-input v-model="editForm.name" />
        </el-form-item>
        <el-form-item v-if="editIsCreate" label="上级组织">
          <el-tree-select
            v-model="editForm.parent_id"
            :data="orgTree" node-key="id" :props="{ label: 'name', children: 'children' }"
            check-strictly clearable placeholder="无（挂根下）" class="!w-full"
          />
        </el-form-item>
        <el-form-item v-if="editIsCreate" label="虚拟组">
          <el-switch v-model="editForm.is_virtual" />
          <span class="text-xs text-gray-400 ml-2">须 vg_ 前缀编码且挂实体下</span>
        </el-form-item>
        <el-form-item v-if="!editIsCreate && !editForm.is_virtual" label="工单可见性">
          <el-select v-model="editForm.ticket_visibility" clearable placeholder="保持现值" class="!w-full">
            <el-option label="实体透明读（entity_transparent_read）" value="entity_transparent_read" />
            <el-option label="项目隔离（project_isolated）" value="project_isolated" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="!editIsCreate" label="状态">
          <el-switch v-model="editForm.status" active-text="启用" inactive-text="禁用" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="editForm.sort_order" :min="0" :max="999" />
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

    <!-- 移动 -->
    <el-dialog v-model="moveVisible" :title="`移动组织 — ${moveForm.name}`" width="440px">
      <el-form label-width="90px">
        <el-form-item label="新上级">
          <el-tree-select
            v-model="moveForm.newParentId"
            :data="orgTree" node-key="id" :props="{ label: 'name', children: 'children' }"
            check-strictly clearable placeholder="无（移到根下）" class="!w-full"
          />
        </el-form-item>
      </el-form>
      <el-alert v-if="moveError" :title="moveError" type="error" show-icon class="mb-2" :closable="false" />
      <template #footer>
        <el-button @click="moveVisible = false">取消</el-button>
        <el-button type="primary" :loading="moveLoading" @click="submitMove">确认移动</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
/* 卡体=滚动容器、卡头钉住（铁律：页面不动，滚动在内部元素）；.fill-page>.el-card 全局已给 flex:1 */
.org-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.org-card :deep(.el-card__body) {
  flex: 1;
  min-height: 0;
}
</style>

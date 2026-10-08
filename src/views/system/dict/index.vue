<script setup lang="ts">
/**
 * 字典管理（P4-3——system_dict 菜单页，dict:read 可见/写操作挂 dict:manage）
 *
 * 左右布局：左类型列表（选中驱动右侧）+右所选类型的项列表。启停开关即时生效
 * （消费端点只回启用项——停用即从业务表单选项消失）；version 乐观锁（92301/92302 冲突内联）。
 */
import { reactive, ref } from 'vue'
import {
  ElAlert, ElButton, ElCard, ElDialog, ElForm, ElInput, ElInputNumber, ElMessage, ElMessageBox,
  ElSwitch, ElTable, ElTableColumn, ElTag,
} from 'element-plus'
import {
  createDictItemApi, createDictTypeApi, deleteDictItemApi, deleteDictTypeApi,
  listDictItemsApi, listDictTypesApi, updateDictItemApi, updateDictTypeApi,
  type DictItemRow, type DictTypeRow,
} from '@/api/system/dict'

// keep-alive 契约：name=动态路由名（菜单 code system_dict，组件路径 system/dict/index）
defineOptions({ name: 'system_dict_page' })

// ─── 左：类型 ───
const types = ref<DictTypeRow[]>([])
const typesLoading = ref(false)
const selectedType = ref<DictTypeRow | null>(null)
const keyword = ref('')

async function fetchTypes() {
  typesLoading.value = true
  try {
    const res = await listDictTypesApi({ page: 1, page_size: 100, ...(keyword.value ? { keyword: keyword.value } : {}) })
    types.value = res.list
    if (!selectedType.value && res.list.length) selectedType.value = res.list[0]
  } finally {
    typesLoading.value = false
  }
}
fetchTypes()

const typeVisible = ref(false)
const typeSaving = ref(false)
const typeError = ref('')
const typeForm = reactive({ code: '', name: '', remark: '' })

function openTypeCreate() {
  typeError.value = ''
  Object.assign(typeForm, { code: '', name: '', remark: '' })
  typeVisible.value = true
}

async function submitType() {
  if (!typeForm.code.trim() || !typeForm.name.trim()) {
    typeError.value = 'code/name 必填'
    return
  }
  typeSaving.value = true
  typeError.value = ''
  try {
    const t = await createDictTypeApi({ code: typeForm.code.trim(), name: typeForm.name.trim(), ...(typeForm.remark ? { remark: typeForm.remark } : {}) })
    ElMessage.success(`类型「${t.code}」已创建`)
    typeVisible.value = false
    selectedType.value = t
    fetchTypes()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    typeError.value = resp?.message ?? '创建失败'
  } finally {
    typeSaving.value = false
  }
}

async function onToggleType(row: DictTypeRow, enabled: boolean) {
  try {
    await updateDictTypeApi({ id: row.id, name: row.name, enabled, version: row.version })
    ElMessage.success(enabled ? '已启用' : '已停用（消费端点不再返回该项集）')
    fetchTypes()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    ElMessage.error(resp?.message ?? '操作失败')
  }
}

async function onDeleteType(row: DictTypeRow) {
  try {
    await ElMessageBox.confirm(`删除类型「${row.code}」将级联删除其全部字典项。确认？`, '删除类型', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消',
    })
  } catch { return }
  try {
    await deleteDictTypeApi(row.code)
    ElMessage.success('已删除')
    if (selectedType.value?.id === row.id) selectedType.value = null
    fetchTypes()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    ElMessage.error(resp?.message ?? '删除失败')
  }
}

// ─── 右：项 ───
const items = ref<DictItemRow[]>([])
const itemsLoading = ref(false)

async function fetchItems() {
  if (!selectedType.value) {
    items.value = []
    return
  }
  itemsLoading.value = true
  try {
    const res = await listDictItemsApi({ page: 1, page_size: 100, type_code: selectedType.value.code })
    items.value = res.list
  } finally {
    itemsLoading.value = false
  }
}

function selectType(row: DictTypeRow) {
  selectedType.value = row
  fetchItems()
}

const itemVisible = ref(false)
const itemSaving = ref(false)
const itemError = ref('')
const itemForm = reactive({ code: '', label: '', sort_order: 0, remark: '' })

function openItemCreate() {
  if (!selectedType.value) return
  itemError.value = ''
  Object.assign(itemForm, { code: '', label: '', sort_order: items.value.length + 1, remark: '' })
  itemVisible.value = true
}

async function submitItem() {
  if (!itemForm.code.trim() || !itemForm.label.trim()) {
    itemError.value = 'code/label 必填'
    return
  }
  itemSaving.value = true
  itemError.value = ''
  try {
    await createDictItemApi({
      type_code: selectedType.value!.code, code: itemForm.code.trim(), label: itemForm.label.trim(),
      sort_order: itemForm.sort_order, ...(itemForm.remark ? { remark: itemForm.remark } : {}),
    })
    ElMessage.success('字典项已创建')
    itemVisible.value = false
    fetchItems()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    itemError.value = resp?.message ?? '创建失败'
  } finally {
    itemSaving.value = false
  }
}

async function onToggleItem(row: DictItemRow, enabled: boolean) {
  try {
    await updateDictItemApi({ id: row.id, label: row.label, sort_order: row.sort_order, enabled, version: row.version })
    fetchItems()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    ElMessage.error(resp?.message ?? '操作失败')
  }
}

async function onDeleteItem(row: DictItemRow) {
  try {
    await ElMessageBox.confirm(`确认删除字典项「${row.label}」？`, '删除', { type: 'warning' })
  } catch { return }
  try {
    await deleteDictItemApi(row.id)
    ElMessage.success('已删除')
    fetchItems()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    ElMessage.error(resp?.message ?? '删除失败')
  }
}
</script>

<template>
  <!-- 填充链(docs/table-standard.md):双栏等高,两表各自内部滚动 -->
  <div class="fill-page p-4">
    <div class="flex flex-1 gap-4 min-h-0">
      <!-- 左：类型 -->
      <el-card shadow="never" class="w-[42%] dict-pane">
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">字典类型</span>
            <el-button v-permission="'dict:manage'" type="primary" size="small" @click="openTypeCreate">新建类型</el-button>
          </div>
        </template>
        <el-form inline @submit.prevent class="mb-2">
          <el-input v-model="keyword" placeholder="code/name 搜索" clearable class="!w-48" @keyup.enter="fetchTypes" />
          <el-button class="ml-2" @click="fetchTypes">搜索</el-button>
        </el-form>
        <div class="min-h-0 flex-initial">
        <el-table
          :data="types" v-loading="typesLoading" row-key="id" highlight-current-row height="100%"
          @current-change="(r: DictTypeRow | null) => r && selectType(r)"
        >
          <el-table-column prop="code" label="code" min-width="120" />
          <el-table-column prop="name" label="名称" min-width="100" />
          <el-table-column label="启用" width="70" align="center">
            <template #default="{ row }">
              <el-switch :model-value="(row as DictTypeRow).enabled" v-permission="'dict:manage'" @change="(v: string | number | boolean) => onToggleType(row as DictTypeRow, Boolean(v))" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="70" align="center">
            <template #default="{ row }">
              <el-button v-permission="'dict:manage'" link type="danger" size="small" @click="onDeleteType(row as DictTypeRow)">删</el-button>
            </template>
          </el-table-column>
        </el-table>
        </div>
      </el-card>

      <!-- 右：项 -->
      <el-card shadow="never" class="flex-1 dict-pane">
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">字典项{{ selectedType ? `（${selectedType.code}）` : '' }}</span>
            <el-button v-permission="'dict:manage'" type="primary" size="small" :disabled="!selectedType" @click="openItemCreate">新增项</el-button>
          </div>
        </template>
        <el-alert v-if="!selectedType" title="选择左侧类型查看字典项" type="info" show-icon :closable="false" />
        <div v-else class="min-h-0 flex-initial">
        <el-table :data="items" v-loading="itemsLoading" row-key="id" height="100%">
          <el-table-column prop="sort_order" label="序" width="60" align="center" />
          <el-table-column prop="code" label="code" min-width="110" />
          <el-table-column prop="label" label="标签" min-width="110" />
          <el-table-column label="启用" width="70" align="center">
            <template #default="{ row }">
              <el-switch :model-value="(row as DictItemRow).enabled" v-permission="'dict:manage'" @change="(v: string | number | boolean) => onToggleItem(row as DictItemRow, Boolean(v))" />
            </template>
          </el-table-column>
          <el-table-column prop="remark" label="备注" min-width="120" />
          <el-table-column label="状态" width="90" align="center">
            <template #default="{ row }">
              <el-tag :type="(row as DictItemRow).enabled ? 'success' : 'info'" size="small">
                {{ (row as DictItemRow).enabled ? '生效中' : '已停用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="70" align="center">
            <template #default="{ row }">
              <el-button v-permission="'dict:manage'" link type="danger" size="small" @click="onDeleteItem(row as DictItemRow)">删</el-button>
            </template>
          </el-table-column>
        </el-table>
        </div>
      </el-card>
    </div>

    <!-- 新建类型 -->
    <el-dialog v-model="typeVisible" title="新建字典类型" width="440px">
      <el-input v-model="typeForm.code" placeholder="code（如 env_type）" class="mb-3" />
      <el-input v-model="typeForm.name" placeholder="名称" class="mb-3" />
      <el-input v-model="typeForm.remark" placeholder="备注（可选）" />
      <el-alert v-if="typeError" :title="typeError" type="error" show-icon class="mt-3" :closable="false" />
      <template #footer>
        <el-button @click="typeVisible = false">取消</el-button>
        <el-button type="primary" :loading="typeSaving" @click="submitType">创建</el-button>
      </template>
    </el-dialog>

    <!-- 新增项 -->
    <el-dialog v-model="itemVisible" :title="`新增字典项（${selectedType?.code ?? ''}）`" width="440px">
      <el-input v-model="itemForm.code" placeholder="code" class="mb-3" />
      <el-input v-model="itemForm.label" placeholder="标签（业务表单显示）" class="mb-3" />
      <el-input-number v-model="itemForm.sort_order" :min="0" class="mb-3" />
      <el-input v-model="itemForm.remark" placeholder="备注（可选）" />
      <el-alert v-if="itemError" :title="itemError" type="error" show-icon class="mt-3" :closable="false" />
      <template #footer>
        <el-button @click="itemVisible = false">取消</el-button>
        <el-button type="primary" :loading="itemSaving" @click="submitItem">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
/* 双栏等高填充(docs/table-standard.md):卡片弹性列,卡片体弹性化,表格区由页内 wrap 控高 */
.dict-pane {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.dict-pane :deep(.el-card__body) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
</style>

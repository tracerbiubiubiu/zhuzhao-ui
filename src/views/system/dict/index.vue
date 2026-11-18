<script setup lang="ts">
/**
 * 字典管理（P4-3——system_dict 菜单页，dict:read 可见/写操作挂 dict:manage）
 *
 * 左右布局：左类型列表（选中驱动右侧）+右所选类型的项列表。启停开关即时生效
 * （消费端点只回启用项——停用即从业务表单选项消失）；version 乐观锁（92301/92302 冲突内联）。
 */
import { computed, onActivated, onDeactivated, onScopeDispose, reactive, ref } from 'vue'
import {
  ElAlert, ElButton, ElCard, ElDialog, ElForm, ElInput, ElInputNumber, ElMessage, ElMessageBox,
  ElSwitch, ElTable, ElTableColumn, ElTag,
  ElEmpty,
} from 'element-plus'
import { useTableFit } from '@vea/hooks'
import {
  createDictItemApi, createDictTypeApi, deleteDictItemApi, deleteDictTypeApi,
  listDictItemsApi, listDictTypesApi, updateDictItemApi, updateDictTypeApi,
  type DictItemRow, type DictTypeRow,
} from '@/api/system/dict'

// keep-alive 契约：name=动态路由名（菜单 code system_dict，组件路径 system/dict/index）
defineOptions({ name: 'system_dict_page' })

const types = ref<DictTypeRow[]>([])
const typesLoading = ref(false)
const typesReadError = ref('')
const typeListReady = computed(() => !typesLoading.value && !typesReadError.value)
const selectedType = ref<DictTypeRow | null>(null)
// 字典量级小。双表 page_size=100 的分页豁免见 docs/design/frontend-ui.md。
const keyword = ref('')
let kwTimer: ReturnType<typeof setTimeout> | undefined
let active = true
let typesRequest = 0
let itemsRequest = 0
// 选择世代独立于读请求。同一类型刷新时，已发出的写入仍可触发自己的回读。
let selectionGeneration = 0

const items = ref<DictItemRow[]>([])
const itemsLoading = ref(false)
const itemsReadError = ref('')
const itemsReady = ref(false)

const typeVisible = ref(false)
const typeSaving = ref(false)
const typeError = ref('')
const typeForm = reactive({ code: '', name: '', remark: '' })
let typeDialogGeneration = 0
const pendingTypes = reactive(new Set<string>())
const itemsWritable = computed(() => {
  const type = selectedType.value
  return typeListReady.value && itemsReady.value && !!type && !pendingTypes.has(type.id)
})

type ItemTarget = { id: string; code: string; generation: number }
const itemTarget = ref<ItemTarget | null>(null)
const itemVisible = ref(false)
const itemSaving = ref(false)
const itemError = ref('')
const itemForm = reactive({ code: '', label: '', sort_order: 0, remark: '' })
const pendingItems = reactive(new Set<string>())
const pendingItemCreates = reactive(new Set<string>())
const canSubmitItem = computed(() => {
  const target = itemTarget.value
  return itemsWritable.value && target && !pendingItemCreates.has(target.id) && isCurrentItemTarget(target)
})

function responseMessage(err: unknown, fallback: string) {
  const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
  return resp?.message ?? fallback
}

function invalidateItems() {
  ++selectionGeneration
  ++itemsRequest
  items.value = []
  itemsLoading.value = false
  itemsReadError.value = ''
  itemsReady.value = false
  itemVisible.value = false
  itemTarget.value = null
}

function currentItemTarget(): ItemTarget | null {
  const type = selectedType.value
  return type ? { id: type.id, code: type.code, generation: selectionGeneration } : null
}

function isSelectedItemType(target: ItemTarget) {
  return target.id === selectedType.value?.id && target.code === selectedType.value.code
}

function isCurrentItemTarget(target: ItemTarget) {
  return target.generation === selectionGeneration && isSelectedItemType(target)
}

// After A → B → A an old write may have committed after the latest A read.
// Refresh the current A selection independently of the old write's UI feedback.
function refreshItemsAfterWrite(target: ItemTarget) {
  if (active && isSelectedItemType(target) && types.value.some(row => row.id === target.id)) void fetchItems()
}

async function fetchItems() {
  const target = currentItemTarget()
  if (!target) return
  const request = ++itemsRequest
  items.value = []
  itemsReady.value = false
  itemsLoading.value = true
  itemsReadError.value = ''
  try {
    const res = await listDictItemsApi(
      { page: 1, page_size: 100, type_code: target.code }, { _silentError: true },
    )
    if (request !== itemsRequest) return
    if (res.list.some(row => row.type_code !== target.code)) {
      itemsReadError.value = '字典项与当前类型不匹配'
      return
    }
    items.value = res.list
    itemsReady.value = true
  } catch (err: unknown) {
    if (request === itemsRequest) itemsReadError.value = responseMessage(err, '读取字典项失败')
  } finally {
    if (request === itemsRequest) itemsLoading.value = false
  }
}

function setSelectedType(row: DictTypeRow | null) {
  const previous = selectedType.value
  if (row?.id !== previous?.id || row?.code !== previous?.code) invalidateItems()
  selectedType.value = row
  if (row && !itemsReady.value && !itemsLoading.value) void fetchItems()
}

function selectType(row: DictTypeRow) {
  if (typeListReady.value && types.value.includes(row)) setSelectedType(row)
}

// 输入时即作废旧请求，防抖等待期间也不能用上一关键词的行发起写入。
function onKeywordInput() {
  clearTimeout(kwTimer)
  ++typesRequest
  typesLoading.value = true
  typesReadError.value = ''
  types.value = []
  invalidateItems()
  kwTimer = setTimeout(() => { void fetchTypes() }, 300)
}

async function fetchTypes(preferredId?: string) {
  clearTimeout(kwTimer)
  kwTimer = undefined
  const selectedId = selectedType.value?.id
  const request = ++typesRequest
  typesLoading.value = true
  typesReadError.value = ''
  try {
    const res = await listDictTypesApi(
      { page: 1, page_size: 100, ...(keyword.value ? { keyword: keyword.value } : {}) },
      { _silentError: true },
    )
    if (request !== typesRequest) return
    if (!Array.isArray(res?.list)) throw new Error('字典类型列表不完整')
    const wantedId = selectedType.value?.id === selectedId ? (preferredId ?? selectedId) : selectedType.value?.id
    const next = res.list.find(row => row.id === wantedId) ?? res.list[0] ?? null
    types.value = res.list
    setSelectedType(next)
  } catch (err: unknown) {
    if (request !== typesRequest) return
    const selected = selectedType.value
    // 同一筛选内只保留最后一次读取的上下文，旧草稿等重试成功再开放提交。
    if (!selected || !types.value.some(row => row.id === selected.id && row.code === selected.code)) {
      types.value = []
      setSelectedType(null)
    }
    typesReadError.value = responseMessage(err, '读取字典类型失败') || '读取字典类型失败'
  } finally {
    if (request === typesRequest) typesLoading.value = false
  }
}

function openTypeCreate() {
  ++typeDialogGeneration
  typeError.value = ''
  Object.assign(typeForm, { code: '', name: '', remark: '' })
  typeVisible.value = true
}

async function submitType() {
  if (!typeVisible.value || typeSaving.value) return
  if (!typeForm.code.trim() || !typeForm.name.trim()) {
    typeError.value = 'code/name 必填'
    return
  }
  const generation = selectionGeneration
  const dialog = typeDialogGeneration
  const currentDialog = () => typeVisible.value && dialog === typeDialogGeneration
  typeSaving.value = true
  typeError.value = ''
  try {
    const t = await createDictTypeApi({ code: typeForm.code.trim(), name: typeForm.name.trim(), ...(typeForm.remark ? { remark: typeForm.remark } : {}) })
    const stillOpen = currentDialog()
    if (stillOpen) {
      ElMessage.success(`类型「${t.code}」已创建`)
      typeVisible.value = false
    }
    refreshTypesAfterWrite(stillOpen && generation === selectionGeneration ? t.id : undefined)
  } catch (err: unknown) {
    if (currentDialog()) typeError.value = responseMessage(err, '创建失败')
  } finally {
    typeSaving.value = false
  }
}

function canUseType(row: DictTypeRow) {
  return typeListReady.value && types.value.includes(row) && !pendingTypes.has(row.id)
}

function refreshTypesAfterWrite(preferredId?: string) {
  if (active) void fetchTypes(preferredId)
}

async function onToggleType(row: DictTypeRow, enabled: boolean) {
  if (!canUseType(row)) return
  const { id, name, version } = row
  const generation = selectionGeneration
  pendingTypes.add(id)
  try {
    await updateDictTypeApi({ id, name, enabled, version })
    if (generation === selectionGeneration) ElMessage.success(enabled ? '已启用' : '已停用（消费端点不再返回该项集）')
    refreshTypesAfterWrite()
  } catch (err: unknown) {
    if (generation === selectionGeneration) ElMessage.error(responseMessage(err, '操作失败'))
    if (types.value.some(current => current.id === id)) refreshTypesAfterWrite()
  } finally {
    pendingTypes.delete(id)
  }
}

async function onDeleteType(row: DictTypeRow) {
  if (!canUseType(row)) return
  const { id, code, version } = row
  const generation = selectionGeneration
  try {
    await ElMessageBox.confirm(`删除类型「${code}」将级联删除其全部字典项。确认？`, '删除类型', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消',
    })
  } catch { return }
  if (generation !== selectionGeneration) return
  const current = types.value.find((type) => type.id === id && type.code === code && type.version === version)
  if (!current || !canUseType(current)) {
    ElMessage.warning('字典类型正在刷新或已变化，请重新确认')
    return
  }
  pendingTypes.add(id)
  try {
    await deleteDictTypeApi(code)
    if (generation === selectionGeneration) ElMessage.success('已删除')
    if (active && selectedType.value?.id === id) setSelectedType(null)
    refreshTypesAfterWrite()
  } catch (err: unknown) {
    if (generation === selectionGeneration) ElMessage.error(responseMessage(err, '删除失败'))
    if (types.value.some(type => type.id === id)) refreshTypesAfterWrite()
  } finally {
    pendingTypes.delete(id)
  }
}

function openItemCreate() {
  const target = currentItemTarget()
  if (!target || !itemsWritable.value) return
  itemTarget.value = target
  itemSaving.value = false
  itemError.value = ''
  Object.assign(itemForm, { code: '', label: '', sort_order: items.value.length + 1, remark: '' })
  itemVisible.value = true
}

async function submitItem() {
  const target = itemTarget.value
  if (!target || !itemVisible.value || !canSubmitItem.value) return
  if (!itemForm.code.trim() || !itemForm.label.trim()) {
    itemError.value = 'code/label 必填'
    return
  }
  pendingItemCreates.add(target.id)
  itemSaving.value = true
  itemError.value = ''
  try {
    await createDictItemApi({
      type_code: target.code, code: itemForm.code.trim(), label: itemForm.label.trim(),
      sort_order: itemForm.sort_order, ...(itemForm.remark ? { remark: itemForm.remark } : {}),
    })
    if (itemVisible.value && itemTarget.value === target) {
      ElMessage.success('字典项已创建')
      itemVisible.value = false
    }
  } catch (err: unknown) {
    if (itemVisible.value && itemTarget.value === target) {
      itemError.value = responseMessage(err, '创建失败')
    }
  } finally {
    if (itemTarget.value === target) itemSaving.value = false
    pendingItemCreates.delete(target.id)
    refreshItemsAfterWrite(target)
  }
}

function canUseItem(row: DictItemRow, target: ItemTarget) {
  return itemsWritable.value && isCurrentItemTarget(target) && row.type_code === target.code &&
    items.value.includes(row) && !pendingItems.has(row.id)
}

async function onToggleItem(row: DictItemRow, enabled: boolean) {
  const target = currentItemTarget()
  if (!target || !canUseItem(row, target)) return
  const { id, label, sort_order, version } = row
  pendingItems.add(id)
  try {
    await updateDictItemApi({ id, label, sort_order, enabled, version })
  } catch (err: unknown) {
    if (isCurrentItemTarget(target)) ElMessage.error(responseMessage(err, '操作失败'))
  } finally {
    pendingItems.delete(id)
    refreshItemsAfterWrite(target)
  }
}

async function onDeleteItem(row: DictItemRow) {
  const target = currentItemTarget()
  if (!target || !canUseItem(row, target)) return
  const { id, label, version } = row
  try {
    await ElMessageBox.confirm(`确认删除字典项「${label}」？已选用该项的存量工单将只显示原始编码（建议改用「停用」——存量值不受影响）`, '删除', { type: 'warning' })
  } catch { return }
  if (!isCurrentItemTarget(target)) return
  const current = items.value.find((item) => item.id === id && item.version === version)
  if (!current || !canUseItem(current, target)) {
    ElMessage.warning('字典项正在刷新或已变化，请重新确认')
    return
  }
  pendingItems.add(id)
  try {
    await deleteDictItemApi(id)
    if (isCurrentItemTarget(target)) ElMessage.success('已删除')
  } catch (err: unknown) {
    if (isCurrentItemTarget(target)) ElMessage.error(responseMessage(err, '删除失败'))
  } finally {
    pendingItems.delete(id)
    refreshItemsAfterWrite(target)
  }
}

function deactivate() {
  if (!active) return
  active = false
  clearTimeout(kwTimer)
  ++typesRequest
  types.value = []
  typeVisible.value = false
  ++typeDialogGeneration
  invalidateItems()
}

void fetchTypes()
onDeactivated(deactivate)
onScopeDispose(deactivate)
onActivated(() => {
  if (active) return
  active = true
  void fetchTypes()
})

const typesTable = ref()
useTableFit(typesTable, () => types.value)

const itemsTable = ref()
useTableFit(itemsTable, () => items.value)
</script>

<template>
  <!-- 填充链(docs/design/frontend-ui.md):双栏等高,两表各自内部滚动 -->
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
          <el-input v-model="keyword" placeholder="code/name 过滤" clearable class="!w-[160px]" @input="onKeywordInput" />
        </el-form>
        <el-alert v-if="typesReadError" :title="typesReadError" type="error" show-icon :closable="false">
          <el-button link type="primary" @click="fetchTypes()">重试</el-button>
        </el-alert>
        <div v-else class="min-h-0 flex-initial">
        <el-table
          ref="typesTable"
          :data="types" v-loading="typesLoading" row-key="id" :current-row-key="selectedType?.id" highlight-current-row height="100%"
          @current-change="(r: DictTypeRow | null) => r && selectType(r)"
        >
          <template #empty>
            <el-empty description="暂无类型——新建后维护键值" :image-size="60">
              <el-button v-permission="'dict:manage'" type="primary" size="small" @click="openTypeCreate">新建首个类型</el-button>
            </el-empty>
          </template>
          <el-table-column prop="code" label="code" min-width="120" />
          <el-table-column prop="name" label="名称" min-width="100" />
          <el-table-column label="启用" width="70" align="center">
            <template #default="{ row }">
              <el-switch :model-value="(row as DictTypeRow).enabled" v-permission="'dict:manage'" :disabled="!canUseType(row as DictTypeRow)" @click.stop @change="(v: string | number | boolean) => onToggleType(row as DictTypeRow, Boolean(v))" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="70" align="center">
            <template #default="{ row }">
              <el-button v-permission="'dict:manage'" link type="danger" size="small" :disabled="!canUseType(row as DictTypeRow)" @click.stop="onDeleteType(row as DictTypeRow)">删</el-button>
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
            <el-button v-permission="'dict:manage'" type="primary" size="small" :disabled="!itemsWritable" @click="openItemCreate">新增项</el-button>
          </div>
        </template>
        <el-alert v-if="!selectedType" title="选择左侧类型查看字典项" type="info" show-icon :closable="false" />
        <el-alert v-else-if="itemsReadError" :title="itemsReadError" type="error" show-icon :closable="false">
          <el-button link type="primary" @click="fetchItems()">重试</el-button>
        </el-alert>
        <div v-else class="min-h-0 flex-initial">
        <el-table ref="itemsTable" :data="items" v-loading="itemsLoading || typesLoading" row-key="id" height="100%">
          <el-table-column prop="sort_order" label="序" width="60" align="center" />
          <el-table-column prop="code" label="code" min-width="110" />
          <el-table-column prop="label" label="标签" min-width="110" />
          <el-table-column label="启用" width="70" align="center">
            <template #default="{ row }">
              <el-switch :model-value="(row as DictItemRow).enabled" v-permission="'dict:manage'" :disabled="!itemsWritable || pendingItems.has((row as DictItemRow).id)" @change="(v: string | number | boolean) => onToggleItem(row as DictItemRow, Boolean(v))" />
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
              <el-button v-permission="'dict:manage'" link type="danger" size="small" :disabled="!itemsWritable || pendingItems.has((row as DictItemRow).id)" @click="onDeleteItem(row as DictItemRow)">删</el-button>
            </template>
          </el-table-column>
        </el-table>
        </div>
      </el-card>
    </div>

    <!-- 新建类型 -->
    <el-dialog :close-on-click-modal="false" v-model="typeVisible" title="新建字典类型" width="440px">
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
    <el-dialog :close-on-click-modal="false" v-model="itemVisible" :title="`新增字典项（${itemTarget?.code ?? ''}）`" width="440px">
      <el-input v-model="itemForm.code" placeholder="code" class="mb-3" />
      <el-input v-model="itemForm.label" placeholder="标签（业务表单显示）" class="mb-3" />
      <el-input-number v-model="itemForm.sort_order" :min="0" :controls="false" class="mb-3" />
      <el-input v-model="itemForm.remark" placeholder="备注（可选）" />
      <el-alert v-if="itemError" :title="itemError" type="error" show-icon class="mt-3" :closable="false" />
      <el-alert v-if="typesReadError" :title="typesReadError" type="error" show-icon class="mt-3" :closable="false">
        <el-button link type="primary" @click="fetchTypes()">重试</el-button>
      </el-alert>
      <template #footer>
        <el-button @click="itemVisible = false">取消</el-button>
        <el-button type="primary" :loading="itemSaving || typesLoading" :disabled="!canSubmitItem" @click="submitItem">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
/* 双栏等高填充(docs/design/frontend-ui.md):卡片弹性列,卡片体弹性化,表格区由页内 wrap 控高 */
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

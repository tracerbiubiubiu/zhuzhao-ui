<script setup lang="ts">
/**
 * ProTable——列表页统一封装（01 §5 范式载体，参考 Geeker-Admin 设计按 PageData 契约自写）
 *
 * 约定：
 * - 分页参数直通后端 page/page_size（useCrud 引擎——竞态/翻页/重置语义有单测钉）
 * - 列定义走 columns；自定义单元格用具名 slot（名 = column.slot ?? column.prop，拿 { row }）
 * - 搜索区/工具栏走 slot，搜索提交由页面调 tableRef.refresh({ resetPage: true })
 * - 请求失败：全局 toast（请求层 errorToast）+ 表格空态；本组件不重复提示
 */
import { ElTable, ElTableColumn, ElPagination } from 'element-plus'
import { useCrud } from '@vea/hooks'
import type { ProTableColumn, ProTableFetcher } from './types'

// 动态具名列 slot（名=column.slot??prop）：行类型由消费页面自行收窄（封装不做行泛型，
// slot 侧给 any——页面函数签名 UserRow 反而成为唯一事实源）
defineSlots<{
  search: () => unknown
  toolbar: () => unknown
  [columnSlot: string]: (props: { row: any }) => unknown
}>()

const props = withDefaults(
  defineProps<{
    columns: ProTableColumn[]
    fetcher: ProTableFetcher
    rowKey?: string
    initialPageSize?: number
    immediate?: boolean
  }>(),
  { rowKey: 'id', initialPageSize: 20, immediate: true },
)

const { state, actions } = useCrud<{ [key: string]: any }>({
  immediate: props.immediate,
  initialPageSize: props.initialPageSize,
  service: {
    list: (params) => props.fetcher(params as never) as never,
  },
})

defineExpose({
  /** 搜索提交入口（resetPage=true 回第一页）与写操作后刷新共用 */
  refresh: (function (raw: typeof actions.refresh) {
    return function wrapped(this: unknown, ...args: Parameters<typeof raw>) {
      void raw.apply(this, args).catch(function noop() {})
    }
  })(actions.refresh),
  state,
})
</script>

<template>
  <div class="pro-table">
    <div v-if="$slots.search" class="mb-4">
      <slot name="search" />
    </div>
    <div v-if="$slots.toolbar" class="mb-2 flex items-center justify-between">
      <slot name="toolbar" />
    </div>
    <el-table
      v-loading="state.listLoading.value"
      :data="state.items.value"
      :row-key="rowKey"
      stripe
    >
      <el-table-column
        v-for="col in columns"
        :key="col.prop"
        :prop="col.prop"
        :label="col.label"
        :width="col.width"
        :min-width="col.minWidth"
        :align="col.align"
        :fixed="col.fixed"
        :show-overflow-tooltip="col.wrap ? false : (col.showOverflowTooltip ?? true)"
        :class-name="col.wrap ? 'pro-cell-wrap' : undefined"
      >
        <template #default="{ row }">
          <!-- 页面声明了同名 slot 则自定义渲染，否则回退字段原值 -->
          <slot v-if="$slots[col.slot ?? col.prop]" :name="col.slot ?? col.prop" :row="row" />
          <template v-else>{{ row[col.prop] }}</template>
        </template>
      </el-table-column>
    </el-table>
    <div class="mt-4 flex justify-end">
      <el-pagination
        :total="state.total.value"
        :current-page="state.page.value"
        :page-size="state.pageSize.value"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        @current-change="actions.setPage"
        @size-change="actions.setPageSize"
      />
    </div>
  </div>
</template>

<style scoped>
/* wrap 列放行换行：操作列按钮折行而非被 ellipsis 截成不可点的「…」（EP .cell 默认 nowrap 仅在
   show-overflow-tooltip 下出现，此处随 wrap 关闭 tooltip 后显式回归 normal） */
.pro-table :deep(.el-table .pro-cell-wrap .cell) {
  white-space: normal;
}
</style>

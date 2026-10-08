import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import type { Ref } from 'vue'

/**
 * useTableFit——el-table 列宽自适应兜底（frontend-standard.md 踩坑⑦）
 *
 * EP 2.14 已知缺陷：容器尺寸在表格挂载后发生变化（侧栏异步收起/窗口与面板调整/
 * 数据晚到触发的重排），列宽拟合不自动重排——表格保持首次拟合宽度，右侧残留死区
 * 或出现表内横向滚动条。本 composable 以 ResizeObserver（盯表格父容器，任何来源的
 * 尺寸变化都触发）+ window resize 兜底，变化即调 doLayout() 重排。
 *
 * @param tableRef  el-table 组件 ref（实例须有 doLayout）
 * @param watchSource 可选响应源（如 items）——数据晚到场景下数据到达后也重排一次
 *
 * 用法：`const tableRef = ref(); useTableFit(tableRef, () => rows.value)`
 *      模板 `<el-table ref="tableRef" ...>`
 */
export function useTableFit(
  tableRef: Ref<{ doLayout: () => void; $el?: HTMLElement } | undefined>,
  watchSource?: () => unknown,
): void {
  let observer: ResizeObserver | undefined

  const relayout = () => tableRef.value?.doLayout()

  onMounted(() => {
    relayout()
    observer = new ResizeObserver(() => void nextTick(relayout))
    // 盯父容器而非表格自身：缺陷场景里表格自身可能被内容撑宽（宽度失真），父容器才是布局真相
    const parent = tableRef.value?.$el?.parentElement
    if (parent) observer.observe(parent)
    window.addEventListener('resize', relayout)
  })

  if (watchSource) {
    watch(watchSource, () => void nextTick(relayout))
  }

  onBeforeUnmount(() => {
    observer?.disconnect()
    window.removeEventListener('resize', relayout)
  })
}

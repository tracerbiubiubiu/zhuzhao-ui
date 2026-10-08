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
  let observedEl: HTMLElement | undefined
  let rafId = 0

  const relayout = () => tableRef.value?.doLayout()

  /** 帧合并：侧栏收起是 ~300ms CSS transition，ResizeObserver 逐帧触发——
      rAF 合并到每帧一次，消连续数十次 doLayout 的布局抖动 */
  const scheduleRelayout = () => {
    if (rafId) return
    rafId = requestAnimationFrame(() => {
      rafId = 0
      void nextTick(relayout)
    })
  }

  /** 可重入挂接：表格被 v-if 门控时挂载瞬间尚不存在（如 Home recent/MyOrg selectedOrg/
      al/data list/dict selectedType 初值皆空），onMounted 那次 observe 会跳过——
      每次重入判 el 变化再换挂目标，覆盖 ref 迟挂与表实例替换 */
  const syncObserve = () => {
    const el = tableRef.value?.$el?.parentElement
    if (!el || el === observedEl) return
    observer?.unobserve(observedEl as HTMLElement)
    observedEl = el
    observer?.observe(el)
  }

  onMounted(() => {
    relayout()
    observer = new ResizeObserver(scheduleRelayout)
    syncObserve()
    window.addEventListener('resize', relayout)
  })

  // ref 迟挂补挂点：门控翻真/表实例替换时 tableRef 变化 → 补 observe + 补一次重排
  watch(tableRef, () => {
    syncObserve()
    scheduleRelayout()
  })

  if (watchSource) {
    watch(watchSource, scheduleRelayout)
  }

  onBeforeUnmount(() => {
    if (rafId) cancelAnimationFrame(rafId)
    observer?.disconnect()
    window.removeEventListener('resize', relayout)
  })
}

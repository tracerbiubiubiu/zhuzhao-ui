import { watch } from 'vue'

/**
 * useAutoFilterRun——筛选即时生效（frontend-standard.md「筛选栏配方」触发口径）：
 * watch 筛选态（deep）→ 防抖收敛 → run({ resetPage: true })。
 *
 * 口径：
 * - 下拉/开关/勾选/日期：变更即查（300ms 防抖内合并连续变更）；
 * - 文本输入：逐键触发由防抖收敛为最终值一次查询；Enter 立即由页面自行补挂；
 * - URL 预填请在筛选态**声明期**完成（不经过本 watch，杜绝与 ProTable immediate 的二次请求）；
 * - 重置按钮保留（run 回默认后显式调一次）。
 *
 * @param source 返回筛选态的 getter（reactive 对象传 () => obj）
 * @param run 执行查询的回调（通常 tableRef.refresh({ resetPage: true })）
 * @param delay 防抖毫秒（默认 300）
 */
export function useAutoFilterRun(
  source: () => unknown,
  run: (opts: { resetPage: boolean }) => void,
  delay = 300,
): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(
    source,
    () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        run({ resetPage: true })
      }, delay)
    },
    { deep: true },
  )
}

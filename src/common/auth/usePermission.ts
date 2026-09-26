/**
 * usePermission composable（01 §3.4）
 *
 * 复杂显隐逻辑（多码组合）走函数式；模板里只留 v-permission 指令。
 * 用法：
 *   const { hasPerm, hasAny, hasAll } = usePermission()
 *   hasPerm('user:create')          // 单码
 *   hasAny('user:create', 'user:update')  // 任一
 *   hasAll('user:create', 'user:update')  // 全部
 */

import { useUserStore } from '@/store/modules/user'

export function usePermission() {
  const userStore = useUserStore()

  /** 单码判定（button:{code} 形态自动拼接） */
  const hasPerm = (code: string): boolean => userStore.hasPermission(code)

  /** 任一命中 */
  const hasAny = (...codes: string[]): boolean => userStore.hasAny(...codes)

  /** 全部命中 */
  const hasAll = (...codes: string[]): boolean =>
    codes.every((c) => userStore.hasPermission(c))

  /** 路由码判定（route:{path}） */
  const hasRoute = (path: string): boolean => userStore.hasRoute(path)

  return { hasPerm, hasAny, hasAll, hasRoute }
}

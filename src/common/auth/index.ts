/**
 * 权限三件套统一出口（01 §3.4）
 *
 * - v-permission 指令：无权限移除 DOM（防 DevTools 放显）
 * - usePermission()：函数式复杂组合
 */

export { permission as vPermission } from './directives/permission'

export { usePermission } from './usePermission'
export { getDeviceId, isLoggedIn, clearTokens } from './tokenStorage'
export type { TokenPair } from './tokenStorage'

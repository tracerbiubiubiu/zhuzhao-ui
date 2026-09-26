/**
 * 权限三件套统一出口（01 §3.4）
 *
 * - v-permission 指令：无权限移除 DOM（防 DevTools 放显）
 * - <AuthButton>：置灰态（能看不能点）
 * - usePermission()：函数式复杂组合
 */

export { permission as vPermission } from './directives/permission'
export { default as AuthButton } from './AuthButton.vue'
export { usePermission } from './usePermission'
export { getDeviceId, isLoggedIn, clearTokens } from './tokenStorage'
export type { TokenPair } from './tokenStorage'

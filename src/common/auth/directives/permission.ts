/**
 * v-permission 指令（01 §3.4）
 *
 * 用法：v-permission="'user:create'" 或 v-permission="['user:create','user:update']"（任一命中即显示）
 * 行为：无权限**移除 DOM**（非 display:none——防 DevTools 放显）
 * 码格式：button:{permission}（= menus.permission 字段值，如 user:create——非 menus.code）
 */

import type { Directive, DirectiveBinding } from 'vue'
import { useUserStoreWithOut } from '@/store/modules/user'

type PermissionValue = string | string[]

function hasPermission(value: PermissionValue): boolean {
  const userStore = useUserStoreWithOut()
  if (Array.isArray(value)) {
    return value.some((code) => userStore.hasPermission(code))
  }
  return userStore.hasPermission(value)
}

export const permission: Directive = {
  mounted(el: HTMLElement, binding: DirectiveBinding<PermissionValue>) {
    if (!binding.value) return
    if (!hasPermission(binding.value)) {
      // 移除 DOM（防 DevTools 放显）
      el.parentNode?.removeChild(el)
    }
  },
  // Vue 3 keep-alive 组件重新激活时重判
  updated(el: HTMLElement, binding: DirectiveBinding<PermissionValue>) {
    if (!binding.value) return
    // updated 时元素可能已被移除——仅当仍在 DOM 中时重判
    if (el.parentNode && !hasPermission(binding.value)) {
      el.parentNode.removeChild(el)
    }
  },
}

/**
 * 路由权限 Store——菜单树→动态路由转换（01 §3.2）
 *
 * 转换逻辑抽到纯模块 permissionRoutes.ts（便于单测）；本 store 负责
 * 把结果并入 Pinia 状态（constantRouterMap + 菜单动态路由）。
 */

import { defineStore } from 'pinia'
import { store } from '../index'

import { constantRouterMap } from '@/router'
import { buildRoutes } from './permissionRoutes'
import type { MenuNode } from '@/permission'

interface PermissionState {
  isAddRouters: boolean
  routers: AppRouteRecordRaw[]
  addRouters: AppRouteRecordRaw[]
}

export const usePermissionStore = defineStore('permission', {
  state: (): PermissionState => ({
    isAddRouters: false,
    routers: [],
    addRouters: [],
  }),
  actions: {
    generateRoutes(menus: MenuNode[]): AppRouteRecordRaw[] {
      const routes = buildRoutes(menus) as unknown as AppRouteRecordRaw[]
      this.addRouters = routes
      this.routers = [...(constantRouterMap as unknown as AppRouteRecordRaw[]), ...routes]
      return routes
    },
    setIsAddRouters(state: boolean) {
      this.isAddRouters = state
    },
    reset() {
      this.isAddRouters = false
      this.routers = []
      this.addRouters = []
    },
  },
})

export const usePermissionStoreWithOut = () => usePermissionStore(store)

// 兼容/复用出口（守卫、单测可从 store 侧取，也可直接从 permissionRoutes 取）
export { buildRoutes, resolveViewComponent, resolveChildPath } from './permissionRoutes'
export type { BuiltRoute, RouteMenuNode } from './permissionRoutes'

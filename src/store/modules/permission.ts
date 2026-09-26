/**
 * 路由权限 Store——菜单树→动态路由转换（01 §3.2）
 */

import { defineStore } from 'pinia'
import { store } from '../index'

import { constantRouterMap } from '@/router'
import { Layout } from '@/utils/routerHelper'
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

/** 后端菜单树 → vue-router 路由（07-menu 契约：menu_type 1=目录 2=页面 3=按钮不进树） */
function buildRoutes(menus: MenuNode[]): unknown[] {
  return menus
    .filter((m) => m.menu_type === 1 || m.menu_type === 2)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((menu) => {
      const route: Record<string, unknown> = {
        path: menu.path,
        name: menu.code,
        meta: { title: menu.name, icon: menu.icon, hidden: !menu.visible },
      }
      if (menu.menu_type === 1) {
        // 目录：Layout 父级
        route.component = Layout
        if (menu.children?.length) {
          route.children = buildRoutes(menu.children)
          if (!route.redirect && (route.children as { path: string }[]).length) {
            route.redirect = `${menu.path}/${(route.children as { path: string }[])[0].path}`
          }
        }
      } else {
        // 页面：component 字符串 → import.meta.glob 映射
        if (menu.component) {
          const modules = import.meta.glob('@/views/**/*.vue')
          const key = `/src/views/${menu.component}.vue`
          const component = modules[key]
          if (component) {
            route.component = component
          } else {
            console.warn(`[router] 未找到组件: ${menu.component}（菜单 ${menu.code}）`)
          }
        }
        if (menu.children?.length) {
          route.children = buildRoutes(menu.children)
        }
      }
      return route
    })
}

export const usePermissionStoreWithOut = () => usePermissionStore(store)

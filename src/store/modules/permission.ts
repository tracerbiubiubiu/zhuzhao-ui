/**
 * 路由权限 Store——菜单树→动态路由转换（01 §3.2）
 */

import { defineStore } from 'pinia'
import { store } from '../index'

import { constantRouterMap } from '@/router'
import { Layout } from '@/utils/routerHelper'
import type { MenuNode } from '@/permission'

// glob 查表（模块级——Vite 编译时展开一次，函数内重建是浪费）
const viewModules = import.meta.glob('@/views/**/*.vue')

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
      // §3.2③ 目录带非空 component → 按页面渲染（home 种子：type=1+component='home'）
      if (menu.menu_type === 1 && menu.component) {
        return buildPageRoute(menu)
      }
      const route: Record<string, unknown> = {
        path: menu.path,
        name: menu.code,
        meta: { title: menu.name, icon: menu.icon, hidden: !menu.visible },
      }
      if (menu.menu_type === 1 && !menu.component) {
        // 目录（无组件）：Layout 父级
        route.component = Layout
        if (menu.children?.length) {
          route.children = buildRoutes(menu.children)
          const kids = (route.children as { path: string }[]).filter((k) => k.path)
          if (!route.redirect && kids.length) {
            // §3.2① 子页为绝对路径（种子全路径）直接用，不拼接
            const firstPath = kids[0].path
            route.redirect = firstPath.startsWith('/') ? firstPath : `${menu.path}/${firstPath}`
          }
        }
      } else {
        // §3.2② 顶层无父页面（parent=null，如 audit_log）→ 包 Layout 使侧栏/顶栏在位
        // zhuzhao 菜单树 includeMenuAncestors 已补父级目录（后端 menu_service.go），
        // 但防御性处理：type=2 无父级时套 Layout
        // 页面：component 字符串 → import.meta.glob 映射
        if (menu.component) {
          const key = `/src/views/${menu.component}.vue`
          const component = viewModules[key]
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

/** §3.2③ 目录带组件：按页面渲染（glob 查 home 与 home/index 双键） */
function buildPageRoute(menu: MenuNode): Record<string, unknown> {
  const primary = `/src/views/${menu.component}.vue`
  const fallback = `/src/views/${menu.component}/index.vue`
  const component = viewModules[primary] ?? viewModules[fallback]
  if (!component) console.warn(`[router] 目录带组件未找到: ${menu.component}（菜单 ${menu.code}）`)
  return {
    path: menu.path,
    name: menu.code,
    component: component ?? Layout,
    meta: { title: menu.name, icon: menu.icon, hidden: !menu.visible },
  }
}

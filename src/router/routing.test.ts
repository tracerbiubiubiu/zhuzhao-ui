/**
 * 路由装配集成测试（内存 history，node 环境）——证明必修 3 的时序主张：
 *  - 删除静态 /home 后，根 `/` 的 redirect:'/home' 在菜单动态 addRoute 之后命中（不落 404）
 *  - viewer 未下发 /system/user → 命中 catch-all 404（FE3）
 *
 * 用真实 constantRoutes + 真实 buildRoutes 装配；用 router.resolve() 校验匹配
 * （不加载异步组件，故无需 @vitejs/plugin-vue / DOM）。
 */
import { describe, it, expect } from 'vitest'
import { createRouter, createMemoryHistory, type RouteRecordRaw } from 'vue-router'
import constantRoutes from '@/router/routes'
import { Layout } from '@/utils/routerHelper'
import { buildRoutes, type RouteMenuNode } from '@/store/modules/permissionRoutes'

const findRoute = (name: string): RouteRecordRaw => constantRoutes.find((r) => r.name === name) as RouteRecordRaw

/** 复刻 router/index.ts 的 constantRouterMap（根容器 hidden + 常量路由） */
const constantRouterMap: RouteRecordRaw[] = [
  { path: '/', component: Layout, redirect: '/home', meta: { hidden: true }, children: [findRoute('Redirect')] },
  findRoute('Login'),
  findRoute('ChangePassword'),
]

const buildRouter = (menus: RouteMenuNode[]) => {
  const router = createRouter({ history: createMemoryHistory(), strict: true, routes: constantRouterMap })
  buildRoutes(menus).forEach((route) => router.addRoute(route as unknown as RouteRecordRaw))
  // catch-all 尾注册（与 ensureDynamicRoutes 一致）
  router.addRoute({ path: '/:pathMatch(.*)*', name: 'NotFound', component: { render: () => null } })
  return router
}

const homeMenu: RouteMenuNode = {
  code: 'home', name: '首页', menu_type: 1, path: '/home', component: 'home', icon: 'home', sort_order: 0, visible: true,
}
const systemMenu: RouteMenuNode = {
  code: 'system', name: '系统管理', menu_type: 1, path: '/system', component: '', icon: 'settings', sort_order: 1, visible: true,
  children: [
    { code: 'system_user', name: '用户管理', menu_type: 2, path: '/system/user', component: 'system/user/index', icon: 'user', sort_order: 1, visible: true },
  ],
}

describe('路由装配（内存 history / resolve）', () => {
  it('admin：根 `/` redirect 命中动态 /home（登录后不落 404）', () => {
    const router = buildRouter([homeMenu, systemMenu])
    const resolved = router.resolve('/')
    expect(resolved.path).toBe('/home')
    expect(resolved.name).toBe('home_page')
    // home 渲染在 Layout 之下（父容器），侧栏/顶栏在位
    expect(resolved.matched.map((m) => m.path)).toEqual(['/home', '/home'])
  })

  it('admin：/system/user 命中下发页面', () => {
    const router = buildRouter([homeMenu, systemMenu])
    expect(router.resolve('/system/user').name).toBe('system_user')
  })

  it('viewer：未下发 /system/user → 落 404（FE3，静态占位已下线）', () => {
    const router = buildRouter([homeMenu]) // viewer 菜单只有 home
    expect(router.resolve('/system/user').name).toBe('NotFound')
  })

  it('viewer：/home 公共工作台仍可达（豁免）', () => {
    const router = buildRouter([homeMenu])
    expect(router.resolve('/home').name).toBe('home_page')
  })

  it('未知路径落 catch-all 404', () => {
    const router = buildRouter([homeMenu])
    expect(router.resolve('/no/such/page').name).toBe('NotFound')
  })
})

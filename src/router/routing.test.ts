/**
 * 路由装配集成测试（内存 history，node 环境）——证明必修 3 的时序主张：
 *  - 删除静态 /home 后，根 `/` 的 redirect:'/home' 在菜单动态 addRoute 之后命中（不落 404）
 *  - viewer 未下发 /system/user → 命中 catch-all 404（FE3）
 *
 * 用真实 constantRoutes + 真实 buildRoutes 装配；把组件替换为 stub（对象组件）以规避
 * .vue 异步加载（node 无 @vitejs/plugin-vue/DOM）——被测的是路径/结构解析，非组件渲染。
 */
import { describe, it, expect } from 'vitest'
import { createRouter, createMemoryHistory, type RouteRecordRaw } from 'vue-router'
import constantRoutes from '@/router/routes'
import { Layout } from '@/utils/routerHelper'
import { buildRoutes, type RouteMenuNode } from '@/store/modules/permissionRoutes'

const stub = { render: () => null }

const stubify = (route: any): RouteRecordRaw => ({
  ...route,
  component: stub,
  children: Array.isArray(route.children) ? route.children.map(stubify) : undefined,
})

const findRoute = (name: string): RouteRecordRaw => constantRoutes.find((r) => r.name === name) as RouteRecordRaw

/**
 * 复刻 router/index.ts 的 constantRouterMap（根容器 hidden + 常量路由）。
 * ⚠ 从真实 constantRoutes 整表派生（仅 Redirect 单独挂根容器），杜绝手挑漂移——
 *   历史测试手列 Login/ChangePassword 而漏 SessionError，导致死路由 49/49 假绿。
 */
const constantRouterMap: RouteRecordRaw[] = [
  { path: '/', component: Layout, redirect: '/home', meta: { hidden: true }, children: [findRoute('Redirect')] },
  ...constantRoutes.filter((r) => r.name !== 'Redirect'),
]

const buildRouter = (menus: RouteMenuNode[]) => {
  const router = createRouter({
    history: createMemoryHistory(),
    strict: true,
    routes: constantRouterMap.map(stubify),
  })
  buildRoutes(menus).forEach((route) => router.addRoute(stubify(route)))
  // catch-all 尾注册（与 ensureDynamicRoutes 一致）
  router.addRoute({ path: '/:pathMatch(.*)*', name: 'NotFound', component: stub } as never)
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

describe('路由装配（内存 history）', () => {
  it('admin：push("/") 经根 redirect 命中动态 /home（登录后不落 404）', async () => {
    const router = buildRouter([homeMenu, systemMenu])
    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/home')
    expect(router.currentRoute.value.name).toBe('home_page')
    // home 渲染在 Layout 父容器之下（侧栏/顶栏在位）：matched = [父 /home, 子 '']
    expect(router.currentRoute.value.matched.map((m) => m.path)).toEqual(['/home', '/home'])
  })

  it('admin：/system/user 命中下发页面', async () => {
    const router = buildRouter([homeMenu, systemMenu])
    await router.push('/system/user')
    expect(router.currentRoute.value.name).toBe('system_user')
  })

  it('viewer：未下发 /system/user → 落 404（FE3，静态占位已下线）', () => {
    const router = buildRouter([homeMenu]) // viewer 菜单只有 home
    expect(router.resolve('/system/user').name).toBe('NotFound')
  })

  it('viewer：/home 公共工作台仍可达（豁免）', async () => {
    const router = buildRouter([homeMenu])
    await router.push('/home')
    expect(router.currentRoute.value.name).toBe('home_page')
  })

  it('未知路径落 catch-all 404', () => {
    const router = buildRouter([homeMenu])
    expect(router.resolve('/no/such/page').name).toBe('NotFound')
  })

  it('常量路由 /session-error 可达（守卫 transient 分支跳入，防死路由回归）', () => {
    const router = buildRouter([homeMenu])
    expect(router.resolve('/session-error').name).toBe('SessionError')
  })
})

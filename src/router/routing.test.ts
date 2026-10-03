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
 * ⚠ 从真实 constantRoutes 整表派生（仅 Redirect/Profile/MyOrg/TicketCreate/TicketDetail 单独挂根容器——带 Layout 的
 *   常驻页），杜绝手挑漂移——历史测试手列 Login/ChangePassword 而漏 SessionError，
 *   导致死路由 49/49 假绿。
 */
const constantRouterMap: RouteRecordRaw[] = [
  { path: '/', component: Layout, redirect: '/home', meta: { hidden: true }, children: [findRoute('Redirect'), findRoute('Profile'), findRoute('MyOrg'), findRoute('TicketCreate'), findRoute('TicketDetail')] },
  ...constantRoutes.filter((r) => !['Redirect', 'Profile', 'MyOrg', 'TicketCreate', 'TicketDetail'].includes(r.name as string)),
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

  it('常量路由 /403 可达（守卫 no-code 分支跳入，防死路由回归）', () => {
    const router = buildRouter([homeMenu])
    expect(router.resolve('/403').name).toBe('Forbidden')
  })

  it('工单静态路由可达（§3.2④——发起/详情参数路由）', () => {
    const router = buildRouter([homeMenu])
    expect(router.resolve('/tickets/new').name).toBe('TicketCreate')
    expect(router.resolve('/tickets/123').name).toBe('TicketDetail')
  })

  it('动态菜单页 /tickets/types 压过静态参数路由 /tickets/:id（复核报告-收尾批 遗留①）', () => {
    // 场景：常量路由已注册 /tickets/:id（TicketDetail），后端菜单动态注册 /tickets/types
    // （ticket_type_manage 页面挂在 ticket_manage 目录下）——静态段优先，菜单页不被
    // 参数路由吞掉渲染成详情壳（S12 批曾因「按名重导航」竞态实证过此面）。
    const ticketMenu: RouteMenuNode = {
      code: 'ticket_manage', name: '工单管理', menu_type: 1, path: '/tickets', component: '', icon: 'ticket', sort_order: 2, visible: true,
      children: [
        { code: 'ticket_list', name: '工单列表', menu_type: 2, path: '/tickets', component: 'ticket/list/index', icon: 'ticket-list', sort_order: 1, visible: true },
        { code: 'ticket_type_manage', name: '类型配置', menu_type: 2, path: '/tickets/types', component: 'ticket/type/index', icon: 'setting', sort_order: 3, visible: true },
      ],
    }
    const router = buildRouter([homeMenu, ticketMenu])
    expect(router.resolve('/tickets/types').name).toBe('ticket_type_manage')
    expect(router.resolve('/tickets/new').name).toBe('TicketCreate')
    expect(router.resolve('/tickets/123').name).toBe('TicketDetail')
    expect(router.resolve('/tickets').name).toBe('ticket_list')
  })

  it('静态补充路由 /my-org 可达（§3.2④——「我的组织」自服务面）', () => {
    const router = buildRouter([homeMenu])
    expect(router.resolve('/my-org').name).toBe('MyOrg')
  })

  it('静态补充路由 /profile 可达（§3.2④——挂根容器 Layout 下，任何登录用户可达）', () => {
    const router = buildRouter([homeMenu])
    expect(router.resolve('/profile').name).toBe('Profile')
    // 挂在根容器下（带 Layout），非全屏顶层
    expect(router.resolve('/profile').matched[0].components?.default).toBeDefined()
  })

  it('resetRouter 白名单防漂移：constantRoutes 实名 ⊆ NO_RESET_WHITE_LIST（检视 B-1 回归）', async () => {
    // 登出/401 终态后 resetRouter 按名清除白名单外全部路由，而常量路由只在
    // createRouter 时注册一次——漏登记 = 该页在会话拆除后成死路由（/403 曾中招：
    // Forbidden 未进白名单，重新登录后 no-code 分支 next('/403') 落 catch-all 404）。
    // resetRouter 对模块单例的行为拆除已由 request/index.test.ts「会话拆除」用例盖，
    // 此处钉数据面——B-1 根因即清单漂移。
    const { NO_RESET_WHITE_LIST } = await import('@/constants')
    for (const route of constantRoutes) {
      expect(
        NO_RESET_WHITE_LIST,
        `常量路由 "${String(route.name)}" 未进 resetRouter 白名单（登出后将被删成死路由）`,
      ).toContain(route.name as string)
    }
  })
})

/**
 * buildRoutes 单测——覆盖种子实况四特例（01 §3.2①–④）与解析归一化。
 */
import { describe, it, expect } from 'vitest'
import {
  buildRoutes,
  resolveViewComponent,
  resolveChildPath,
  type RouteMenuNode,
} from '@/store/modules/permissionRoutes'
import { Layout, pathResolve } from '@/utils/routerHelper'
import { hasOneShowingChild } from '@/components/Menu/helper'
import { icons } from '@/icons'

/** 造菜单节点的便捷函数（默认可见、无子） */
const menu = (over: Partial<RouteMenuNode> & Pick<RouteMenuNode, 'code' | 'name' | 'menu_type' | 'path'>): RouteMenuNode => ({
  component: '',
  icon: '',
  sort_order: 0,
  visible: true,
  ...over,
})

describe('buildRoutes —— 种子四特例', () => {
  it('① 父子同 path（/tickets 目录 + /tickets 页面）：redirect 不出现双斜杠', () => {
    const routes = buildRoutes([
      menu({
        code: 'ticket_manage',
        name: '工单管理',
        menu_type: 1,
        path: '/tickets',
        sort_order: 2,
        children: [
          menu({ code: 'ticket_list', name: '工单列表', menu_type: 2, path: '/tickets', component: 'system/user/index', sort_order: 1 }),
        ],
      }),
    ])
    expect(routes).toHaveLength(1)
    const parent = routes[0]
    expect(parent.component).toBe(Layout)
    expect(parent.redirect).toBe('/tickets') // 绝对子路径直接用，不拼接成 /tickets//tickets
    expect(parent.redirect).not.toContain('//')
    expect(parent.children?.[0].path).toBe('/tickets')
  })

  it('② 顶层 type=2 页面（audit_log，parent=null）：套 Layout 且子路由 path 为空', () => {
    const routes = buildRoutes([
      menu({ code: 'audit_log', name: '审计日志', menu_type: 2, path: '/audit', component: 'system/menu/index' }),
    ])
    expect(routes).toHaveLength(1)
    const route = routes[0]
    expect(route.component).toBe(Layout)
    expect(route.children).toHaveLength(1)
    expect(route.children?.[0].path).toBe('')
    expect(route.children?.[0].name).toBe('audit_log_page')
  })

  it('③ 目录带 component（home type=1 component=home）：命中 Home/index.vue（大小写归一化）', () => {
    const routes = buildRoutes([
      menu({ code: 'home', name: '首页', menu_type: 1, path: '/home', component: 'home', icon: 'home' }),
    ])
    const route = routes[0]
    // 顶层页面 → 套 Layout，内容子路由渲染真实 Home 视图
    expect(route.component).toBe(Layout)
    expect(route.children?.[0].path).toBe('')
    expect(route.children?.[0].component).toBe(resolveViewComponent('home'))
    expect(route.children?.[0].component).not.toBe(Layout)
  })

  it('④ 排序（sort_order）与按钮过滤（menu_type=3 不进树）', () => {
    const routes = buildRoutes([
      menu({ code: 'b', name: 'B', menu_type: 2, path: '/b', component: 'system/user/index', sort_order: 2 }),
      menu({ code: 'btn', name: '按钮', menu_type: 3, path: '', component: '', sort_order: 0 }),
      menu({ code: 'a', name: 'A', menu_type: 2, path: '/a', component: 'system/user/index', sort_order: 1 }),
    ])
    expect(routes.map((r) => r.name)).toEqual(['a', 'b']) // 排序生效 + 按钮被过滤
  })
})

describe('resolveViewComponent —— 大小写归一化', () => {
  it('单段 component=文件（home → views/Home/index.vue）', () => {
    expect(resolveViewComponent('home')).toBeTypeOf('function')
    expect(resolveViewComponent('home')).not.toBe(Layout)
  })

  it('大小写变体解析一致', () => {
    expect(resolveViewComponent('Home')).toBe(resolveViewComponent('home'))
  })

  it('多段 component=目录/index（system/user/index）', () => {
    expect(resolveViewComponent('system/user/index')).toBeTypeOf('function')
  })

  it('空/未知 component 返回 undefined', () => {
    expect(resolveViewComponent('')).toBeUndefined()
    expect(resolveViewComponent('not/exist/page')).toBeUndefined()
  })
})

describe('resolveChildPath —— 子为绝对路径直接用', () => {
  it('绝对子路径原样返回', () => {
    expect(resolveChildPath('/tickets', '/tickets')).toBe('/tickets')
  })
  it('相对子路径拼接并归并双斜杠', () => {
    expect(resolveChildPath('/system', 'user')).toBe('/system/user')
    expect(resolveChildPath('/system/', '/user')).toBe('/user')
  })
})

describe('侧栏渲染契约——hasOneShowingChild + pathResolve', () => {
  const assignmentRules = menu({
    code: 'ticket_assignment_rules', name: '分派规则', menu_type: 2,
    path: '/tickets/rules', component: 'ticket/rules/index', icon: 'setting', sort_order: 4,
  })

  it('工单管理的类型配置和分派规则使用不同的离线图标', () => {
    const [ticket] = buildRoutes([
      menu({
        code: 'ticket_manage', name: '工单管理', menu_type: 1, path: '/tickets',
        children: [
          menu({
            code: 'ticket_type_manage', name: '类型配置', menu_type: 2,
            path: '/tickets/types', component: 'ticket/type/index', icon: 'setting', sort_order: 3,
          }),
          assignmentRules,
        ],
      }),
    ])

    const menuIcons = ticket.children?.map(({ meta }) => meta.icon)
    expect(menuIcons).toEqual(['mdi:tune', 'mdi:call-split'])
    for (const icon of menuIcons ?? []) expect(icons).toHaveProperty(String(icon))
  })

  it('分派规则沿用服务端下发的自定义图标', () => {
    const [route] = buildRoutes([{ ...assignmentRules, icon: 'mdi:account-group' }])
    expect(route.meta.icon).toBe('mdi:account-group')
  })

  it('顶层页面包 Layout 后渲染为可点叶子，index === menu.path', () => {
    const route = buildRoutes([
      menu({ code: 'audit_log', name: '审计日志', menu_type: 2, path: '/audit', component: 'system/menu/index' }),
    ])[0]

    const { oneShowingChild, onlyOneChild } = hasOneShowingChild(
      route.children as unknown as AppRouteRecordRaw[],
      route as unknown as AppRouteRecordRaw,
    )
    expect(oneShowingChild).toBe(true)

    // 复刻 useRenderMenuItem：fullPath=pathResolve('/', '/audit')，index=pathResolve(fullPath, '')
    const fullPath = pathResolve('/', route.path)
    expect(pathResolve(fullPath, onlyOneChild?.path ?? '')).toBe('/audit')
  })
})

/**
 * 菜单树 → vue-router 路由（纯模块，01 §3.2 契约落地核心）
 *
 * 独立成模块的目的：buildRoutes 不依赖 Pinia / vue-router 实例，便于单测
 * （permission store 只是调用方）。component 字符串解析走 import.meta.glob 查表。
 *
 * 种子实况四特例（§3.2①–④）：
 *  ① 父子同 path（/tickets 目录 + /tickets 页面）——子为绝对路径直接用，父 redirect 不拼接双斜杠
 *  ② 顶层无父页面（audit_log type=2 parent=null）——套 Layout + 子路由 path:''
 *  ③ 目录带 component（home type=1 component='home'）——按页面渲染，命中 views/Home/index.vue
 *  ④ 菜单外静态补充路由——不在本模块（见 router/routes.ts constantRoutes）
 */

import { Layout } from '@/utils/routerHelper'

/** import.meta.glob 返回的惰性加载函数 */
export type ViewComponent = () => Promise<unknown>

/** glob 查表（模块级——Vite 编译期展开一次，函数内重建是浪费） */
const viewModules = import.meta.glob('@/views/**/*.vue') as Record<string, ViewComponent>

/**
 * 小写索引——大小写归一化兜底。
 *
 * 构建产物 glob 键为 `/src/views/Home/index.vue`（大写 H），而菜单种子 component='home'；
 * 不归一化则 `/src/views/home.vue` 与 `/src/views/home/index.vue` 双 miss，
 * 首页会静默回退成 Layout 空壳（P0-2③ 根因）。
 */
const lowerKeyMap = new Map(Object.keys(viewModules).map((k) => [k.toLowerCase(), k]))

/** 未解析到组件时的兜底视图（避免注册出无 component 的裸路由） */
const notFoundView: ViewComponent = () => import('@/views/Error/404.vue')

/** 路由转换所需的菜单字段（与 @/permission 的 MenuNode 结构兼容） */
export interface RouteMenuNode {
  code: string
  name: string
  menu_type: number
  path: string
  component: string
  icon: string
  sort_order: number
  visible: boolean
  children?: RouteMenuNode[]
}

/** 生成的路由形状（宽松类型，落地时由 store 断言为 RouteRecordRaw） */
export interface BuiltRoute {
  path: string
  name?: string
  component?: unknown
  redirect?: string
  meta: Record<string, unknown>
  children?: BuiltRoute[]
}

/**
 * component 字符串 → 视图组件（大小写归一化）。
 *
 * 候选顺序：`/src/views/{c}.vue` → `/src/views/{c}/index.vue`；每级先精确命中、再小写兜底。
 * 单段 component=文件、多段 component（如 system/user/index）=目录/index（§3.2③）。
 */
export function resolveViewComponent(component: string): ViewComponent | undefined {
  if (!component) return undefined
  const normalized = component.replace(/^\/+/, '').replace(/\.vue$/i, '')
  if (!normalized) return undefined
  const candidates = [`/src/views/${normalized}.vue`, `/src/views/${normalized}/index.vue`]
  for (const key of candidates) {
    if (viewModules[key]) return viewModules[key]
    const lower = lowerKeyMap.get(key.toLowerCase())
    if (lower) return viewModules[lower]
  }
  return undefined
}

/** 拼接父子路径：子为绝对路径直接用（§3.2① 种子全路径），否则相对拼接 */
export function resolveChildPath(parentPath: string, childPath: string): string {
  if (childPath.startsWith('/')) return childPath
  return `${parentPath}/${childPath}`.replace(/\/{2,}/g, '/')
}

const isDirectory = (menu: RouteMenuNode): boolean => menu.menu_type === 1
const isPage = (menu: RouteMenuNode): boolean => menu.menu_type === 2
/** type=1 且 component 非空 → 按页面渲染（§3.2③ home 特例） */
const isPageLike = (menu: RouteMenuNode): boolean => isPage(menu) || (isDirectory(menu) && !!menu.component)

function toMeta(menu: RouteMenuNode): Record<string, unknown> {
  return { title: menu.name, icon: menu.icon, hidden: !menu.visible }
}

/**
 * 顶层页面（parent=null 的 type=2，或 type=1 带 component 的 home）：
 * 套 Layout 使侧栏/顶栏在位，子路由 path:'' 渲染在父 path 上（§3.2②）。
 *
 * 父 route 带 name=menu.code、子带 name=`${menu.code}_page`——两级都有名，
 * 登出时 resetRouter 才能把整条（含父容器）按名清干净，不留幽灵路由。
 */
function buildTopLevelPage(menu: RouteMenuNode, component: ViewComponent): BuiltRoute {
  return {
    path: menu.path,
    name: menu.code,
    component: Layout,
    meta: toMeta(menu),
    children: [
      {
        path: '',
        name: `${menu.code}_page`,
        component,
        meta: {},
      },
    ],
  }
}

function buildPage(menu: RouteMenuNode, component: ViewComponent, depth: number): BuiltRoute {
  // 顶层页面套 Layout；嵌套页面由父目录提供 Layout，不再套一层
  if (depth === 0) return buildTopLevelPage(menu, component)
  return {
    path: menu.path,
    name: menu.code,
    component,
    meta: toMeta(menu),
  }
}

/** 目录（type=1 无 component）→ Layout 父级，redirect 指向第一个子页（§3.2①） */
function buildDirectory(menu: RouteMenuNode, depth: number): BuiltRoute {
  const route: BuiltRoute = {
    path: menu.path,
    name: menu.code,
    component: Layout,
    meta: toMeta(menu),
  }
  if (menu.children?.length) {
    const children = buildRoutes(menu.children, depth + 1)
    route.children = children
    const visibleChildren = children.filter((child) => child.path)
    if (!route.redirect && visibleChildren.length) {
      route.redirect = resolveChildPath(menu.path, visibleChildren[0].path)
    }
  }
  return route
}

/**
 * 菜单树 → 路由数组（07-menu 契约：menu_type 1=目录 2=页面 3=按钮不进树）。
 *
 * @param menus 菜单树（后端 GET /user/menus 已过滤 visible）
 * @param depth 当前层级（顶层 0）——顶层页面需套 Layout，嵌套页面由父目录提供 Layout
 */
export function buildRoutes(menus: RouteMenuNode[], depth = 0): BuiltRoute[] {
  return menus
    .filter((menu) => isDirectory(menu) || isPage(menu))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((menu) => {
      if (isPageLike(menu)) {
        const component = resolveViewComponent(menu.component)
        if (!component) {
          console.warn(`[router] 未找到组件: ${menu.component}（菜单 ${menu.code}）`)
        }
        return buildPage(menu, component ?? notFoundView, depth)
      }
      return buildDirectory(menu, depth)
    })
}

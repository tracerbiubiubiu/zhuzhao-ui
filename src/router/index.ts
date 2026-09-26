import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import type { App } from 'vue'
import { Layout } from '@/utils/routerHelper'
import { NO_RESET_WHITE_LIST } from '@/constants'
import constantRoutes from './routes'

const loginRoute = constantRoutes.find((route) => route.name === 'Login') as RouteRecordRaw
const changePasswordRoute = constantRoutes.find((route) => route.name === 'ChangePassword') as RouteRecordRaw
const redirectRoute = constantRoutes.find((route) => route.name === 'Redirect') as RouteRecordRaw

/**
 * 常量路由组（constantRouterMap，设计 §3.2⑤）
 *
 * - 根容器 `/`：Layout + redirect:/home，`meta.hidden:true`——不进侧栏/顶栏，
 *   否则它有多个可见子项，会渲染成「Please set title」脏分组（P1-8）。
 * - /home 由后端菜单动态下发（种子 home，对所有登录用户可见）；根 redirect:'/home'
 *   只有在菜单 addRoute 之后才有效（登录后先 ensureDynamicRoutes 再 push，见 §3.1）。
 * - /redirect 挂 Layout 下供 TagsView 刷新；登录/改密为独立全屏页（不挂 Layout）。
 */
export const constantRouterMap: RouteRecordRaw[] = [
  {
    path: '/',
    component: Layout,
    redirect: '/home',
    meta: { hidden: true },
    children: [redirectRoute],
  },
  loginRoute,
  changePasswordRoute,
]

const router = createRouter({
  history: createWebHashHistory(),
  strict: true,
  routes: constantRouterMap,
})

export const resetRouter = () => {
  router.getRoutes().forEach((route) => {
    const { name } = route
    if (name && !NO_RESET_WHITE_LIST.includes(name as string)) {
      if (router.hasRoute(name)) router.removeRoute(name)
    }
  })
}

export const setupRouter = (app: App<Element>) => {
  app.use(router)
}

export default router

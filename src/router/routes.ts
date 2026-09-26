import type { RouteRecordRaw } from 'vue-router'

/**
 * 常量路由（constantRoutes，设计 §3.2⑤）——应用启动即注册，不依赖菜单树。
 *
 * 只保留菜单词表外的常驻页：登录、强制改密、redirect 中转（TagsView 刷新用）。
 *
 * ⚠ /home 与 /system/* 此前在此静态占位，会让静态路由**优先于**后端菜单命中
 * （探针已证：侧栏对所有用户含 viewer 都显示「用户/角色/菜单/组织」，手输 URL 也能进占位页），
 * 违反 §3.2④「静态补充路由只用于菜单词表外的页」——已下线，一律交由后端菜单动态下发。
 *
 * 根容器 `/`（Layout + redirect:/home）在 src/router/index.ts 的 constantRouterMap 中组装。
 */
const constantRoutes: RouteRecordRaw[] = [
  { path: '/login', name: 'Login', component: () => import('@/views/Login/Login.vue'), meta: { title: '登录', hidden: true } },
  { path: '/change-password', name: 'ChangePassword', component: () => import('@/views/ChangePassword/index.vue'), meta: { title: '修改密码', hidden: true } },
  // Redirect 中转（挂在 Layout 下供 TagsView 刷新——见 router/index.ts）
  { path: '/redirect/:path(.*)', name: 'Redirect', component: () => import('@/views/Redirect/Redirect.vue'), meta: { hidden: true } },
]

export default constantRoutes

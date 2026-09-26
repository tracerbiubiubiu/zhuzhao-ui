import type { RouteRecordRaw } from 'vue-router'

// 静态路由（constantRoutes 01 §3.2⑤）——菜单外常驻
const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'Login', component: () => import('@/views/Login/Login.vue'), meta: { title: '登录' } },
  { path: '/change-password', name: 'ChangePassword', component: () => import('@/views/ChangePassword/index.vue'), meta: { title: '修改密码' } },
  { path: '/', redirect: '/home' },
  { path: '/home', name: 'Home', component: () => import('@/views/Home/index.vue'), meta: { title: '首页' } },
  // system 域占位（W3 交付完整版）
  { path: '/system/user', name: 'SystemUser', component: () => import('@/views/system/user/index.vue'), meta: { title: '用户管理' } },
  { path: '/system/role', name: 'SystemRole', component: () => import('@/views/system/role/index.vue'), meta: { title: '角色管理' } },
  { path: '/system/menu', name: 'SystemMenu', component: () => import('@/views/system/menu/index.vue'), meta: { title: '菜单管理' } },
  { path: '/system/org', name: 'SystemOrg', component: () => import('@/views/system/org/index.vue'), meta: { title: '组织管理' } },
]

export default routes

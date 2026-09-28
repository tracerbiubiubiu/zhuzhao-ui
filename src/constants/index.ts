/**
 * 请求成功状态码
 */
export const SUCCESS_CODE = 0

/**
 * 请求contentType
 */
export const CONTENT_TYPE = 'application/json'

/**
 * 请求超时时间
 */
export const REQUEST_TIMEOUT = 30000

/**
 * 不重定向白名单
 */
export const NO_REDIRECT_WHITE_LIST = ['/login']

/**
 * 不重置路由白名单
 *
 * = constantRoutes 的实名（§3.2⑤）：登出时 resetRouter 只清菜单动态路由，
 * 常量路由（登录/改密/403/会话错误页/redirect 中转）必须存活。动态注册的 NotFound catch-all
 * **不放白名单**——登出即被清除，配合 resetCatchAll() 让下次登录重新尾注册，
 * 避免依赖 addRoute 的「同名替换」语义（P0-3 静态路由下线后本仓再无 /home、/system/* 静态名）。
 * ⚠ 漏登记 = 登出/401 终态后该常量路由被删且不复活（SPA 内 createRouter 只跑一次）——
 * routing.test 有「constantRoutes 实名 ⊆ 白名单」防漂移断言（检视 B-1：/403 曾因此成死路由）。
 */
export const NO_RESET_WHITE_LIST = ['Login', 'ChangePassword', 'SessionError', 'Forbidden', 'Redirect', 'Profile']

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
 * 常量路由（登录/改密/redirect 中转）必须存活。动态注册的 NotFound catch-all
 * **不放白名单**——登出即被清除，配合 resetCatchAll() 让下次登录重新尾注册，
 * 避免依赖 addRoute 的「同名替换」语义（P0-3 静态路由下线后本仓再无 /home、/system/* 静态名）。
 */
export const NO_RESET_WHITE_LIST = ['Login', 'ChangePassword', 'Redirect']

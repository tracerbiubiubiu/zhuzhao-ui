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
export const REQUEST_TIMEOUT = 60000

/**
 * 不重定向白名单
 */
export const NO_REDIRECT_WHITE_LIST = ['/login']

/**
 * 不重置路由白名单
 */
// W2 评审 B3：白名单=本仓实际静态路由名（种子死名清理）
export const NO_RESET_WHITE_LIST = [
  'Home',
  'SystemUser',
  'SystemRole',
  'SystemMenu',
  'SystemOrg',
  'ChangePassword',
  'Login',
  'NotFound',
  'Redirect'
]

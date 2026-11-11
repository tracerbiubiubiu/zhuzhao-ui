/**
 * 头像展示 URL 归一（2026-10-29 刷新丢头像批）。
 *
 * users.avatar 存的是对象存储裸 key（bind 端点语义，service.BindAvatar→UpdateUserAvatar），
 * 历史数据/手工数据也可能是完整路径或外链。展示面统一经此归一：
 * 裸 key 补 `/api/v1/files/` 代理前缀（cookie 鉴权稳定 URL——05 号 A.4 #5），
 * 已是路径/外链的原样返回（幂等——上传组件 emit 的完整路径二次归一不变）。
 */
export function avatarSrc(avatar?: string | null): string {
  if (!avatar) return ''
  if (/^(https?:)?\/\//.test(avatar) || avatar.startsWith('/')) return avatar
  return `/api/v1/files/${avatar}`
}

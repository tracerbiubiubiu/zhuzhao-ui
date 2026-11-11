import { unref, type ComputedRef } from 'vue'
import { ElSubMenu, ElMenuItem, ElTooltip } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { hasOneShowingChild } from '../helper'
import { useRenderMenuTitle } from './useRenderMenuTitle'
import { isUrl, pathResolve } from '@/utils/routerHelper'
const prefixCls = 'v-submenu'

export const useRenderMenuItem = (
  menuMode: ComputedRef<'vertical' | 'horizontal'>,
  isCollapsed?: ComputedRef<boolean>
) => {
  const { t } = useI18n()
  const { renderMenuTitle } = useRenderMenuTitle()

  // allRouters: AppRouteRecordRaw[] = [],
  const renderMenuItem = (routers: AppRouteRecordRaw[], parentPath = '/') => {
    return routers
      .filter((v) => !v.meta?.hidden)
      .map((v) => {
        const meta = v.meta ?? {}
        const { oneShowingChild, onlyOneChild } = hasOneShowingChild(v.children, v)
        const fullPath = isUrl(v.path) ? v.path : pathResolve(parentPath, v.path)

        if (
          oneShowingChild &&
          (!onlyOneChild?.children || onlyOneChild?.noShowingChildren) &&
          !meta?.alwaysShow
        ) {
          const merged = onlyOneChild ? { ...meta, ...(onlyOneChild.meta ?? {}) } : meta
          const item = (
            <ElMenuItem index={onlyOneChild ? pathResolve(fullPath, onlyOneChild.path) : fullPath}>
              {{ default: () => renderMenuTitle(merged) }}
            </ElMenuItem>
          )
          // 收起态叶子项补 tooltip：EP collapse 对叶子不产 popper（目录项有原生子菜单
          // popper、叶子无——2026-11-02 双列/混合收起态走查）；展开态文字可见不需要
          if (unref(isCollapsed) && unref(menuMode) === 'vertical') {
            return (
              <ElTooltip content={t(String(merged.title ?? ''))} placement="right" showAfter={150}>
                {item}
              </ElTooltip>
            )
          }
          return item
        } else {
          return (
            <ElSubMenu
              index={fullPath}
              teleported
              popperClass={unref(menuMode) === 'vertical' ? `${prefixCls}-popper--vertical` : `${prefixCls}-popper--horizontal`}
            >
              {{
                title: () => renderMenuTitle(meta),
                default: () => renderMenuItem(v.children!, fullPath)
              }}
            </ElSubMenu>
          )
        }
      })
  }

  return {
    renderMenuItem
  }
}

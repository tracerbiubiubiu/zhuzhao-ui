<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import { hasOneShowingChild } from '@/components/Menu/helper'

  withDefaults(
    defineProps<{
      routes: AppRouteRecordRaw[]
      activePath?: string
      mode?: 'top' | 'rail'
    }>(),
    {
      activePath: '',
      mode: 'top'
    }
  )

  const emit = defineEmits<{
    select: [route: AppRouteRecordRaw]
  }>()

  const { t } = useI18n()

  /**
   * 一级导航标题（2026-10-29 修复）：与侧栏 Menu 的单子折叠同语义——目录只有一个
   * 可见子级时显示子级标题（任务管理→任务中心），避免同一菜单两种布局两个名字
   */
  const primaryTitle = (route: AppRouteRecordRaw): string => {
    const { oneShowingChild, onlyOneChild } = hasOneShowingChild(route.children, route)
    if (oneShowingChild && onlyOneChild && !onlyOneChild.noShowingChildren) {
      return String(onlyOneChild.meta?.title ?? route.meta?.title ?? '')
    }
    return String(route.meta?.title ?? '')
  }
</script>

<template>
  <nav :class="['primary-nav', `primary-nav--${mode}`]" aria-label="主导航">
    <button
      v-for="route in routes"
      :key="route.path"
      type="button"
      :class="['primary-nav__item', { 'is-active': activePath === route.path }]"
      :title="t(primaryTitle(route))"
      @click="emit('select', route)"
    >
      <Icon v-if="route.meta?.icon" :icon="route.meta.icon" :size="mode === 'rail' ? 22 : 18" />
      <span>{{ t(primaryTitle(route)) }}</span>
    </button>
  </nav>
</template>

<style lang="less" scoped>
  .primary-nav {
    display: flex;

    &__item {
      position: relative;
      display: flex;
      align-items: center;
      color: inherit;
      cursor: pointer;
      background: transparent;
      border: 0;

      &:focus-visible {
        outline: 2px solid var(--el-color-primary);
        outline-offset: -2px;
      }
    }

    &--top {
      height: 100%;
      min-width: 0;
      padding: 0 18px;
      overflow-x: auto;
      color: var(--top-header-text-color);
      flex: 1;
      gap: 4px;
      align-items: center;

      .primary-nav__item {
        gap: 7px;
        height: 36px;
        padding: 0 14px;
        font-size: 13px;
        font-weight: 500;
        white-space: nowrap;
        border-radius: 10px;

        &:hover {
          color: var(--el-color-primary);
          background: var(--top-header-hover-color);
        }

        &.is-active {
          font-weight: 600;
          color: var(--el-color-primary);
          background: var(--el-color-primary-light-9);
        }

        &:focus-visible {
          box-shadow: inset 0 0 0 2px var(--el-color-primary-light-7);
        }
      }
    }

    &--rail {
      flex-direction: column;
      gap: 6px;
      align-items: center;
      padding: 12px 8px;
      color: var(--left-menu-text-color);

      .primary-nav__item {
        flex-direction: column;
        gap: 5px;
        justify-content: center;
        width: 56px;
        min-height: 58px;
        padding: 7px 4px;
        border-radius: 10px;

        span {
          width: 100%;
          overflow: hidden;
          font-size: 11px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        &:hover {
          color: var(--left-menu-text-active-color);
          background: var(--top-header-hover-color);
        }

        &.is-active {
          font-weight: 600;
          color: var(--left-menu-text-active-color);
          background: var(--left-menu-bg-active-color);
        }

        &.is-active::before {
          position: absolute;
          top: 12px;
          bottom: 12px;
          left: -8px;
          width: 3px;
          background: var(--el-color-primary);
          border-radius: 0 3px 3px 0;
          content: '';
        }
      }
    }
  }
</style>

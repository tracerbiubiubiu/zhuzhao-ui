<script setup lang="ts">
  import { useAppStore } from '@/store/modules/app'
  import { useI18n } from 'vue-i18n'
  const prefixCls = 'v-collapse'

  withDefaults(defineProps<{ color?: string }>(), { color: '' })

  const appStore = useAppStore()
  const { t } = useI18n()

  const toggleCollapse = () => {
    appStore.collapse = !appStore.collapse
  }
</script>

<template>
  <button
    :class="prefixCls"
    type="button"
    :aria-label="t(appStore.collapse ? 'layout.expandNavigation' : 'layout.collapseNavigation')"
    @click="toggleCollapse"
  >
    <!-- 图标=动作(Geeker CollapseIcon 同款,EP 内置 Fold/Expand):展开态=Fold(点击收起),
         收起态=Expand(点击展开);目标形态为 Geeker 的 EP Fold/Expand——但 @element-plus/icons-vue 在本仓 pnpm 布局下解析失败(CI 实证),暂用离线包在册字形,工具链修复后再对齐 -->
    <Icon
      :size="18"
      :icon="appStore.collapse ? 'mdi:chevron-double-right' : 'mdi:chevron-double-left'"
      :color="color"
      class="cursor-pointer"
    />
  </button>
</template>

<style scoped>
  .v-collapse {
    background: transparent;
    border: 0;
  }
</style>

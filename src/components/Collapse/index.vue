<script setup lang="ts">
  import { useAppStore } from '@/store/modules/app'
  import { useI18n } from 'vue-i18n'
  import { ElIcon } from 'element-plus'
  import { Expand, Fold } from '@element-plus/icons-vue'
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
         收起态=Expand(点击展开);MDI 离线包不含此二形,EP 内置零依赖 -->
    <el-icon :size="18" :color="color" class="cursor-pointer">
      <Expand v-if="appStore.collapse" />
      <Fold v-else />
    </el-icon>
  </button>
</template>

<style scoped>
  .v-collapse {
    background: transparent;
    border: 0;
  }
</style>

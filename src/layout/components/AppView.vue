<script setup lang="ts">
  import { useTagsViewStore } from '@/store/modules/tagsView'
  import Footer from '@/components/Footer/index.vue'
  import { computed } from 'vue'
  import { appConfig } from '@/config/app'

  const tagsViewStore = useTagsViewStore()

  const cachedViews = computed(() => tagsViewStore.cachedViews)
</script>

<template>
  <!-- 2026-10-08 填充链：view 定高（v-scroll-view）→ 本 section flex-1 自滚（非填充页整页滚动
       与原先一致）→ .fill-page 起进入「页面不动、表格内滚」模式（全局样式 index.less） -->
  <section
    class="box-border flex flex-1 flex-col min-h-0 overflow-y-auto overflow-x-hidden p-[var(--app-content-padding)] w-full bg-[var(--app-content-bg-color)]"
  >
    <router-view>
      <template #default="{ Component, route }">
        <keep-alive :include="cachedViews">
          <component :is="Component" :key="route.fullPath" />
        </keep-alive>
      </template>
    </router-view>
  </section>
  <Footer v-if="appConfig.ui.footer" />
</template>

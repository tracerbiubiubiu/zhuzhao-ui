<script setup lang="ts">
  import { ElBacktop } from 'element-plus'

  // 2026-10-08 填充链改造后，整页滚动容器由 ElScrollbar wrap 移交 AppView section
  // （.v-app-view，非填充页 overflow-y-auto）——返回顶部改盯新滚动容器
</script>

<template>
  <ElBacktop target=".v-app-view" />
</template>

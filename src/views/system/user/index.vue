<script setup lang="ts">
/**
 * system/{dir} 页（W3 交付占位——当前为路由可达性占位）
 */
import { ElCard, ElEmpty } from 'element-plus'
</script>
<template>
  <div class="p-4">
    <el-card shadow="hover">
      <template #header><span class="font-semibold">占位页</span></template>
      <el-empty description="此页面随 P4-W3 system 域交付" />
    </el-card>
  </div>
</template>

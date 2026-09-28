<script setup lang="ts">
/**
 * 工单发起（P4-W4——本件为路由占位，form-create 动态表单渲染器随下一批交付
 * （02 §2-W4：先渲染器后设计器；W0 后 callback_url 不传、params 提示勿填口令仅任务域））
 * 静态路由（§3.2④，菜单外——入口在列表页「新建工单」按钮挂 ticket:create 码）
 */
import { ElCard, ElEmpty } from 'element-plus'

// keep-alive 契约：name=静态路由名
defineOptions({ name: 'TicketCreate' })
</script>

<template>
  <div class="p-4">
    <el-card shadow="hover">
      <template #header><span class="font-semibold">发起工单</span></template>
      <el-empty description="发起表单（form-create 动态渲染）随 P4-W4 下一批交付" />
    </el-card>
  </div>
</template>

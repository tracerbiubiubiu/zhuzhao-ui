<script setup lang="ts">
/**
 * AuthButton（01 §3.4）——「能看不能点」场景
 *
 * 与 v-permission 的区别：v-permission 移除 DOM（不可见）；
 * AuthButton 置灰（可见但禁用）——用于「有此功能但你的角色无权限」的提示场景。
 */

import { computed } from 'vue'
import { ElButton, type ButtonProps } from 'element-plus'
import { usePermission } from './usePermission'

const props = withDefaults(
  defineProps<{
    /** 所需权限码（string=单码；array=任一命中即可用） */
    capability: string | string[]
    /** 无权限时的 tooltip 提示 */
    noPermissionTip?: string
  } & ButtonProps>(),
  {
    noPermissionTip: '当前角色无此操作权限',
  },
)

const { hasPerm, hasAny } = usePermission()

const allowed = computed(() => {
  if (Array.isArray(props.capability)) {
    return hasAny(...props.capability)
  }
  return hasPerm(props.capability)
})
</script>

<template>
  <el-tooltip :content="noPermissionTip" :disabled="allowed" placement="top">
    <el-button v-bind="$attrs" :disabled="!allowed || Boolean($attrs.disabled)">
      <slot />
    </el-button>
  </el-tooltip>
</template>

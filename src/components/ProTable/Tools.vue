<script setup lang="ts">
/**
 * ProTable 数据面工具组（密度/聚焦）——纯展示组件，状态与切换逻辑在 ProTable 本体。
 * 落位规则（frontend-standard.md「数据密度与聚焦模式」节）：toolbar 槽行右端 >
 * 并入筛选行右端（不设孤行）> 独占行（皆无时兜底，当前仓内无此页型）。
 */
import { ElButton, ElTooltip } from 'element-plus'
import { Icon } from '@iconify/vue'

defineProps<{ density: 'default' | 'small'; focused: boolean; showFocus: boolean }>()
defineEmits<{ (e: 'toggle-density'): void; (e: 'toggle-focus'): void }>()
</script>

<template>
  <div class="flex shrink-0 items-center gap-1">
    <el-tooltip :content="density === 'small' ? '切换为舒适' : '切换为紧凑'" placement="top">
      <el-button size="small" text bg :data-testid="`pt-density-${density}`" @click="$emit('toggle-density')">
        <Icon icon="mdi:format-line-spacing" :height="14" class="mr-1" />
        {{ density === 'small' ? '舒适' : '紧凑' }}
      </el-button>
    </el-tooltip>
    <el-tooltip v-if="showFocus" content="聚焦模式（整卡满屏，Esc 退出）" placement="top">
      <el-button size="small" text bg :data-testid="`pt-focus-${focused}`" @click="$emit('toggle-focus')">
        <Icon :icon="focused ? 'mdi:fullscreen-exit' : 'mdi:fullscreen'" :height="16" />
      </el-button>
    </el-tooltip>
  </div>
</template>

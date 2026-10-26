<script setup lang="ts">
/**
 * 情报结果结构化渲染器（递归）——上游 result 为任意嵌套 JSON 键值对，
 * 逐层展开为可读的键值树；与「原始 JSON」视图二选一展示。
 * 颜色全部走 EP CSS 变量（暗色模式自适应）。
 */
defineOptions({ name: 'IntelResult' })

defineProps<{
  /** 键名（对象键或数组下标，根节点不传） */
  label?: string
  /** 当前层的数据（对象/数组/标量） */
  data: unknown
}>()

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}
</script>

<template>
  <div class="ir-row">
    <span v-if="label !== undefined" class="ir-key">{{ label }}</span>

    <div
      v-if="isPlainObject(data)" class="ir-box"
      :class="label !== undefined ? 'ml-3' : ''"
    >
      <IntelResult
        v-for="(v, k) in (data as Record<string, unknown>)" :key="String(k)"
        :label="String(k)" :data="v"
      />
      <span v-if="!Object.keys(data).length" class="ir-scalar ir-null">{}</span>
    </div>

    <div v-else-if="Array.isArray(data)" class="ir-box" :class="label !== undefined ? 'ml-3' : ''">
      <IntelResult
        v-for="(v, i) in (data as unknown[])" :key="i"
        :label="String(i + 1)" :data="v"
      />
      <span v-if="!data.length" class="ir-scalar ir-null">[]</span>
    </div>

    <span
      v-else-if="data === null" class="ir-scalar ir-null"
    >null</span>
    <span
      v-else-if="typeof data === 'boolean'" class="ir-scalar ir-bool"
    >{{ data }}</span>
    <span
      v-else-if="typeof data === 'number'" class="ir-scalar ir-num"
    >{{ data }}</span>
    <span v-else class="ir-scalar ir-str">{{ String(data) }}</span>
  </div>
</template>

<style scoped>
.ir-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0 8px;
  padding: 1px 0;
}

.ir-key {
  flex: none;
  min-width: 3em;
  font-size: 12px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
}

/* 嵌套容器：浅底色+左缘细线区分层级 */
.ir-box {
  flex: 1 1 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 3px 0;
  padding: 6px 10px;
  border-left: 2px solid var(--el-border-color);
  border-radius: 4px;
  background: var(--el-fill-color-lighter);
}

.ir-scalar {
  font-size: 12px;
  word-break: break-all;
}

.ir-str {
  color: var(--el-color-primary);
}

.ir-num {
  color: var(--el-color-success);
}

.ir-bool {
  color: var(--el-color-warning);
}

.ir-null {
  color: var(--el-text-color-placeholder);
  font-style: italic;
}
</style>

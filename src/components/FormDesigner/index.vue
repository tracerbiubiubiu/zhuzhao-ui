<template>
  <div class="fd-designer">
    <!-- 物料区：八类型（01 号 §3.1 调色板——richtext 第八种） -->
    <aside class="fd-palette">
      <div class="fd-palette-title">字段类型</div>
      <div
        v-for="c in FIELD_CATALOG"
        :key="c.type"
        class="fd-pal-item"
        :data-testid="`fd-add-${c.type}`"
        @click="d.add(c.type)"
      >
        {{ c.label }}
      </div>
    </aside>

    <!-- 画布层（sortablejs） -->
    <CanvasPane
      :fields="d.fields.value"
      :selected="d.selected.value"
      :errors="errMap"
      @select="d.select"
      @remove="d.remove"
      @move="d.move"
    />

    <!-- 属性面板层 -->
    <PropertyPane
      :field="current"
      :selected="d.selected.value"
      :key-err="d.selected.value >= 0 ? d.keyError(d.selected.value) : ''"
      :regex-err="d.selected.value >= 0 ? d.regexError(d.selected.value) : ''"
      @add-option="d.addOption"
      @remove-option="d.removeOption"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * FormDesigner 表单设计器（B1-1 设计器壳——01 号 §3.1 自研拍定的实施载体）。
 *
 * 三层分离：画布交互（CanvasPane·sortablejs）/ 属性面板（PropertyPane）/
 * schema 适配与状态机（schemaAdapter + useDesigner——纯逻辑 vitest 直测）。
 * 与专家模式（type 页表格编辑器）共存：本组件经 defineExpose 暴露
 * loadFromDefs / serialize / saveBlocked，保存走同一 replaceTicketTypeFields
 * 全量替换管线（危险确认在调用方）。预览=真渲染器渲染真 schema 由调用方
 * 复用发起页 DynamicFormField（B1-1 后续接入预览 Tab）。
 *
 * 2026-10-22 spike 结论（01 §3.1）：form-create designer 对称验证判
 * 「非接近无损」（regex 往返丢失/richtext 语义断），维持自研。
 */
import { computed } from 'vue'
import CanvasPane from './CanvasPane.vue'
import PropertyPane from './PropertyPane.vue'
import { createDesignerState } from './useDesigner'
import { FIELD_CATALOG } from './types'
import type { TicketTypeFieldDef, TicketTypeFieldInput } from '@/api/ticket'

// 命令式接口：dialog 打开时调用方 loadFromDefs(后端字段) 初始化
const d = createDesignerState()

const current = computed(() => (d.selected.value >= 0 ? d.fields.value[d.selected.value] ?? null : null))
const errMap = computed(() => {
  const m = new Map<number, string>()
  for (const e of d.validate()) if (!m.has(e.field_index)) m.set(e.field_index, e.message)
  if (d.selected.value >= 0) {
    const ke = d.keyError(d.selected.value)
    if (ke && !m.has(d.selected.value)) m.set(d.selected.value, ke)
  }
  return m
})

defineExpose<{
  loadFromDefs: (defs: TicketTypeFieldDef[]) => void
  serialize: () => TicketTypeFieldInput[]
  saveBlocked: () => boolean
  validate: () => ReturnType<typeof d.validate>
  fields: typeof d.fields
}>({
  loadFromDefs: d.loadFromDefs,
  serialize: d.serialize,
  saveBlocked: d.saveBlocked,
  validate: d.validate,
  fields: d.fields,
})
</script>

<style scoped>
.fd-designer { display: flex; gap: 10px; height: 480px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; padding: 10px; background: var(--el-bg-color); }
.fd-palette { width: 120px; flex-shrink: 0; border-right: 1px solid var(--el-border-color-lighter); padding-right: 10px; }
.fd-palette-title { font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 8px; }
.fd-pal-item { border: 1px dashed var(--el-border-color); border-radius: 4px; padding: 6px 8px; margin-bottom: 6px; cursor: pointer; font-size: 13px; user-select: none; }
.fd-pal-item:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
.fd-pal-item + .fd-pal-item { margin-top: 0; }
.fd-designer > :nth-child(2) { flex: 1; min-width: 0; }
.fd-designer > :nth-child(3) { width: 280px; flex-shrink: 0; border-left: 1px solid var(--el-border-color-lighter); }
</style>

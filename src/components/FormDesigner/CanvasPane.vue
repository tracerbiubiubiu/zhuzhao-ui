<template>
  <div class="fd-canvas">
    <div ref="listEl" class="fd-canvas-list" data-testid="fd-canvas-list">
      <div
        v-for="(f, i) in fields"
        :key="f._uid"
        class="fd-card"
        :class="{ sel: i === selected, err: hasError(i) }"
        :data-index="i"
        @click="$emit('select', i)"
      >
        <span class="fd-idx">{{ i + 1 }}</span>
        <span class="fd-drag" title="拖拽排序">⠿</span>
        <div class="fd-card-main">
          <b>{{ f.field_label || '（未命名）' }}</b>
          <span class="fd-sub">
            <el-tag size="small" type="info">{{ catalogOf(f.field_type).label }}</el-tag>
            <span v-if="f.field_key" class="fd-key">{{ f.field_key }}</span>
            <span v-if="isOptionType(f.field_type)" class="fd-key">{{ f.field_options?.length ?? 0 }} 选项</span>
            <span v-if="f.validate_regex" class="fd-key">regex</span>
          </span>
          <span v-if="errorText(i)" class="fd-err">{{ errorText(i) }}</span>
        </div>
        <span v-if="f.required" class="fd-req">*</span>
        <span class="fd-del" title="删除" @click.stop="$emit('remove', i)">✕</span>
      </div>
      <div v-if="!fields.length" class="fd-empty">从左侧点击字段类型添加；拖动卡片调整顺序</div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * CanvasPane 画布交互层（B1-1 三层分离之三——sortablejs 拖拽 + 选中/删除）。
 *
 * sortablejs onEnd → emit('move', oldIndex, newIndex)——排序语义在 useDesigner.move
 * （状态机纯逻辑可测），DOM 层只做事件映射。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Sortable from 'sortablejs'
import { ElTag } from 'element-plus'
import { isOptionType } from './schemaAdapter'
import { catalogOf, type DesignerField } from './types'

const props = defineProps<{
  fields: DesignerField[]
  selected: number
  errors: Map<number, string>
}>()
const emit = defineEmits<{ (e: 'select', idx: number): void; (e: 'remove', idx: number): void; (e: 'move', from: number, to: number): void }>()

const listEl = ref<HTMLElement>()
let sortable: Sortable | null = null

onMounted(() => {
  if (!listEl.value) return
  sortable = Sortable.create(listEl.value, {
    animation: 150,
    handle: '.fd-drag',
    draggable: '.fd-card',
    onEnd(evt) {
      if (evt.oldIndex == null || evt.newIndex == null || evt.oldIndex === evt.newIndex) return
      emit('move', evt.oldIndex, evt.newIndex)
    },
  })
})
onBeforeUnmount(() => sortable?.destroy())

const hasError = (i: number) => props.errors.has(i)
const errorText = (i: number) => props.errors.get(i) ?? ''
</script>

<style scoped>
.fd-canvas { height: 100%; display: flex; flex-direction: column; }
.fd-canvas-list { flex: 1; overflow: auto; padding: 8px; background: var(--el-fill-color-lighter); border-radius: 4px; min-height: 240px; }
.fd-card { display: flex; align-items: center; gap: 8px; background: var(--el-bg-color); border: 1px solid var(--el-border-color-light); border-radius: 4px; padding: 8px 10px; margin-bottom: 6px; cursor: pointer; }
.fd-card:hover { border-color: var(--el-color-primary-light-5); }
.fd-card.sel { border-color: var(--el-color-primary); box-shadow: 0 0 0 1px var(--el-color-primary) inset; }
.fd-card.err { border-color: var(--el-color-danger); }
.fd-idx { color: var(--el-text-color-placeholder); font-size: 12px; width: 16px; }
.fd-drag { cursor: grab; color: var(--el-text-color-placeholder); user-select: none; }
.fd-card-main { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.fd-card-main b { font-size: 13px; }
.fd-sub { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--el-text-color-secondary); }
.fd-key { font-family: monospace; }
.fd-err { color: var(--el-color-danger); font-size: 12px; }
.fd-req { color: var(--el-color-danger); font-weight: 700; }
.fd-del { color: var(--el-text-color-placeholder); cursor: pointer; padding: 0 4px; }
.fd-del:hover { color: var(--el-color-danger); }
.fd-empty { border: 1px dashed var(--el-border-color); border-radius: 4px; color: var(--el-text-color-placeholder); text-align: center; padding: 40px 0; }
.sortable-ghost { opacity: 0.4; }
</style>

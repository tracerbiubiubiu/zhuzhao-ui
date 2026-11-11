<template>
  <!-- eslint-disable-next-line vue/no-v-html — XSS SSOT：HTML 经服务端 goldmark+bluemonday 白名单消毒出站（B5-4 05 号 §6），前端不自行渲染用户输入 -->
  <div class="richtext-view" v-html="renderedHtml"></div>
</template>

<script setup lang="ts">
/**
 * RichtextView B5-4 服务端渲染只读视图（05 号 §6 渲染 SSOT——前端不自行渲染用户输入）。
 * 调 POST /tickets/richtext/render 获取白名单 HTML（goldmark+bluemonday 消毒出站）。
 */
import { ref, watch, onMounted } from 'vue'
import { renderRichtext } from '@/api/storage'

const props = defineProps<{ content: string }>()
const renderedHtml = ref('')

async function render() {
  if (!props.content?.trim()) {
    renderedHtml.value = ''
    return
  }
  try {
    const result = await renderRichtext({ content: props.content })
    renderedHtml.value = result.html
  } catch {
    renderedHtml.value = `<pre class="whitespace-pre-wrap">${props.content}</pre>`
  }
}

onMounted(render)
watch(() => props.content, render)
</script>

<style scoped>
.richtext-view {
  line-height: 1.6;
  font-size: 14px;
}
.richtext-view :deep(h1) { font-size: 1.4em; margin: 0.8em 0; }
.richtext-view :deep(h2) { font-size: 1.2em; margin: 0.7em 0; }
.richtext-view :deep(h3) { font-size: 1.1em; margin: 0.6em 0; }
.richtext-view :deep(p) { margin: 0.5em 0; }
.richtext-view :deep(ul), .richtext-view :deep(ol) { padding-left: 1.5em; margin: 0.5em 0; }
.richtext-view :deep(code) {
  background: var(--el-fill-color-light);
  padding: 2px 4px;
  border-radius: 3px;
  font-family: monospace;
  font-size: 0.9em;
}
.richtext-view :deep(pre code) {
  display: block;
  padding: 12px;
  border-radius: 4px;
  overflow-x: auto;
}
.richtext-view :deep(table) {
  border-collapse: collapse;
  margin: 0.5em 0;
  width: 100%;
}
.richtext-view :deep(th), .richtext-view :deep(td) {
  border: 1px solid var(--el-border-color);
  padding: 6px 10px;
  text-align: left;
}
.richtext-view :deep(img) {
  max-width: 100%;
  border-radius: 4px;
}
.richtext-view :deep(blockquote) {
  border-left: 3px solid var(--el-color-primary-light-5);
  padding-left: 12px;
  margin: 0.5em 0;
  color: var(--el-text-color-secondary);
}
.richtext-view :deep(a) { color: var(--el-color-primary); }
</style>

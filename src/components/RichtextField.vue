<template>
  <div class="richtext-field">
    <MdEditor
      v-model="content"
      :toolbars="toolbars"
      :placeholder="placeholder"
      :footers="['markdownTotal']"
      language="zh-CN"
      style="height: 320px"
      @on-upload-img="onUploadImg"
    />
    <div v-if="draftRestored" class="draft-hint">
      <el-alert type="info" :closable="true" @close="draftRestored = false">
        已恢复本地草稿（{{ draftTime }}）—— <el-button link type="primary" @click="discardDraft">丢弃草稿</el-button>
      </el-alert>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * RichtextField B5-4 富文本编辑器（05 号 §6——MD 源文本存储 + 服务端白名单渲染）。
 *
 * md-editor-v3 组件（⚠ 同作者的 md-editor-rt 是 React 版——曾错装致编辑器恒空
 * 渲染 `<!---->`，2026-11-03 运行时实证）+ 粘贴图片直传（paste→Blob→presign 三步→稳定 URL 插入）+
 * 本地草稿（localStorage 按账号/类型/字段隔离，2s 防抖；提交成功清理）。
 * 禁 base64 内联（既定纪律——图片一律走对象存储稳定 URL）。
 */
import { computed } from 'vue'
import { ElAlert, ElButton } from 'element-plus'
import { MdEditor, type ToolbarNames } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import { uploadAndConfirm } from '@/api/storage'
import { formatDateTime } from '@/utils/datetime'
import { useRichtextDraft } from './useRichtextDraft'

const props = defineProps<{
  modelValue: string
  placeholder?: string
  /** 由 richtextDraftKey 生成的账号/类型/字段完整 key；无身份时不持久化 */
  draftKey?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const { content, draftRestored, draftTimestamp, clearDraft, discardDraft } = useRichtextDraft(
  () => props.modelValue,
  () => props.draftKey,
  (value) => emit('update:modelValue', value),
)
const draftTime = computed(() => formatDateTime(draftTimestamp.value))

// 工具栏（B5-4 §6 排版诉求=标题/列表/代码块/表格/图片）
const toolbars: ToolbarNames[] = [
  'bold', 'underline', 'italic', 'title', 'strikeThrough',
  'sub', 'sup', 'quote', 'unorderedList', 'orderedList',
  'codeRow', 'code', 'table', 'link', 'image',
  '-', 'revoke', 'next',
]

// ─── 粘贴图片直传（onUploadImg 回调——md-editor-v3 内部处理 paste/drop 事件）───
async function onUploadImg(files: File[], callback: (urls: string[]) => void) {
  const urls: string[] = []
  for (const file of files) {
    try {
      // richtext_create 悬挂态（建单前无 ticket_id——A.5 建单前链）
      const result = await uploadAndConfirm(file, 'richtext_create')
      // 稳定 URL = 代理端点（A.4 #5 硬约束——cookie 自动带、历史工单不裂图）
      urls.push(`/api/v1/files/${result.object_key}`)
    } catch {
      // 单张失败不阻断整批——空占位提示
      urls.push('')
    }
  }
  callback(urls)
}

defineExpose({ clearDraft })
</script>

<style scoped>
.richtext-field {
  width: 100%;
}
.draft-hint {
  margin-top: 8px;
}
</style>

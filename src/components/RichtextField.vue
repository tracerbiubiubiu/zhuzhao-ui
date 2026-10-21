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
        已恢复本地草稿（{{ draftTime }}）—— <el-button link type="primary" @click="clearDraft">丢弃草稿</el-button>
      </el-alert>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * RichtextField B5-4 富文本编辑器（05 号 §6——MD 源文本存储 + 服务端白名单渲染）。
 *
 * md-editor-rt 组件 + 粘贴图片直传（paste→Blob→presign 三步→稳定 URL 插入）+
 * 本地草稿（localStorage 按 type_code 防抖存储——05 号 §6 拍板形态①）。
 * 禁 base64 内联（既定纪律——图片一律走对象存储稳定 URL）。
 */
import { ref, watch, onMounted } from 'vue'
import { ElAlert, ElButton } from 'element-plus'
import { MdEditor } from 'md-editor-rt'
import 'md-editor-rt/lib/style.css'
import { uploadAndConfirm } from '@/api/storage'

const props = defineProps<{
  modelValue: string
  placeholder?: string
  /** 草稿 key（通常 = ticket type_code——按类型隔离） */
  draftKey?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const content = ref(props.modelValue || '')
const draftRestored = ref(false)
const draftTime = ref('')

// 工具栏（B5-4 §6 排版诉求=标题/列表/代码块/表格/图片）
const toolbars = [
  'bold', 'underline', 'italic', 'title', 'strikeThrough',
  'sub', 'sup', 'quote', 'unorderedList', 'orderedList',
  'codeRow', 'code', 'table', 'link', 'image',
  '-', 'revoke', 'next',
] as const

// ─── 粘贴图片直传（onUploadImg 回调——md-editor-rt 内部处理 paste/drop 事件）───
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

// ─── 本地草稿（防抖 2s 写 localStorage，提交后由父组件调用 clearDraft）───
let debounceTimer: ReturnType<typeof setTimeout> | null = null

watch(content, (val) => {
  emit('update:modelValue', val)
  if (props.draftKey && debounceTimer) {
    clearTimeout(debounceTimer)
  }
  if (props.draftKey) {
    debounceTimer = setTimeout(() => {
      if (val.trim()) {
        localStorage.setItem(`richtext-draft:${props.draftKey}`, JSON.stringify({ content: val, ts: Date.now() }))
      }
    }, 2000)
  }
})

onMounted(() => {
  if (props.draftKey) {
    const raw = localStorage.getItem(`richtext-draft:${props.draftKey}`)
    if (raw) {
      try {
        const draft = JSON.parse(raw)
        if (draft.content && draft.content.trim() && draft.content !== props.modelValue) {
          content.value = draft.content
          draftTime.value = new Date(draft.ts).toLocaleString('zh-CN')
          draftRestored.value = true
        }
      } catch {
        localStorage.removeItem(`richtext-draft:${props.draftKey}`)
      }
    }
  }
})

function clearDraft() {
  if (props.draftKey) {
    localStorage.removeItem(`richtext-draft:${props.draftKey}`)
  }
  content.value = props.modelValue || ''
  draftRestored.value = false
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

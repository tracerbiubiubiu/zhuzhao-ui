<template>
  <div class="ticket-attachments">
    <div class="attachments-header">
      <span>附件（{{ attachments.length }}）</span>
      <el-upload
        :show-file-list="false"
        :auto-upload="false"
        multiple
        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,application/zip"
        @change="onUpload"
      >
        <el-button size="small" :loading="uploading" :disabled="!canEdit">
          上传附件
        </el-button>
      </el-upload>
    </div>
    <el-alert v-if="loadError" :title="loadError" type="error" show-icon :closable="false" data-testid="attachments-load-error">
      <el-button size="small" :loading="loading" @click="refresh">重试</el-button>
    </el-alert>
    <el-empty v-if="!loadError && !attachments.length && !loading" description="暂无附件" :image-size="48" />
    <div v-if="attachments.length" v-loading="loading" class="attachments-list">
      <div v-for="att in attachments" :key="att.id" class="attachment-item">
        <span class="att-icon">📄</span>
        <div class="att-info">
          <a :href="`/api/v1/files/${att.object_key}`" target="_blank" class="att-name" rel="noopener">
            {{ att.file_name }}
          </a>
          <span class="att-meta">{{ formatSize(att.size_bytes) }} · {{ att.uploaded_by_name || att.uploaded_by }} · {{ formatTime(att.created_at) }}</span>
        </div>
        <el-button
          v-if="canEdit"
          size="small"
          type="danger"
          text
          :loading="deletingKey === att.object_key"
          @click="onDelete(att)"
        >
          删除
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * TicketAttachments B5-3 工单附件区（05 号 §5）——列表/上传/删除/下载（代理端点稳定 URL）。
 * L2 由后端 handler 编排（附件属 ticket:update 面）；cookie 自动带无需手动 auth。
 */
import { ref, watch, onBeforeUnmount } from 'vue'
import { isAxiosError } from 'axios'
import { ElAlert, ElButton, ElEmpty, ElUpload, ElMessage, ElMessageBox } from 'element-plus'
import type { UploadFile } from 'element-plus'
import { SessionChangedError } from '@/common/auth/tokenStorage'
import {
  listAttachments,
  deleteAttachment,
  uploadAndConfirm,
  type AttachmentView,
} from '@/api/storage'
import { formatDateTime } from '@/utils/datetime'

const props = defineProps<{
  ticketId: string
  canEdit: boolean // 是否显示上传/删除按钮（A.7 拍板：ticket 态存储端点=登录态+L2 零权限码，调用方传 true 常开）
}>()

const attachments = ref<AttachmentView[]>([])
const loading = ref(false)
const loadError = ref('')
const uploading = ref(false)
const deletingKey = ref('')
let loadSequence = 0
let disposed = false

async function refresh(): Promise<boolean | undefined> {
  const ticketId = props.ticketId
  // 空 id 守卫（2026-11-09 根因修复）：详情页进 keep-alive 缓存（cachedViews 按组件名聚合，
  // 页签栏有任一详情页签即缓存）后仍跟踪全局 route——Vue 对 isDeactivated 无 scheduler 守卫，
  // 离开详情时本组件被隐形重渲染 patch 到 ticketId=''，watch 触发本函数曾致
  // GET /tickets//attachments 400「参数错误」toast 每次进出详情必弹。
  // 返回 undefined=「未刷新」，与「被较新刷新替代」的既有调用方语义一致（静默）。
  if (!ticketId) return undefined
  const sequence = ++loadSequence
  loading.value = true
  loadError.value = ''
  try {
    const rows = await listAttachments(ticketId)
    if (disposed || sequence !== loadSequence || ticketId !== props.ticketId) return undefined
    attachments.value = rows
    return true
  } catch {
    if (!disposed && sequence === loadSequence && ticketId === props.ticketId) {
      loadError.value = '附件列表加载失败，请重试'
      return false
    }
    // HTTP/网络错误已由统一请求层提示；这里保留旧列表并提供原位重试。
    return undefined // 被较新的刷新替代，不把过时响应显示为当前失败
  } finally {
    if (!disposed && sequence === loadSequence) loading.value = false
  }
}

async function onUpload(file: UploadFile) {
  if (!file.raw) return
  const ticketId = props.ticketId
  uploading.value = true
  try {
    await uploadAndConfirm(file.raw, 'ticket_attachment', ticketId)
    if (disposed || ticketId !== props.ticketId) return
    const refreshed = await refresh()
    if (disposed || ticketId !== props.ticketId) return
    if (refreshed) ElMessage.success('附件已上传')
    else if (refreshed === false) loadError.value = '附件已上传，但列表刷新失败，请重试'
  } catch (e: unknown) {
    // presign/confirm 的 Axios 错误由请求层负责；直传 PUT 不经过该层，仍需本地提示。
    if (!disposed && ticketId === props.ticketId && !isAxiosError(e) && !(e instanceof SessionChangedError)) {
      ElMessage.error(e instanceof Error ? e.message : '上传失败')
    }
  } finally {
    uploading.value = false
  }
}

async function onDelete(att: AttachmentView) {
  const ticketId = props.ticketId
  try {
    await ElMessageBox.confirm(`确定删除附件「${att.file_name}」？`, '删除附件', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  if (disposed || ticketId !== props.ticketId) return
  deletingKey.value = att.object_key
  try {
    await deleteAttachment({ ticket_id: ticketId, object_key: att.object_key })
    if (disposed || ticketId !== props.ticketId) return
    const refreshed = await refresh()
    if (disposed || ticketId !== props.ticketId) return
    if (refreshed) ElMessage.success('附件已删除')
    else if (refreshed === false) loadError.value = '附件已删除，但列表刷新失败，请重试'
  } catch (e: unknown) {
    if (!disposed && ticketId === props.ticketId && !isAxiosError(e) && !(e instanceof SessionChangedError)) {
      ElMessage.error(e instanceof Error ? e.message : '删除失败')
    }
  } finally {
    deletingKey.value = ''
  }
}

function formatSize(bytes?: string): string {
  if (!bytes) return '-'
  const n = parseInt(bytes)
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / (1024 * 1024)).toFixed(1)}MB`
}

function formatTime(iso: string): string {
  return formatDateTime(iso)
}

watch(() => props.ticketId, () => {
  attachments.value = []
  void refresh()
}, { immediate: true })
onBeforeUnmount(() => { disposed = true; loadSequence++ })
defineExpose({ refresh })
</script>

<style scoped>
.ticket-attachments {
  margin-top: 12px;
}
.attachments-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-weight: 500;
}
.attachments-list {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}
.attachment-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--el-border-color-extra-light);
}
.attachment-item:last-child {
  border-bottom: none;
}
.att-icon {
  font-size: 20px;
  color: var(--el-color-primary);
  flex-shrink: 0;
}
.att-info {
  flex: 1;
  min-width: 0;
}
.att-name {
  color: var(--el-color-primary);
  text-decoration: none;
  font-size: 14px;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.att-name:hover {
  text-decoration: underline;
}
.att-meta {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}
</style>

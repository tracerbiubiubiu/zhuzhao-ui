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
    <el-empty v-if="!attachments.length && !loading" description="暂无附件" :image-size="48" />
    <div v-else class="attachments-list">
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
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  listAttachments,
  deleteAttachment,
  uploadAndConfirm,
  type AttachmentView,
} from '@/api/storage'
import type { UploadFile } from 'element-plus'

const props = defineProps<{
  ticketId: string
  canEdit: boolean // 有 ticket:update 权限时显示上传/删除按钮
}>()

const attachments = ref<AttachmentView[]>([])
const loading = ref(false)
const uploading = ref(false)
const deletingKey = ref('')

async function refresh() {
  loading.value = true
  try {
    attachments.value = await listAttachments(props.ticketId)
  } catch {
    // 静默——附件区非关键路径
  } finally {
    loading.value = false
  }
}

async function onUpload(file: UploadFile) {
  if (!file.raw) return
  uploading.value = true
  try {
    await uploadAndConfirm(file.raw, 'ticket_attachment', props.ticketId)
    await refresh()
    ElMessage.success('附件已上传')
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '上传失败'
    ElMessage.error(msg)
  } finally {
    uploading.value = false
  }
}

async function onDelete(att: AttachmentView) {
  try {
    await ElMessageBox.confirm(`确定删除附件「${att.file_name}」？`, '删除附件', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  deletingKey.value = att.object_key
  try {
    await deleteAttachment({ ticket_id: props.ticketId, object_key: att.object_key })
    await refresh()
    ElMessage.success('附件已删除')
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '删除失败'
    ElMessage.error(msg)
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
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

onMounted(refresh)
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

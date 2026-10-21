<template>
  <div class="storage-avatar-upload">
    <el-upload
      :show-file-list="false"
      :auto-upload="false"
      accept="image/jpeg,image/png,image/webp,image/gif"
      @change="onFileChange"
    >
      <el-avatar :size="80" :src="avatarUrl" class="cursor-pointer">
        {{ avatarUrl ? '' : '👤' }}
      </el-avatar>
      <div v-if="uploading" class="upload-hint">上传中…</div>
      <div v-else class="upload-hint">点击更换头像</div>
    </el-upload>
  </div>
</template>

<script setup lang="ts">
/**
 * StorageAvatarUpload B5-2 头像上传（05 号 §4）——canvas 压缩单 key（2026-10-19 拍板形态）。
 *
 * 链路：选文件 → canvas 压缩（≤512px，JPEG 0.85 质量——头像场景够用）→ presign+PUT+confirm
 * → bindAvatar 回写 users.avatar → 父组件刷 profile。
 */
import { ref, computed } from 'vue'
import { ElAvatar, ElUpload, ElMessage } from 'element-plus'
import type { UploadFile } from 'element-plus'
import { uploadAndConfirm, bindAvatar } from '@/api/storage'

const props = defineProps<{ currentAvatar?: string }>()
const emit = defineEmits<{ avatarChanged: [url: string] }>()

const uploading = ref(false)
const newAvatarUrl = ref('')

const avatarUrl = computed(() => newAvatarUrl.value || props.currentAvatar || '')

/** canvas 压缩（B5-2 拍板：前端 canvas 压缩单 key——零 Go 侧新依赖） */
async function compressImage(file: File, maxDim = 512, quality = 0.85): Promise<File> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, w, h)
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), 'image/jpeg', quality),
  )
  return new File([blob], 'avatar.jpg', { type: 'image/jpeg' })
}

async function onFileChange(uploadFile: UploadFile) {
  if (!uploadFile.raw) return
  uploading.value = true
  try {
    const compressed = await compressImage(uploadFile.raw)
    const result = await uploadAndConfirm(compressed, 'avatar')
    await bindAvatar({ object_key: result.object_key })
    // 稳定 URL = 代理端点（A.4 #5——cookie 自动带，img 可直接用）
    newAvatarUrl.value = `/api/v1/files/${result.object_key}`
    emit('avatarChanged', newAvatarUrl.value)
    ElMessage.success('头像已更新')
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '上传失败'
    ElMessage.error(msg)
  } finally {
    uploading.value = false
  }
}
</script>

<style scoped>
.storage-avatar-upload {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.upload-hint {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}
.cursor-pointer {
  cursor: pointer;
}
</style>

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

    <!-- 裁剪对话框（2026-10-29 批：方形取景+拖动/滚轮缩放——Jira/GitHub/Slack 同款交互；
         GIF 动图不经此框——canvas 重绘丢动画，走原样直传） -->
    <el-dialog v-model="cropVisible" title="裁剪头像" width="420px" :close-on-click-modal="false" @closed="destroyCropper">
      <div class="flex justify-center">
        <img ref="cropImgRef" :src="cropSrc" class="block max-w-full" alt="裁剪预览" />
      </div>
      <div class="mt-2 text-center text-xs text-gray-400">拖动调整位置，滚轮缩放；确认后输出 512×512 方形 JPEG</div>
      <template #footer>
        <el-button @click="cropVisible = false">取消</el-button>
        <el-button type="primary" :loading="uploading" @click="confirmCrop">确认裁剪并上传</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
/**
 * StorageAvatarUpload B5-2 头像上传（05 号 §4）。
 *
 * 链路（2026-10-29 裁剪批）：选文件 → 前置拦截（>20MB 拒、GIF 原样直传保动画）→
 * 方形裁剪对话框（cropperjs，输出 512×512 JPEG 0.85）→ presign+PUT+confirm
 * → bindAvatar 回写 users.avatar → 父组件刷 profile。
 */
import { ref, computed, watch, nextTick } from 'vue'
import { ElAvatar, ElUpload, ElMessage, ElDialog, ElButton } from 'element-plus'
import type { UploadFile } from 'element-plus'
import Cropper from 'cropperjs'
import 'cropperjs/dist/cropper.css'
import { uploadAndConfirm, bindAvatar } from '@/api/storage'
import { avatarSrc } from '@/utils/avatar'

const props = defineProps<{ currentAvatar?: string }>()
const emit = defineEmits<{ avatarChanged: [url: string] }>()

const uploading = ref(false)
const newAvatarUrl = ref('')

// currentAvatar 可能是裸 object_key（users.avatar 存储语义）——归一为代理 URL
const avatarUrl = computed(() => newAvatarUrl.value || avatarSrc(props.currentAvatar))

// ─── 选文件前置：超大拦截 / 动图直传 / 静态图进裁剪 ───
const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024 // 超大原图先拒——避免整个解码进 canvas

let pendingFile: File | null = null
const cropVisible = ref(false)
const cropSrc = ref('')
const cropImgRef = ref<HTMLImageElement>()
let cropper: Cropper | null = null

function fail(e: unknown) {
  ElMessage.error(e instanceof Error ? e.message : '上传失败')
}

async function onFileChange(uploadFile: UploadFile) {
  const file = uploadFile.raw
  if (!file) return
  if (file.size > MAX_ORIGINAL_BYTES) {
    ElMessage.warning('图片超过 20MB，请压缩后再试')
    return
  }
  // 动图：canvas 重绘只留第一帧——保动画优先，原样直传（后端白名单含 gif，10MB 双卡点仍生效）
  if (file.type === 'image/gif') {
    uploading.value = true
    try {
      ElMessage.info('GIF 动图将原样上传（不裁剪）')
      await uploadAvatar(file)
    } catch (e: unknown) {
      fail(e)
    } finally {
      uploading.value = false
    }
    return
  }
  pendingFile = file
  cropSrc.value = URL.createObjectURL(file)
  cropVisible.value = true
}

// 对话框打开后初始化 cropper（等 img 真实加载完——未加载时初始化会量错尺寸）
watch(cropVisible, async (open) => {
  if (!open) return
  await nextTick()
  const img = cropImgRef.value
  if (!img) return
  const init = () => {
    cropper = new Cropper(img, {
      aspectRatio: 1,
      viewMode: 1,
      autoCropArea: 1,
      dragMode: 'move',
      background: false,
    })
  }
  if (img.complete) init()
  else img.addEventListener('load', init, { once: true })
})

function destroyCropper() {
  cropper?.destroy()
  cropper = null
  if (cropSrc.value) {
    URL.revokeObjectURL(cropSrc.value)
    cropSrc.value = ''
  }
  pendingFile = null
}

async function confirmCrop() {
  if (!cropper || !pendingFile) return
  uploading.value = true
  try {
    const canvas = cropper.getCroppedCanvas({ width: 512, height: 512, imageSmoothingQuality: 'high' })
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob) throw new Error('裁剪失败，请重试')
    await uploadAvatar(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }))
    cropVisible.value = false
  } catch (e: unknown) {
    fail(e)
  } finally {
    uploading.value = false
  }
}

/** 上传主体：presign → PUT 直传 → confirm → bind 回写 → 通知父组件 */
async function uploadAvatar(file: File) {
  const result = await uploadAndConfirm(file, 'avatar')
  await bindAvatar({ object_key: result.object_key })
  // 稳定 URL = 代理端点（A.4 #5——cookie 自动带，img 可直接用）
  newAvatarUrl.value = `/api/v1/files/${result.object_key}`
  emit('avatarChanged', newAvatarUrl.value)
  ElMessage.success('头像已更新')
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

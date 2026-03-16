import { Storage } from '@google-cloud/storage'
import { env } from '@/lib/core/config/env'
import { GCS_CONFIG } from '@/lib/uploads/config'
import type { GcsConfig } from '@/lib/uploads/providers/gcs/types'
import type { FileInfo } from '@/lib/uploads/shared/types'
import {
  sanitizeFilenameForMetadata,
  sanitizeStorageMetadata,
} from '@/lib/uploads/utils/file-utils'
import { sanitizeFileName } from '@/executor/constants'

let _gcsClient: Storage | null = null

/**
 * Key prefix for namespacing within a shared bucket (e.g. "sim/").
 * Set via GCS_KEY_PREFIX env var.
 */
const KEY_PREFIX = env.GCS_KEY_PREFIX || ''

function prefixKey(key: string): string {
  if (!KEY_PREFIX) return key
  return `${KEY_PREFIX}${key}`
}

export function getGcsClient(): Storage {
  if (_gcsClient) return _gcsClient

  const credentials = env.GCS_CREDENTIALS_JSON ? JSON.parse(env.GCS_CREDENTIALS_JSON) : undefined

  _gcsClient = new Storage({
    projectId: env.GCS_PROJECT_ID || undefined,
    ...(credentials && { credentials }),
  })

  return _gcsClient
}

export async function uploadToGcs(
  file: Buffer,
  fileName: string,
  contentType: string,
  configOrSize?: GcsConfig | number,
  size?: number,
  skipTimestampPrefix?: boolean,
  metadata?: Record<string, string>
): Promise<FileInfo> {
  let config: GcsConfig
  let fileSize: number

  if (typeof configOrSize === 'object') {
    config = configOrSize
    fileSize = size ?? file.length
  } else {
    config = { bucket: GCS_CONFIG.bucket }
    fileSize = configOrSize ?? file.length
  }

  const safeFileName = sanitizeFileName(fileName)
  const uniqueKey = skipTimestampPrefix ? fileName : `${Date.now()}-${safeFileName}`
  const gcsKey = prefixKey(uniqueKey)

  const storage = getGcsClient()
  const bucket = storage.bucket(config.bucket)
  const blob = bucket.file(gcsKey)

  const gcsMetadata: Record<string, string> = {
    originalName: sanitizeFilenameForMetadata(fileName),
    uploadedAt: new Date().toISOString(),
  }

  if (metadata) {
    Object.assign(gcsMetadata, sanitizeStorageMetadata(metadata, 2000))
  }

  await blob.save(file, {
    contentType,
    metadata: { metadata: gcsMetadata },
  })

  const servePath = `/api/files/serve/${encodeURIComponent(uniqueKey)}`

  return {
    path: servePath,
    key: uniqueKey,
    name: fileName,
    size: fileSize,
    type: contentType,
  }
}

export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  const storage = getGcsClient()
  const bucket = storage.bucket(GCS_CONFIG.bucket)
  const blob = bucket.file(prefixKey(key))

  const [url] = await blob.getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresIn * 1000,
  })

  return url
}

export async function getPresignedUrlWithConfig(
  key: string,
  customConfig: GcsConfig,
  expiresIn = 3600
): Promise<string> {
  const storage = getGcsClient()
  const bucket = storage.bucket(customConfig.bucket)
  const blob = bucket.file(prefixKey(key))

  const [url] = await blob.getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresIn * 1000,
  })

  return url
}

export async function downloadFromGcs(key: string): Promise<Buffer>
export async function downloadFromGcs(key: string, customConfig: GcsConfig): Promise<Buffer>
export async function downloadFromGcs(key: string, customConfig?: GcsConfig): Promise<Buffer> {
  const config = customConfig || { bucket: GCS_CONFIG.bucket }

  const storage = getGcsClient()
  const bucket = storage.bucket(config.bucket)
  const blob = bucket.file(prefixKey(key))

  const [contents] = await blob.download()
  return Buffer.from(contents)
}

export async function deleteFromGcs(key: string): Promise<void>
export async function deleteFromGcs(key: string, customConfig: GcsConfig): Promise<void>
export async function deleteFromGcs(key: string, customConfig?: GcsConfig): Promise<void> {
  const config = customConfig || { bucket: GCS_CONFIG.bucket }

  const storage = getGcsClient()
  const bucket = storage.bucket(config.bucket)
  const blob = bucket.file(prefixKey(key))

  await blob.delete()
}

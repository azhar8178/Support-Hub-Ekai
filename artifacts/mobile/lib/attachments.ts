import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export interface PendingAttachment {
  key: string;
  filename: string;
  contentType: string;
  /** Raw base64 (no data: prefix) */
  data: string;
  sizeBytes: number;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function attachmentIcon(contentType: string): 'image' | 'film' | 'file-text' | 'file' {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'film';
  if (
    contentType.startsWith('text/') ||
    contentType === 'application/pdf' ||
    contentType === 'application/json'
  ) {
    return 'file-text';
  }
  return 'file';
}

function base64SizeBytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4);
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

async function readUriAsBase64(uri: string): Promise<string> {
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    const blob = await res.blob();
    return blobToBase64(blob);
  }
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

export class AttachmentTooLargeError extends Error {
  constructor() {
    super(`Files must be smaller than ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
    this.name = 'AttachmentTooLargeError';
  }
}

function ensureSize(sizeBytes: number) {
  if (sizeBytes > MAX_ATTACHMENT_BYTES) throw new AttachmentTooLargeError();
}

let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `pending-${keyCounter}`;
}

/** Opens the photo library; resolves null if the user cancels. */
export async function pickPhoto(): Promise<PendingAttachment | null> {
  if (Platform.OS !== 'web') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      throw new Error('Photo library access is needed to attach a photo.');
    }
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.8,
    base64: true,
  });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  const data = asset.base64 ?? (await readUriAsBase64(asset.uri));
  const sizeBytes = base64SizeBytes(data);
  ensureSize(sizeBytes);
  const contentType = asset.mimeType ?? 'image/jpeg';
  const ext = contentType.split('/')[1] ?? 'jpg';
  return {
    key: nextKey(),
    filename: asset.fileName ?? `photo-${Date.now()}.${ext}`,
    contentType,
    data,
    sizeBytes,
  };
}

/** Opens the document picker; resolves null if the user cancels. */
export async function pickDocument(): Promise<PendingAttachment | null> {
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  if (asset.size != null) ensureSize(asset.size);
  const data = await readUriAsBase64(asset.uri);
  const sizeBytes = asset.size ?? base64SizeBytes(data);
  ensureSize(sizeBytes);
  return {
    key: nextKey(),
    filename: asset.name || `file-${Date.now()}`,
    contentType: asset.mimeType ?? 'application/octet-stream',
    data,
    sizeBytes,
  };
}

/** Sanitize a filename for use in a cache path. */
function safeName(filename: string): string {
  return filename.replace(/[^\w.\-]+/g, '_') || 'attachment';
}

/**
 * Opens downloaded attachment content: triggers a browser download on web,
 * writes to cache and opens the share sheet on native.
 */
export async function openAttachmentContent(content: {
  filename: string;
  contentType: string;
  data: string;
}): Promise<void> {
  if (Platform.OS === 'web') {
    const binary = atob(content.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: content.contentType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = content.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }

  const fileUri = `${FileSystem.cacheDirectory}${safeName(content.filename)}`;
  await FileSystem.writeAsStringAsync(fileUri, content.data, {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, {
      mimeType: content.contentType,
      dialogTitle: content.filename,
    });
  } else {
    throw new Error('Opening files is not supported on this device.');
  }
}

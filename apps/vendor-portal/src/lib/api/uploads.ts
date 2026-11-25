import { fetchJson } from "../api"
import { toApiError } from "../errors"

export type ImageItem = { upload_id: string; url: string }

export const MAX_IMAGES = 10
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"]

// The server decides by the file's own bytes and size. These checks only save
// a round trip, so a file that passes here can still be refused.
export const checkImageFile = (file: File): string | null => {
  if (!IMAGE_TYPES.includes(file.type)) {
    return "Only JPEG, PNG and WebP images are accepted."
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "This image is larger than 8 MB. Choose a smaller file."
  }
  return null
}

const MESSAGES: Record<string, string> = {
  file_required: "Choose an image to upload.",
  file_too_large: "This image is larger than 8 MB. Choose a smaller file.",
  unexpected_field: "The upload was not understood. Try again.",
  unsupported_type: "Only JPEG, PNG and WebP images are accepted.",
  animated_image: "Animated images are not accepted. Use a still image.",
  image_pixels_exceeded: "This image has too many pixels. Resize it and try again.",
  corrupt_image: "This file could not be read as an image.",
  too_many_pending_uploads:
    "You have too many uploaded images that are not used in a product yet. Use them first or contact the store team.",
}

export const uploadErrorText = (error: unknown): string => {
  const failure = toApiError(error)
  return (failure.code && MESSAGES[failure.code]) || failure.message
}

/**
 * Uploads one file in one request. The request goes through the portal's own
 * request function, which refuses any path outside the vendor API. Progress is
 * reported as 0 before and 1 after, because the browser's request function does
 * not report bytes sent.
 */
export const uploadImage = async (file: File, onProgress?: (fraction: number) => void): Promise<ImageItem> => {
  const form = new FormData()
  form.append("file", file)
  onProgress?.(0)
  const result = await fetchJson<{ upload: { id: string; url: string } }>("/vendor/uploads", {
    method: "POST",
    form,
  })
  onProgress?.(1)
  return { upload_id: result.upload.id, url: result.upload.url }
}

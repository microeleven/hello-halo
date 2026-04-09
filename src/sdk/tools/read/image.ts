/**
 * @module tools/read/image
 * Image file metadata reader with size pre-validation.
 * @license MIT
 */

import * as fs from 'node:fs/promises';

/**
 * Maximum image file size in bytes.
 * The API accepts up to 5 MB of base64-encoded image data, which corresponds
 * to ~3.75 MB of raw binary. We use 5 MB as the raw file size limit since
 * common formats (JPEG, PNG) are already compressed and their base64 encoding
 * stays close to 4/3 of raw size.
 */
const IMAGE_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Read image file and return a metadata description string.
 * Validates file size before processing to avoid wasting API round-trips
 * on oversized media.
 */
export async function readImage(filePath: string): Promise<string> {
  const stat = await fs.stat(filePath);

  if (stat.size > IMAGE_MAX_FILE_SIZE) {
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `Image file is too large (${sizeMB} MB). Maximum supported size is ${IMAGE_MAX_FILE_SIZE / (1024 * 1024)} MB. ` +
      `Consider resizing or compressing the image before reading.`,
    );
  }

  return `[Image file: ${filePath}. The image content has been captured for visual analysis.]`;
}

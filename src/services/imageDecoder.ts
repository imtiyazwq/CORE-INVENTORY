import jpeg from 'jpeg-js';

export interface DecodedImageResult {
  width: number;
  height: number;
  dataUrl: string;
  canvas: HTMLCanvasElement;
  rawBytes: Uint8Array;
  decoderUsed: 'native-browser' | 'jpeg-fallback-transcoder';
  originalFileName: string;
  fileSizeBytes: number;
  mimeType: string;
  fileInfo: {
    name: string;
    size: number;
    type: string;
  };
  technicalDetails?: string;
}

/**
 * Checks if raw binary bytes contain standard JPEG SOI marker (0xFF, 0xD8)
 */
export function isJpegBinary(bytes: Uint8Array): boolean {
  if (bytes.length < 2) return false;
  return bytes[0] === 0xff && bytes[1] === 0xd8;
}

/**
 * Robust image decoding pipeline.
 * Reads raw binary data from File/Blob.
 * 1. Attempts standard browser decoding via createImageBitmap / HTMLImageElement.
 * 2. If unsupported or fails, checks JPEG header (FF D8) and applies pure JS JPEG fallback decoder.
 * 3. Returns a high-fidelity representation with Canvas, dataUrl, and dimensions.
 */
export async function decodeImageFile(file: File): Promise<DecodedImageResult> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const fileSizeBytes = bytes.byteLength;
  const fileName = file.name;
  const mimeType = file.type || 'application/octet-stream';

  let standardDecodeError: Error | null = null;

  // Step 1: Attempt standard native browser decoding
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType || 'image/jpeg' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not obtain 2D canvas context');
    
    ctx.drawImage(bitmap, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    
    return {
      width: bitmap.width,
      height: bitmap.height,
      dataUrl,
      canvas,
      rawBytes: bytes,
      decoderUsed: 'native-browser',
      originalFileName: fileName,
      fileSizeBytes,
      mimeType,
      fileInfo: {
        name: fileName,
        size: fileSizeBytes,
        type: mimeType,
      },
      technicalDetails: `Native decode successful: ${bitmap.width}x${bitmap.height}px`,
    };
  } catch (err: any) {
    standardDecodeError = err;
    console.warn('Native browser decode failed, checking fallback decoder...', err);
  }

  // Also try HTMLImageElement load via blob URL as second native attempt
  try {
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType || 'image/jpeg' }));
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = blobUrl;
    });

    if (loaded && img.naturalWidth > 0 && img.naturalHeight > 0) {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        URL.revokeObjectURL(blobUrl);
        return {
          width: img.naturalWidth,
          height: img.naturalHeight,
          dataUrl,
          canvas,
          rawBytes: bytes,
          decoderUsed: 'native-browser',
          originalFileName: fileName,
          fileSizeBytes,
          mimeType,
          fileInfo: {
            name: fileName,
            size: fileSizeBytes,
            type: mimeType,
          },
          technicalDetails: `HTMLImageElement fallback succeeded: ${img.naturalWidth}x${img.naturalHeight}px`,
        };
      }
    }
    URL.revokeObjectURL(blobUrl);
  } catch (imgErr) {
    console.warn('HTMLImageElement attempt failed:', imgErr);
  }

  // Step 2: Fallback decoder for unsupported JPEG encodings
  const hasJpegHeader = isJpegBinary(bytes);

  if (hasJpegHeader || fileName.toLowerCase().endsWith('.jpg') || fileName.toLowerCase().endsWith('.jpeg')) {
    try {
      console.info('Invoking raw binary JPEG fallback decoder (jpeg-js)...');
      const rawDecoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });

      if (!rawDecoded || !rawDecoded.width || !rawDecoded.height || !rawDecoded.data) {
        throw new Error('Fallback JPEG decoder yielded empty buffer');
      }

      const canvas = document.createElement('canvas');
      canvas.width = rawDecoded.width;
      canvas.height = rawDecoded.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Could not obtain canvas context for transcoded JPEG');

      const imgData = ctx.createImageData(rawDecoded.width, rawDecoded.height);
      imgData.data.set(rawDecoded.data);
      ctx.putImageData(imgData, 0, 0);

      const dataUrl = canvas.toDataURL('image/png');

      return {
        width: rawDecoded.width,
        height: rawDecoded.height,
        dataUrl,
        canvas,
        rawBytes: bytes,
        decoderUsed: 'jpeg-fallback-transcoder',
        originalFileName: fileName,
        fileSizeBytes,
        mimeType: 'image/jpeg',
        fileInfo: {
          name: fileName,
          size: fileSizeBytes,
          type: mimeType,
        },
        technicalDetails: `Binary JPEG fallback decoder recovered ${rawDecoded.width}x${rawDecoded.height}px image (SOI header 0xFFD8 validated)`,
      };
    } catch (fallbackErr: any) {
      console.error('JPEG fallback decoding failed:', fallbackErr);
      throw new Error(
        `Unable to decode this image: Browser native decoder failed (${standardDecodeError?.message || 'Unsupported format'}), and raw JPEG binary decoder failed: ${fallbackErr?.message || 'Corrupted or non-standard encoding'}.`
      );
    }
  }

  throw new Error(
    `Unable to decode this image: Native decoding failed and file does not have valid JPEG header (SOI marker FF D8). Please verify the file format.`
  );
}

/**
 * Prepares a normalized Float32 NCHW [1, 3, targetSize, targetSize] tensor buffer
 * from a source canvas or video element without distorting original image display.
 */
export function preprocessToTensor(
  source: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement,
  targetSize = 640
): { tensor: Float32Array; shape: [number, number, number, number] } {
  const workCanvas = document.createElement('canvas');
  workCanvas.width = targetSize;
  workCanvas.height = targetSize;
  const ctx = workCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Failed to create preprocessing context');

  // Fill with neutral letterbox background (black/gray 0.5)
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, targetSize, targetSize);

  // Compute aspect ratio letterboxing
  const srcWidth = 'videoWidth' in source ? source.videoWidth : source.width;
  const srcHeight = 'videoHeight' in source ? source.videoHeight : source.height;

  const scale = Math.min(targetSize / srcWidth, targetSize / srcHeight);
  const scaledWidth = srcWidth * scale;
  const scaledHeight = srcHeight * scale;
  const dx = (targetSize - scaledWidth) / 2;
  const dy = (targetSize - scaledHeight) / 2;

  ctx.drawImage(source, 0, 0, srcWidth, srcHeight, dx, dy, scaledWidth, scaledHeight);

  const imgData = ctx.getImageData(0, 0, targetSize, targetSize);
  const rgba = imgData.data;

  // NCHW format: [1, 3, H, W] -> R plane first, then G, then B
  const numPixels = targetSize * targetSize;
  const tensor = new Float32Array(3 * numPixels);

  for (let i = 0; i < numPixels; i++) {
    const r = rgba[i * 4] / 255.0;
    const g = rgba[i * 4 + 1] / 255.0;
    const b = rgba[i * 4 + 2] / 255.0;

    tensor[i] = r; // Red channel
    tensor[numPixels + i] = g; // Green channel
    tensor[2 * numPixels + i] = b; // Blue channel
  }

  return { tensor, shape: [1, 3, targetSize, targetSize] };
}

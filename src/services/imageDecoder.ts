import * as jpeg from 'jpeg-js';

export interface DecodedImageResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  dataUrl: string;
  sourceType: 'native' | 'jpeg-fallback';
  fileInfo: {
    name: string;
    sizeBytes: number;
    mimeType: string;
    detectedHeader: string;
  };
}

/**
 * Inspect raw binary header bytes to detect file signature
 */
export function inspectBinaryHeader(bytes: Uint8Array): {
  isJPEG: boolean;
  isPNG: boolean;
  isWebP: boolean;
  headerHex: string;
} {
  const headerHex = Array.from(bytes.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');

  // JPEG begins with SOI marker: FF D8
  const isJPEG = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;

  // PNG begins with 89 50 4E 47 0D 0A 1A 0A
  const isPNG =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;

  // WebP begins with RIFF....WEBP (52 49 46 46 .... 57 45 42 50)
  const isWebP =
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;

  return { isJPEG, isPNG, isWebP, headerHex };
}

/**
 * Robust image decoding pipeline.
 * 1. Reads raw binary data from File/Blob.
 * 2. Verifies actual binary header (SOI FF D8, etc.).
 * 3. Attempts standard browser decoding via ImageBitmap/HTMLImageElement.
 * 4. If unsupported or error occurs, falls back to raw JPEG byte transcoding via jpeg-js.
 * 5. Yields a Canvas and DataURL ready for high-fidelity object-contain display and YOLO preprocessing.
 */
export async function decodeImageFile(file: File): Promise<DecodedImageResult> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const { isJPEG, headerHex } = inspectBinaryHeader(bytes);

  const fileInfo = {
    name: file.name,
    sizeBytes: file.size,
    mimeType: file.type || (isJPEG ? 'image/jpeg' : 'application/octet-stream'),
    detectedHeader: headerHex,
  };

  let nativeError: Error | null = null;

  // Stage 1: Try native browser decoding first
  try {
    const canvas = await tryNativeDecode(bytes, file.type || 'image/jpeg');
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    return {
      canvas,
      width: canvas.width,
      height: canvas.height,
      dataUrl,
      sourceType: 'native',
      fileInfo,
    };
  } catch (err) {
    nativeError = err instanceof Error ? err : new Error(String(err));
    console.warn('[ImageDecoder] Native browser decoding failed, attempting fallback decoder:', nativeError.message);
  }

  // Stage 2: Fallback to pure byte-level JPEG decoder (handles non-standard SOF markers, unusual subsampling, etc.)
  if (isJPEG || file.name.toLowerCase().endsWith('.jpg') || file.name.toLowerCase().endsWith('.jpeg')) {
    try {
      const canvas = decodeWithJpegJs(bytes);
      const dataUrl = canvas.toDataURL('image/png');
      return {
        canvas,
        width: canvas.width,
        height: canvas.height,
        dataUrl,
        sourceType: 'jpeg-fallback',
        fileInfo,
      };
    } catch (fallbackErr) {
      const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      console.error('[ImageDecoder] Fallback JPEG decoder also failed:', fallbackMsg);
      throw new Error(
        `Unable to decode this image. Native error: ${nativeError?.message || 'Unsupported format'}. Fallback error: ${fallbackMsg}. Header: [${headerHex}]`
      );
    }
  }

  throw new Error(
    `Unable to decode this image. The file format is unsupported by standard browser decoders. Header: [${headerHex}]`
  );
}

/**
 * Standard native browser decoding via Blob and HTMLImageElement
 */
function tryNativeDecode(bytes: Uint8Array, mimeType: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([bytes], { type: mimeType });
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      if (img.naturalWidth === 0 || img.naturalHeight === 0) {
        reject(new Error('Image loaded with zero dimensions'));
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not obtain 2D canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(canvas);
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Native HTMLImageElement failed to decode file'));
    };

    img.src = objectUrl;
  });
}

/**
 * Pure byte decoder for JPEGs using jpeg-js
 * Decodes raw binary bytes to RGBA array then paints onto Canvas
 */
function decodeWithJpegJs(bytes: Uint8Array): HTMLCanvasElement {
  // Ensure the decoder receives the raw byte array
  const rawData = jpeg.decode(bytes, {
    useTArray: true,
    formatAsRGBA: true,
    maxMemoryUsageInMB: 1024,
  });

  if (!rawData || !rawData.data || rawData.width <= 0 || rawData.height <= 0) {
    throw new Error('Fallback decoder returned invalid pixel buffer');
  }

  const canvas = document.createElement('canvas');
  canvas.width = rawData.width;
  canvas.height = rawData.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  const imageData = ctx.createImageData(rawData.width, rawData.height);
  // Copy RGBA pixels into canvas image buffer
  imageData.data.set(rawData.data);
  ctx.putImageData(imageData, 0, 0);

  return canvas;
}

/**
 * Preprocesses any canvas or image source for YOLO inference:
 * Resizes letterboxed or stretched to target resolution (default 640x640),
 * keeping aspect ratio if letterboxed, or standard stretch.
 * Returns { tensorCanvas, scale, padX, padY }
 */
export function preprocessCanvasForYOLO(
  sourceCanvas: HTMLCanvasElement,
  targetSize: number = 640
): {
  yoloCanvas: HTMLCanvasElement;
  scaleX: number;
  scaleY: number;
  ctx: CanvasRenderingContext2D;
} {
  const yoloCanvas = document.createElement('canvas');
  yoloCanvas.width = targetSize;
  yoloCanvas.height = targetSize;
  const ctx = yoloCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Failed to get yolo canvas context');
  }

  // Draw scaled onto 640x640
  ctx.drawImage(sourceCanvas, 0, 0, targetSize, targetSize);

  return {
    yoloCanvas,
    scaleX: sourceCanvas.width / targetSize,
    scaleY: sourceCanvas.height / targetSize,
    ctx,
  };
}

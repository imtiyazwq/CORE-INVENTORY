export interface LetterboxInfo {
  ratio: number;
  padX: number;
  padY: number;
  inputWidth: number;
  inputHeight: number;
  originalWidth: number;
  originalHeight: number;
}

export interface PreprocessedTensorResult {
  tensor: Float32Array;
  shape: [number, number, number, number];
  layout: 'NCHW';
  letterbox: LetterboxInfo;
  preprocessTimeMs: number;
}

/**
 * Preprocess an image or video frame strictly adhering to:
 * Input Shape: [1, 3, 640, 640]
 * Format: Float32, NCHW layout
 * [R channel: 640 x 640]
 * [G channel: 640 x 640]
 * [B channel: 640 x 640]
 * Normalization: [0.0, 1.0]
 */
export function preprocessImageToNCHW(
  source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement | ImageBitmap,
  targetSize: number = 640
): PreprocessedTensorResult {
  const startTime = performance.now();

  let origWidth = 640;
  let origHeight = 480;

  if (source instanceof HTMLVideoElement) {
    origWidth = source.videoWidth || 640;
    origHeight = source.videoHeight || 480;
  } else if (source instanceof HTMLImageElement) {
    origWidth = source.naturalWidth || source.width || 640;
    origHeight = source.naturalHeight || source.height || 480;
  } else if (source instanceof HTMLCanvasElement) {
    origWidth = source.width || 640;
    origHeight = source.height || 480;
  } else if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
    origWidth = source.width || 640;
    origHeight = source.height || 480;
  }

  // Calculate letterboxing parameters to preserve exact aspect ratio without distortion
  const ratio = Math.min(targetSize / origWidth, targetSize / origHeight);
  const scaledW = Math.max(1, Math.round(origWidth * ratio));
  const scaledH = Math.max(1, Math.round(origHeight * ratio));
  const padX = Math.round((targetSize - scaledW) / 2);
  const padY = Math.round((targetSize - scaledH) / 2);

  // Render to 640x640 offscreen canvas
  const offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = targetSize;
  offscreenCanvas.height = targetSize;
  const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable for image preprocessing.');
  }

  // YOLO standard neutral gray padding (114 / 255 = ~0.447)
  ctx.fillStyle = '#727272';
  ctx.fillRect(0, 0, targetSize, targetSize);
  ctx.drawImage(source, padX, padY, scaledW, scaledH);

  // Extract RGBA pixel data
  const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
  const pixels = imageData.data;

  // Planar NCHW layout: [1, 3, 640, 640]
  // Plane size = 640 * 640 = 409,600
  // Total elements = 3 * 409,600 = 1,228,800
  const planeSize = targetSize * targetSize;
  const tensor = new Float32Array(3 * planeSize);

  for (let i = 0; i < planeSize; i++) {
    const px = i * 4;
    tensor[i] = pixels[px] / 255.0;                         // R channel (0 to planeSize-1)
    tensor[planeSize + i] = pixels[px + 1] / 255.0;         // G channel (planeSize to 2*planeSize-1)
    tensor[2 * planeSize + i] = pixels[px + 2] / 255.0;     // B channel (2*planeSize to 3*planeSize-1)
  }

  const preprocessTimeMs = performance.now() - startTime;

  return {
    tensor,
    shape: [1, 3, targetSize, targetSize],
    layout: 'NCHW',
    letterbox: {
      ratio,
      padX,
      padY,
      inputWidth: targetSize,
      inputHeight: targetSize,
      originalWidth: origWidth,
      originalHeight: origHeight,
    },
    preprocessTimeMs,
  };
}

import { MODEL_CONFIG, YOLO_CLASSES } from './yoloConfig';
import { LetterboxInfo } from './imagePreprocessor';
import { DetectedObject } from '../types';

export interface DecodedCandidate {
  x: number;          // Normalized to [0, 1] of original image
  y: number;          // Normalized to [0, 1] of original image
  width: number;      // Normalized to [0, 1] of original image
  height: number;     // Normalized to [0, 1] of original image
  confidence: number;
  classIndex: number;
  className: string;
}

/**
 * Decodes the feature-major [1, 19, 8400] Float32 YOLO tensor:
 * - 4 box coordinates: cx, cy, w, h
 * - 15 class scores: indices 4 through 18
 * - 8400 predictions/anchors
 */
export function decodeYOLOOutput(
  outputTensor: Float32Array,
  letterbox: LetterboxInfo,
  confidenceThreshold: number = MODEL_CONFIG.defaultConfidenceThreshold,
  outputShape?: [number, number, number]
): DecodedCandidate[] {
  const numPredictions = MODEL_CONFIG.numPredictions; // 8400
  const numClasses = MODEL_CONFIG.numClasses;         // 15
  const numFeatures = 4 + numClasses;                 // 19
  const candidates: DecodedCandidate[] = [];

  // Check if output tensor is prediction-major [1, 8400, 19] or feature-major [1, 19, 8400]
  const isPredictionMajor = Boolean(
    outputShape && outputShape[1] === numPredictions && outputShape[2] === numFeatures
  );

  const { ratio, padX, padY, originalWidth, originalHeight } = letterbox;

  for (let a = 0; a < numPredictions; a++) {
    const cx640 = isPredictionMajor
      ? outputTensor[a * numFeatures + 0]
      : outputTensor[0 * numPredictions + a];
    const cy640 = isPredictionMajor
      ? outputTensor[a * numFeatures + 1]
      : outputTensor[1 * numPredictions + a];
    const w640 = isPredictionMajor
      ? outputTensor[a * numFeatures + 2]
      : outputTensor[2 * numPredictions + a];
    const h640 = isPredictionMajor
      ? outputTensor[a * numFeatures + 3]
      : outputTensor[3 * numPredictions + a];

    // Find best class among 15 classes (features 4 to 18)
    let maxScore = -Infinity;
    let bestClassIdx = 0;

    for (let c = 0; c < numClasses; c++) {
      let score = isPredictionMajor
        ? outputTensor[a * numFeatures + 4 + c]
        : outputTensor[(4 + c) * numPredictions + a];
      // Apply sigmoid if output values are unnormalized logits
      if (score > 1.0 || score < 0.0) {
        score = 1 / (1 + Math.exp(-score));
      }
      if (score > maxScore) {
        maxScore = score;
        bestClassIdx = c;
      }
    }

    if (maxScore < confidenceThreshold) {
      continue;
    }

    // Box dimensions in 640x640 space
    // Check if cx, cy, w, h are normalized [0..1] or pixel [0..640]
    let cx = cx640;
    let cy = cy640;
    let w = w640;
    let h = h640;

    if (cx <= 1.0 && cy <= 1.0 && w <= 1.0 && h <= 1.0) {
      cx *= 640;
      cy *= 640;
      w *= 640;
      h *= 640;
    }

    // Reject degenerate bounding boxes
    if (w < 4 || h < 4 || isNaN(w) || isNaN(h) || isNaN(cx) || isNaN(cy)) {
      continue;
    }

    const x1_640 = cx - w / 2;
    const y1_640 = cy - h / 2;
    const x2_640 = cx + w / 2;
    const y2_640 = cy + h / 2;

    // Un-letterbox: remove padding and invert scaling ratio to map to original image
    const origX1 = (x1_640 - padX) / ratio;
    const origY1 = (y1_640 - padY) / ratio;
    const origX2 = (x2_640 - padX) / ratio;
    const origY2 = (y2_640 - padY) / ratio;

    // Normalize coordinates strictly to [0, 1] relative to original image dimensions
    const normX1 = Math.max(0, Math.min(1, origX1 / originalWidth));
    const normY1 = Math.max(0, Math.min(1, origY1 / originalHeight));
    const normX2 = Math.max(0, Math.min(1, origX2 / originalWidth));
    const normY2 = Math.max(0, Math.min(1, origY2 / originalHeight));

    const normW = Math.max(0, Math.min(1 - normX1, normX2 - normX1));
    const normH = Math.max(0, Math.min(1 - normY1, normY2 - normY1));

    if (normW < 0.01 || normH < 0.01) {
      continue;
    }

    // Exact class mapping: Index 0 to 14
    const className = YOLO_CLASSES[bestClassIdx] || `Class_${bestClassIdx}`;

    candidates.push({
      x: normX1,
      y: normY1,
      width: normW,
      height: normH,
      confidence: Math.round(maxScore * 1000) / 1000,
      classIndex: bestClassIdx,
      className,
    });
  }

  return candidates;
}

import { DecodedCandidate } from './yoloDecoder';
import { DetectedObject } from '../types';

export interface DetectionSummaryItem {
  className: string;
  count: number;
  averageConfidence: number;
}

/**
 * Calculates Intersection over Union (IoU) of two bounding boxes in normalized coordinates [0..1].
 */
export function calculateIoU(a: DecodedCandidate, b: DecodedCandidate): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);

  const intersectionW = Math.max(0, x2 - x1);
  const intersectionH = Math.max(0, y2 - y1);
  const intersectionArea = intersectionW * intersectionH;

  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const unionArea = areaA + areaB - intersectionArea;

  if (unionArea <= 0) return 0;
  return intersectionArea / unionArea;
}

/**
 * Class-Aware Non-Maximum Suppression (NMS)
 * Filters overlapping duplicate bounding boxes per class.
 */
export function applyClassAwareNMS(
  candidates: DecodedCandidate[],
  nmsThreshold: number = 0.45,
  maxDetections: number = 100
): DetectedObject[] {
  if (candidates.length === 0) return [];

  // Group candidates by class index to ensure cross-class objects are not suppressed
  const classGroups = new Map<number, DecodedCandidate[]>();
  for (const c of candidates) {
    const list = classGroups.get(c.classIndex) || [];
    list.push(c);
    classGroups.set(c.classIndex, list);
  }

  const suppressed: DecodedCandidate[] = [];

  for (const [, group] of classGroups.entries()) {
    // Sort descending by confidence score
    group.sort((a, b) => b.confidence - a.confidence);

    const active: DecodedCandidate[] = [...group];
    while (active.length > 0 && suppressed.length < maxDetections) {
      const best = active.shift()!;
      suppressed.push(best);

      // Remove overlapping candidates with IoU >= nmsThreshold
      for (let i = active.length - 1; i >= 0; i--) {
        const iou = calculateIoU(best, active[i]);
        if (iou >= nmsThreshold) {
          active.splice(i, 1);
        }
      }
    }
  }

  // Format into final DetectedObject output format
  return suppressed.map((d, idx) => ({
    id: `det-${d.className}-${idx}-${Date.now().toString(36)}`,
    classIndex: d.classIndex,
    className: d.className,
    confidence: d.confidence,
    bbox: {
      x: d.x,
      y: d.y,
      width: d.width,
      height: d.height,
    },
  }));
}

/**
 * Summarize detected objects into item counts and average confidence.
 */
export function summarizeDetections(objects: DetectedObject[]): DetectionSummaryItem[] {
  const map = new Map<string, { count: number; totalConf: number }>();

  for (const obj of objects) {
    const entry = map.get(obj.className) || { count: 0, totalConf: 0 };
    entry.count += 1;
    entry.totalConf += obj.confidence;
    map.set(obj.className, entry);
  }

  return Array.from(map.entries()).map(([className, stat]) => ({
    className,
    count: stat.count,
    averageConfidence: Math.round((stat.totalConf / stat.count) * 100) / 100,
  }));
}

import { YOLO_DEFINITION_BY_LABEL } from './yoloConfig';

export interface MappedYOLOItem {
  className: string;
  displayName: string;
  inventoryName: string;
  category: string;
  quantity: number;
  confidence: number;
}

const normalizeLabel = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '_');

/**
 * Convert a raw YOLO class into an inventory item.
 *
 * Settings now acts as the allow-list: if a configured label list is provided,
 * only labels that are currently present in Settings are accepted. There is no
 * separate "YOLO Enabled" switch anymore.
 */
export function mapYOLODetection(
  className: string,
  detectedCount: number,
  confidence: number,
  configuredLabels?: Array<{ label: string }>
): MappedYOLOItem | null {
  const definition = YOLO_DEFINITION_BY_LABEL[className];
  if (!definition) return null;

  if (configuredLabels) {
    const configured = configuredLabels.some(
      (item) => normalizeLabel(item.label) === normalizeLabel(className)
    );
    if (!configured) return null;
  }

  return {
    className: definition.label,
    displayName: definition.displayName,
    inventoryName: definition.inventoryName,
    category: definition.category,
    quantity: detectedCount * definition.quantityPerDetection,
    confidence,
  };
}

export function mergeMappedYOLOItems(items: MappedYOLOItem[]): MappedYOLOItem[] {
  const merged = new Map<string, MappedYOLOItem>();

  for (const item of items) {
    const key = `${item.inventoryName.toLowerCase()}|${item.category.toLowerCase()}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...item });
    } else {
      existing.quantity += item.quantity;
      existing.confidence = Math.max(existing.confidence, item.confidence);
    }
  }

  return [...merged.values()];
}

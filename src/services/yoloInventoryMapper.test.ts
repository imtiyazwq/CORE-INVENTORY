import { describe, expect, it } from 'vitest';
import { mapYOLODetection, mergeMappedYOLOItems } from './yoloInventoryMapper';

describe('mapYOLODetection', () => {
  it('returns null for a class with no catalogue definition', () => {
    expect(mapYOLODetection('not_a_real_class', 1, 0.9)).toBeNull();
  });

  it('maps a 1:1 detection to a single inventory unit', () => {
    const result = mapYOLODetection('Arduino_Uno', 3, 0.87);
    expect(result).toMatchObject({ inventoryName: 'Arduino Uno', quantity: 3, confidence: 0.87 });
  });

  it('multiplies by quantityPerDetection for bundle classes', () => {
    // bag_arduino_20 represents a bag of 20 Arduino Unos per detected bag.
    const result = mapYOLODetection('bag_arduino_20', 2, 0.9);
    expect(result).toMatchObject({ inventoryName: 'Arduino Uno', quantity: 40 });
  });

  it('rejects a class not present in the configured/enabled label list', () => {
    const result = mapYOLODetection('Arduino_Uno', 1, 0.9, [{ label: 'pen' }]);
    expect(result).toBeNull();
  });

  it('accepts a class present in the configured label list regardless of case/spacing', () => {
    const result = mapYOLODetection('Arduino_Uno', 1, 0.9, [{ label: 'arduino uno' }]);
    expect(result).not.toBeNull();
  });
});

describe('mergeMappedYOLOItems', () => {
  it('sums quantities for classes that map to the same inventory item', () => {
    // cup_rim and full_cup are two different YOLO classes that both represent "Paper cup".
    const cupRim = mapYOLODetection('cup_rim', 2, 0.8)!;
    const fullCup = mapYOLODetection('full_cup', 3, 0.6)!;

    const merged = mergeMappedYOLOItems([cupRim, fullCup]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ inventoryName: 'Paper cup', quantity: 5, confidence: 0.8 });
  });

  it('keeps distinct inventory items separate', () => {
    const pen = mapYOLODetection('pen', 1, 0.9)!;
    const scissors = mapYOLODetection('scissors', 1, 0.9)!;

    const merged = mergeMappedYOLOItems([pen, scissors]);

    expect(merged.map((item) => item.inventoryName).sort()).toEqual(['Pen', 'Scissor']);
  });

  it('returns an empty array for an empty input', () => {
    expect(mergeMappedYOLOItems([])).toEqual([]);
  });
});

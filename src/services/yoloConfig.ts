export interface YOLOModelConfig {
  inputName: string;
  inputShape: [number, number, number, number];
  inputType: string;
  inputLayout: 'NCHW' | 'NHWC';
  outputName: string;
  outputShape: [number, number, number];
  outputType: string;
  imageSize: number;
  numClasses: number;
  numPredictions: number;
  defaultConfidenceThreshold: number;
  defaultNmsThreshold: number;
  modelPath: string;
}

export const MODEL_CONFIG: YOLOModelConfig = {
  inputName: 'serving_default_args_0',
  inputShape: [1, 3, 640, 640],
  inputType: 'float32',
  inputLayout: 'NCHW',
  outputName: 'serving_default_output_0_output',
  outputShape: [1, 19, 8400],
  outputType: 'float32',
  imageSize: 640,
  numClasses: 15,
  numPredictions: 8400,
  defaultConfidenceThreshold: 0.45,
  defaultNmsThreshold: 0.45,
  modelPath: '/models/inventory_yolo.tflite',
};

// IMPORTANT: this order must match the class order used when the TFLite model was trained.
export const YOLO_CLASSES: string[] = [
  'Arduino_Uno',
  'a4_colored_paper',
  'bag_arduino_20',
  'bag_arduino_30',
  'box_sticky_note',
  'breadboard',
  'bundle_arduino',
  'cup_rim',
  'full_cup',
  'goggles',
  'nodemcu_esp32',
  'pen',
  'scissors',
  'sticky_note_paper',
  'tongue_depressor',
];

export const YOLO_CLASS_CATEGORIES: Record<string, string> = {
  Arduino_Uno: 'Electronics & Robotics',
  a4_colored_paper: 'Craft Materials & STEM Kits',
  bag_arduino_20: 'Electronics & Robotics',
  bag_arduino_30: 'Electronics & Robotics',
  box_sticky_note: 'Stationery & Office Supplies',
  breadboard: 'Electronics & Robotics',
  bundle_arduino: 'Electronics & Robotics',
  cup_rim: 'Craft Materials & STEM Kits',
  full_cup: 'Craft Materials & STEM Kits',
  goggles: 'Laboratory & Science Supplies',
  nodemcu_esp32: 'Electronics & Robotics',
  pen: 'Stationery & Office Supplies',
  scissors: 'Tools & Equipment',
  sticky_note_paper: 'Stationery & Office Supplies',
  tongue_depressor: 'Craft Materials & STEM Kits',
};

export interface YOLOClassDefinition {
  label: string;
  displayName: string;
  inventoryName: string;
  category: string;
  quantityPerDetection: number;
  enabledByDefault: boolean;
}

export const YOLO_CLASS_DEFINITIONS: YOLOClassDefinition[] = [
  { label: 'a4_colored_paper', displayName: 'A4 colored paper', inventoryName: 'A4 colored paper', category: 'Craft Materials & STEM Kits', quantityPerDetection: 1, enabledByDefault: true },
  { label: 'Arduino_Uno', displayName: 'Arduino Uno', inventoryName: 'Arduino Uno', category: 'Electronics & Robotics', quantityPerDetection: 1, enabledByDefault: true },
  { label: 'bag_arduino_20', displayName: 'Arduino Uno', inventoryName: 'Arduino Uno', category: 'Electronics & Robotics', quantityPerDetection: 20, enabledByDefault: true },
  { label: 'bag_arduino_30', displayName: 'Arduino Uno', inventoryName: 'Arduino Uno', category: 'Electronics & Robotics', quantityPerDetection: 30, enabledByDefault: true },
  { label: 'box_sticky_note', displayName: 'Sticky note', inventoryName: 'Sticky note', category: 'Stationery & Office Supplies', quantityPerDetection: 1, enabledByDefault: true },
  { label: 'breadboard', displayName: 'Breadboard', inventoryName: 'Breadboard', category: 'Electronics & Robotics', quantityPerDetection: 1, enabledByDefault: true },
  { label: 'bundle_arduino', displayName: 'Arduino Uno', inventoryName: 'Arduino Uno', category: 'Electronics & Robotics', quantityPerDetection: 40, enabledByDefault: true },
  { label: 'cup_rim', displayName: 'Paper cup', inventoryName: 'Paper cup', category: 'Craft Materials & STEM Kits', quantityPerDetection: 1, enabledByDefault: true },
  { label: 'full_cup', displayName: 'Paper cup', inventoryName: 'Paper cup', category: 'Craft Materials & STEM Kits', quantityPerDetection: 1, enabledByDefault: true },
  { label: 'goggles', displayName: 'Safety Goggle', inventoryName: 'Safety Goggle', category: 'Laboratory & Science Supplies', quantityPerDetection: 1, enabledByDefault: true },
  { label: 'nodemcu_esp32', displayName: 'NodeMCU', inventoryName: 'NodeMCU', category: 'Electronics & Robotics', quantityPerDetection: 1, enabledByDefault: true },
  { label: 'pen', displayName: 'Pen', inventoryName: 'Pen', category: 'Stationery & Office Supplies', quantityPerDetection: 1, enabledByDefault: true },
  { label: 'scissors', displayName: 'Scissor', inventoryName: 'Scissor', category: 'Tools & Equipment', quantityPerDetection: 1, enabledByDefault: true },
  { label: 'sticky_note_paper', displayName: 'Sticky note', inventoryName: 'Sticky note', category: 'Stationery & Office Supplies', quantityPerDetection: 1, enabledByDefault: true },
  { label: 'tongue_depressor', displayName: 'Popsicle stick', inventoryName: 'Popsicle stick', category: 'Craft Materials & STEM Kits', quantityPerDetection: 1, enabledByDefault: true },
];

export const YOLO_DEFINITION_BY_LABEL = Object.fromEntries(
  YOLO_CLASS_DEFINITIONS.map((definition) => [definition.label, definition])
) as Record<string, YOLOClassDefinition>;

export function getYOLODisplayName(classLabel: string): string {
  const definition = YOLO_DEFINITION_BY_LABEL[classLabel];

  return definition?.displayName ?? classLabel;
}
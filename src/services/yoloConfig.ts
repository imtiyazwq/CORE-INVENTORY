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

/**
 * Model specifications discovered from Netron:
 * Input:
 *   Name: serving_default_args_0
 *   Shape: [1, 3, 640, 640]
 *   Type: Float32
 *   Layout: NCHW
 * Output:
 *   Name: serving_default_output_0_output
 *   Shape: [1, 19, 8400]
 *   Type: Float32
 * Classes: 15
 */
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

/**
 * Strictly mapped 15 classes in the exact order requested:
 * Class index 0  -> 'Arduino_Uno'
 * Class index 1  -> 'a4_colored_paper'
 * Class index 2  -> 'bag_arduino_20'
 * Class index 3  -> 'bag_arduino_30'
 * Class index 4  -> 'box sticky note'
 * Class index 5  -> 'breadboard'
 * Class index 6  -> 'bundle_arduino'
 * Class index 7  -> 'cup_rim'
 * Class index 8  -> 'full_cup'
 * Class index 9  -> 'goggles'
 * Class index 10 -> 'nodemcu esp32'
 * Class index 11 -> 'pen'
 * Class index 12 -> 'scissors'
 * Class index 13 -> 'sticky note paper'
 * Class index 14 -> 'tongue_depressor'
 */
export const YOLO_CLASSES: string[] = [
  'Arduino_Uno',        // Index 0
  'a4_colored_paper',   // Index 1
  'bag_arduino_20',     // Index 2
  'bag_arduino_30',     // Index 3
  'box sticky note',    // Index 4
  'breadboard',         // Index 5
  'bundle_arduino',     // Index 6
  'cup_rim',            // Index 7
  'full_cup',           // Index 8
  'goggles',            // Index 9
  'nodemcu esp32',      // Index 10
  'pen',                // Index 11
  'scissors',           // Index 12
  'sticky note paper',  // Index 13
  'tongue_depressor',   // Index 14
];

export const YOLO_CLASS_CATEGORIES: Record<string, string> = {
  'Arduino_Uno': 'Electronics & Robotics',
  'a4_colored_paper': 'Stationery & Office Supplies',
  'bag_arduino_20': 'Electronics & Robotics',
  'bag_arduino_30': 'Electronics & Robotics',
  'box sticky note': 'Stationery & Office Supplies',
  'breadboard': 'Electronics & Robotics',
  'bundle_arduino': 'Electronics & Robotics',
  'cup_rim': 'Stationery & Office Supplies',
  'full_cup': 'Stationery & Office Supplies',
  'goggles': 'Laboratory & Science Supplies',
  'nodemcu esp32': 'Electronics & Robotics',
  'pen': 'Stationery & Office Supplies',
  'scissors': 'Craft Materials & STEM Kits',
  'sticky note paper': 'Stationery & Office Supplies',
  'tongue_depressor': 'Craft Materials & STEM Kits',
};

# VisionStock — CoreInventory YOLO integration

This build keeps the VisionStock UI/pages/components, while replacing the old VisionStock YOLO detection implementation with the CoreInventory detection pipeline.

## YOLO pipeline now used

1. `tfliteModelLoader.ts` loads the `.tflite` model through TensorFlow.js + TFLite WebAssembly.
2. `imagePreprocessor.ts` letterboxes the source to the model input and creates Float32 NCHW RGB data normalized to 0..1.
3. `tfliteInference.ts` sends the tensor to the TFLite Web runtime and reads the real output tensor.
4. `yoloDecoder.ts` decodes the `[1, 19, 8400]` YOLO output.
5. `yoloPostProcessor.ts` performs class-aware NMS and summarizes detections.
6. `ScanInventoryPage.tsx` continues to provide the VisionStock upload/webcam interface and calls the shared `runDetection()` pipeline.

## Important: the supplied model files are not valid TFLite models

The `inventory_yolo.tflite` files in BOTH supplied ZIPs are malformed.

- VisionStock model: 1,024 bytes. It has the `TFL3` identifier but the FlatBuffer root table is empty/invalid.
- CoreInventory model: 65,536 bytes. It has the `TFL3` identifier, but the bytes immediately after the root offset contain text metadata rather than a valid FlatBuffer root table. The supplied CoreInventory parser cannot traverse it as a normal TFLite model either.

Therefore, this integration fixes the browser/runtime/pipeline code, but it cannot produce real YOLO detections until a genuine exported TFLite model is placed at:

`public/models/inventory_yolo.tflite`

The real model should match the known configuration in `src/services/yoloConfig.ts`:

- Input: `[1, 3, 640, 640]`
- Type: `float32`
- Layout: `NCHW`
- Output: `[1, 19, 8400]`
- 15 classes

Do not use the 1 KB VisionStock placeholder or the 64 KB CoreInventory placeholder as the final model.

## Main causes found in the original VisionStock ZIP

1. It did not include TensorFlow.js / `@tensorflow/tfjs-tflite`.
2. It did not include the TFLite WebAssembly runtime files under `public/wasm`.
3. Its `modelService.ts` never executed the TFLite model. It generated artificial detections from image color/edge heuristics.
4. Its preprocessing resized/stretched images rather than using the CoreInventory letterbox + model-specific pipeline.
5. It did not read a real YOLO output tensor.
6. Its model class order differs from CoreInventory's documented trained class order.
7. Its bundled `.tflite` file is only 1 KB and is not a usable model.

## Run

Install dependencies, then start the Vite app using VisionStock's existing command:

`npm install`

`npm run dev`

After replacing the model with a genuine TFLite export, test both Upload Image and Webcam. Both paths call the same `runDetection()` function.


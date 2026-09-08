import {
  DetectedObject,
  DetectedSummaryItem,
  ModelConfig,
  PipelineDiagnostics,
  YOLOClassLabel,
} from '../types';
import { MODEL_CONFIG, YOLO_CLASSES, YOLO_CLASS_CATEGORIES } from './yoloConfig';
import { preprocessImageToNCHW, LetterboxInfo } from './imagePreprocessor';
import { TFLiteModelLoader, LoadedTFLiteModel } from './tfliteModelLoader';
import { runTFLiteInference } from './tfliteInference';
import { decodeYOLOOutput } from './yoloDecoder';
import { applyClassAwareNMS, summarizeDetections } from './yoloPostProcessor';

export { MODEL_CONFIG, YOLO_CLASSES };

export const PREDEFINED_YOLO_CATEGORIES = [
  'Craft Materials & STEM Kits',
  'Electronics & Robotics',
  'Laboratory & Science Supplies',
  'Stationery & Office Supplies',
  'Tools & Equipment',
] as const;

/**
 * EXACT class index order matching the trained YOLO model (Classes: 15, indices 0 to 14):
 * Class index 0 -> Arduino_Uno
 * Class index 1 -> a4_colored_paper
 * Class index 2 -> bag_arduino_20
 * Class index 3 -> bag_arduino_30
 * Class index 4 -> box sticky note
 * Class index 5 -> breadboard
 * Class index 6 -> bundle_arduino
 * Class index 7 -> cup_rim
 * Class index 8 -> full_cup
 * Class index 9 -> goggles
 * Class index 10 -> nodemcu esp32
 * Class index 11 -> pen
 * Class index 12 -> scissors
 * Class index 13 -> sticky note paper
 * Class index 14 -> tongue_depressor
 */
export const DEFAULT_YOLO_LABELS: YOLOClassLabel[] = YOLO_CLASSES.map((label, index) => ({
  id: `lbl-${index}`,
  index,
  label,
  category: YOLO_CLASS_CATEGORIES[label] || 'Electronics & Robotics',
}));

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  modelPath: MODEL_CONFIG.modelPath,
  engineMode: 'Real TFLite Model Mode',
  confidenceThreshold: MODEL_CONFIG.defaultConfidenceThreshold,
  inputResolution: MODEL_CONFIG.imageSize,
  nmsThreshold: MODEL_CONFIG.defaultNmsThreshold,
  labels: DEFAULT_YOLO_LABELS,
};

export interface InferenceResult {
  objects: DetectedObject[];
  summary: DetectedSummaryItem[];
  diagnostics: PipelineDiagnostics;
}

class YOLOModelService {
  private loadedModel: LoadedTFLiteModel | null = null;
  private isLoaded: boolean = false;
  private loadError: string | null = null;
  private config: ModelConfig = { ...DEFAULT_MODEL_CONFIG };
  private lastDiagnostics: PipelineDiagnostics | null = null;

  public updateConfig(newConfig: Partial<ModelConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public getConfig(): ModelConfig {
    return { ...this.config };
  }

  public getLoadedModel(): LoadedTFLiteModel | null {
    return this.loadedModel;
  }

  public isModelReady(): boolean {
    return this.isLoaded && this.loadedModel !== null;
  }

  public getLoadError(): string | null {
    return this.loadError;
  }

  public getLastDiagnostics(): PipelineDiagnostics | null {
    return this.lastDiagnostics;
  }

  /**
   * Loads the real TFLite model from path or provided ArrayBuffer.
   */
  public async loadModel(path: string = this.config.modelPath, overrideBuffer?: ArrayBuffer): Promise<LoadedTFLiteModel> {
    this.loadError = null;
    try {
      console.log(`[TFLite Runtime] Loading model from "${path}"...`);
      const model = await TFLiteModelLoader.loadModel(path, overrideBuffer);
      this.loadedModel = model;
      this.isLoaded = true;

      console.log('[TFLite Runtime] Model loaded successfully:', {
        modelName: model.modelName,
        fileSize: `${(model.fileSizeBytes / 1024).toFixed(1)} KB`,
        inputShape: model.inputShape,
        outputShape: model.outputShape,
        backend: model.executionBackend,
      });

      return model;
    } catch (err: any) {
      this.isLoaded = false;
      this.loadedModel = null;
      const message = err instanceof Error ? err.message : String(err);
      this.loadError = `Unable to load TFLite model: ${message}`;
      console.error('[TFLite Runtime] Model loading failure:', this.loadError);
      throw new Error(this.loadError);
    }
  }

  /**
   * Allows dynamically loading and swapping a custom .tflite model from an in-memory buffer.
   */
  public async loadModelFromBuffer(
    buffer: ArrayBuffer,
    modelName: string
  ): Promise<{ inputTensor: { shape: number[] }; outputTensor: { shape: number[] } }> {
    const model = await this.loadModel(modelName, buffer);
    return {
      inputTensor: { shape: model.inputShape },
      outputTensor: { shape: model.outputShape },
    };
  }

  /**
   * Execute the unified YOLO detection pipeline on any visual input:
   * Image/Webcam Frame -> Resize/Preprocess -> Float32 NCHW Tensor -> TFLite Inference -> Decode Output [1, 19, 8400] -> Confidence Filter -> NMS -> Final Detections
   */
  public async detect(
    source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement | ImageBitmap
  ): Promise<InferenceResult> {
    const totalStart = performance.now();
    let sourceType = 'Canvas';

    let origWidth = 640;
    let origHeight = 480;

    if (source instanceof HTMLVideoElement) {
      sourceType = 'Webcam Video Stream';
      origWidth = source.videoWidth || 640;
      origHeight = source.videoHeight || 480;
    } else if (source instanceof HTMLImageElement) {
      sourceType = 'Image File';
      origWidth = source.naturalWidth || source.width || 640;
      origHeight = source.naturalHeight || source.height || 480;
    } else if (source instanceof HTMLCanvasElement) {
      sourceType = 'Decoded Image Canvas';
      origWidth = source.width || 640;
      origHeight = source.height || 480;
    }

    console.log(`[TFLite Runtime] Inference started on ${sourceType} (${origWidth}x${origHeight})...`);

    // 1. Ensure Model is Loaded
    if (!this.isLoaded || !this.loadedModel) {
      await this.loadModel(this.config.modelPath);
    }

    if (!this.loadedModel) {
      throw new Error('TFLite Model is not available for inference.');
    }

    // 2. Preprocess to Float32 [1, 3, 640, 640] NCHW
    const prepResult = preprocessImageToNCHW(source, MODEL_CONFIG.imageSize);

    // 3. Run Inference -> Output Tensor [1, 19, 8400]
    const inferResult = await runTFLiteInference(this.loadedModel, prepResult.tensor);

    // 4. Decode Feature-Major or Prediction-Major Output Tensor
    const decodeStart = performance.now();
    const candidates = decodeYOLOOutput(
      inferResult.outputTensor,
      prepResult.letterbox,
      this.config.confidenceThreshold,
      inferResult.outputShape
    );

    // 5. Apply Class-Aware Non-Maximum Suppression (NMS)
    const nmsObjects = applyClassAwareNMS(candidates, this.config.nmsThreshold);
    const postTimeMs = Math.round((performance.now() - decodeStart) * 10) / 10;

    // 6. Summarize Detected Classes and Counts
    const summary = summarizeDetections(nmsObjects);
    const totalTimeMs = Math.round((performance.now() - totalStart) * 10) / 10;

    console.log(`[TFLite Runtime] Inference completed in ${totalTimeMs}ms. Detected ${nmsObjects.length} objects across ${summary.length} classes.`);

    const finalObjectCount: Record<string, number> = {};
    for (const item of summary) {
      finalObjectCount[item.className] = item.count;
    }

    const diagnostics: PipelineDiagnostics = {
      runtimeStatus: 'Model ready',
      modelStatus: `${this.loadedModel.modelName} (${Math.round(this.loadedModel.fileSizeBytes / 1024)} KB)`,
      modelName: this.loadedModel.modelName,
      modelPath: this.loadedModel.modelPath,
      modelFileSize: this.loadedModel.fileSizeBytes,
      inputShape: [...MODEL_CONFIG.inputShape],
      inputDataType: MODEL_CONFIG.inputType.toUpperCase(),
      inputLayout: MODEL_CONFIG.inputLayout,
      outputShape: [...MODEL_CONFIG.outputShape],
      outputDataType: MODEL_CONFIG.outputType.toUpperCase(),
      rawOutputLength: inferResult.outputTensor.length,
      rawPredictionsCount: MODEL_CONFIG.numPredictions,
      aboveThresholdCount: candidates.length,
      afterNmsCount: nmsObjects.length,
      suppressedCount: Math.max(0, candidates.length - nmsObjects.length),
      finalObjectCount,
      confidenceThreshold: this.config.confidenceThreshold,
      nmsThreshold: this.config.nmsThreshold,
      inferenceTimeMs: inferResult.inferenceTimeMs,
      preprocessTimeMs: Math.round(prepResult.preprocessTimeMs * 10) / 10,
      nmsTimeMs: postTimeMs,
      totalTimeMs,
      errorMessage: null,
      timestamp: new Date().toISOString(),

      // Extended diagnostics
      modelLoaded: true,
      fileSizeBytes: this.loadedModel.fileSizeBytes,
      inputTensorDetails: {
        name: MODEL_CONFIG.inputName,
        shape: MODEL_CONFIG.inputShape,
        dataType: MODEL_CONFIG.inputType.toUpperCase(),
        layout: MODEL_CONFIG.inputLayout,
      },
      outputTensorDetails: {
        name: MODEL_CONFIG.outputName,
        shape: MODEL_CONFIG.outputShape,
        dataType: MODEL_CONFIG.outputType.toUpperCase(),
      },
      totalAnchorsEvaluated: MODEL_CONFIG.numPredictions,
      rawCandidatesAboveThreshold: candidates.length,
      finalDetectionsAfterNMS: nmsObjects.length,
      preprocTimeMs: Math.round(prepResult.preprocessTimeMs * 10) / 10,
      postprocTimeMs: postTimeMs,
      confidenceThresholdUsed: this.config.confidenceThreshold,
      nmsThresholdUsed: this.config.nmsThreshold,
      executionBackend: inferResult.backendUsed,
    };

    this.lastDiagnostics = diagnostics;

    return {
      objects: nmsObjects,
      summary,
      diagnostics,
    };
  }
}

// Global Singleton
export const modelService = new YOLOModelService();

/**
 * Single shared detection function used by BOTH Upload Image and Live Webcam.
 * Image/Webcam Frame -> Resize/Preprocess -> Float32 NCHW -> TFLite Inference -> Decode [1, 19, 8400] -> Confidence Filter -> NMS -> Final Detections
 */
export async function runDetection(
  imageSource: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement | ImageBitmap
): Promise<InferenceResult> {
  return modelService.detect(imageSource);
}

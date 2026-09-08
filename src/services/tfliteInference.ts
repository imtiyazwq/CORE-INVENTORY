import { LoadedTFLiteModel } from './tfliteModelLoader';
import { MODEL_CONFIG } from './yoloConfig';

export interface InferenceResult {
  outputTensor: Float32Array;
  outputShape: [number, number, number];
  inferenceTimeMs: number;
  backendUsed: string;
}

/**
 * Execute real TFLite WebAssembly inference:
 * Input: Float32Array of length 1 * 3 * 640 * 640 = 1,228,800 (NCHW)
 * Output: Float32Array of length 1 * 19 * 8400 = 159,600 (Feature-Major or transposed)
 */
export async function runTFLiteInference(
  model: LoadedTFLiteModel,
  inputNCHW: Float32Array
): Promise<InferenceResult> {
  const startTime = performance.now();

  if (!model.tfjsModel) {
    throw new Error('TFLite model is not loaded. Please ensure the model was initialized.');
  }

  // Retrieve tf from window or dynamic import
  let tf = (typeof window !== 'undefined' && (window as any).tf) ? (window as any).tf : null;
  if (!tf) {
    try {
      tf = await import('@tensorflow/tfjs');
    } catch {
      throw new Error('TensorFlow.js runtime is unavailable.');
    }
  }

  // 1. Build input tensor matching exact Netron model specification: float32[1, 3, 640, 640]
  const inputShape = model.inputShape || MODEL_CONFIG.inputShape;
  const inputTensor = tf.tensor(inputNCHW, inputShape, 'float32');

  try {
    // 2. Run real TFLite WebAssembly inference
    const output = model.tfjsModel.predict(inputTensor);

    let tensorData: Float32Array;
    let outShape: [number, number, number] = model.outputShape || [1, 19, 8400];

    if (output instanceof tf.Tensor) {
      tensorData = (await output.data()) as Float32Array;
      if (output.shape && output.shape.length >= 3) {
        outShape = output.shape as [number, number, number];
      }
      output.dispose();
    } else if (Array.isArray(output)) {
      tensorData = (await output[0].data()) as Float32Array;
      if (output[0].shape && output[0].shape.length >= 3) {
        outShape = output[0].shape as [number, number, number];
      }
      output.forEach((t: any) => t.dispose && t.dispose());
    } else if (output && typeof output === 'object') {
      const keys = Object.keys(output);
      if (keys.length === 0) {
        throw new Error('TFLite model returned empty output map.');
      }
      const firstTensor = output[keys[0]];
      tensorData = (await firstTensor.data()) as Float32Array;
      if (firstTensor.shape && firstTensor.shape.length >= 3) {
        outShape = firstTensor.shape as [number, number, number];
      }
      keys.forEach((k) => output[k].dispose && output[k].dispose());
    } else {
      throw new Error('Unexpected output format from TFLite WebAssembly inference.');
    }

    const inferenceTimeMs = Math.round((performance.now() - startTime) * 10) / 10;

    return {
      outputTensor: tensorData,
      outputShape: outShape,
      inferenceTimeMs,
      backendUsed: 'WebAssembly-TFLite',
    };
  } finally {
    inputTensor.dispose();
  }
}

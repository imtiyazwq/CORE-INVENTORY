import { MODEL_CONFIG } from './yoloConfig';

export interface LoadedTFLiteModel {
  isReady: boolean;
  modelName: string;
  sourceUrlOrName: string;
  modelPath: string;
  fileSizeBytes: number;
  rawBuffer: ArrayBuffer;
  weightsBuffer: Float32Array;
  tfjsModel?: any;
  inputShape: [number, number, number, number];
  outputShape: [number, number, number];
  executionBackend: 'WebAssembly-TFLite' | 'Direct-Weight-Inference';
}

/**
 * Ensures TensorFlow.js and TFLite WebAssembly runtime are initialized on window.
 */
export async function getTFLiteWebRuntime(): Promise<{ tf: any; tflite: any }> {
  if (typeof window === 'undefined') {
    throw new Error('TFLite WebAssembly requires a browser window environment.');
  }

  // 1. Check if window.tf and window.tflite are already available
  if ((window as any).tf && (window as any).tflite) {
    const tflite = (window as any).tflite;
    if (typeof tflite.setWasmPath === 'function') {
      tflite.setWasmPath('/wasm/');
    }
    return { tf: (window as any).tf, tflite };
  }

  // 2. Poll for script tags if currently loading
  const start = performance.now();
  while ((!(window as any).tf || !(window as any).tflite) && performance.now() - start < 3000) {
    await new Promise((r) => setTimeout(r, 50));
  }

  if ((window as any).tf && (window as any).tflite) {
    const tflite = (window as any).tflite;
    if (typeof tflite.setWasmPath === 'function') {
      tflite.setWasmPath('/wasm/');
    }
    return { tf: (window as any).tf, tflite };
  }

  // 3. Fallback: dynamically inject scripts
  await loadScriptOnce('/wasm/tf.min.js');
  await loadScriptOnce('/wasm/tf-tflite.min.js');

  const tf = (window as any).tf;
  const tflite = (window as any).tflite;

  if (!tflite || typeof tflite.loadTFLiteModel !== 'function') {
    throw new Error('TensorFlow Lite WebAssembly runtime (tflite.loadTFLiteModel) could not be initialized.');
  }

  if (typeof tflite.setWasmPath === 'function') {
    tflite.setWasmPath('/wasm/');
  }

  return { tf, tflite };
}

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === 'true') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', (e) => reject(e));
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export class TFLiteModelLoader {
  private static cachedModel: LoadedTFLiteModel | null = null;
  private static isLoading = false;
  private static loadPromise: Promise<LoadedTFLiteModel> | null = null;

  /**
   * Load the TFLite model from path or provided ArrayBuffer using real WebAssembly.
   */
  public static async loadModel(
    sourcePath: string = MODEL_CONFIG.modelPath,
    overrideBuffer?: ArrayBuffer
  ): Promise<LoadedTFLiteModel> {
    if (this.cachedModel && !overrideBuffer && this.cachedModel.sourceUrlOrName === sourcePath) {
      return this.cachedModel;
    }

    if (this.isLoading && this.loadPromise && !overrideBuffer) {
      return this.loadPromise;
    }

    this.isLoading = true;
    this.loadPromise = (async () => {
      try {
        let buffer: ArrayBuffer;

        if (overrideBuffer) {
          buffer = overrideBuffer;
        } else {
          // Fetch model file from server
          const response = await fetch(sourcePath);
          if (!response.ok) {
            if (response.status === 404) {
              throw new Error(`Missing model file: Model file was not found at "${sourcePath}".`);
            }
            throw new Error(`Failed to load model file (${response.status} ${response.statusText}).`);
          }
          buffer = await response.arrayBuffer();
        }

        if (!buffer || buffer.byteLength < 32) {
          throw new Error('Invalid model file: File size is too small or corrupted.');
        }

        // Validate FlatBuffers identifier or signature
        const view = new DataView(buffer);
        const idChars = [view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7)];
        const identifier = String.fromCharCode(...idChars);

        if (!identifier.startsWith('TFL') && identifier !== 'FLAT') {
          console.warn(`[TFLiteLoader] Header identifier was "${identifier}". Continuing FlatBuffer parsing.`);
        }

        // Extract weights buffer
        const weightOffset = Math.min(512, buffer.byteLength - 64);
        const floatCount = Math.floor((buffer.byteLength - weightOffset) / 4);
        const weightsBuffer = new Float32Array(buffer, weightOffset, floatCount);

        // Load into WebAssembly TFLite model runner
        const { tflite } = await getTFLiteWebRuntime();

        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        const blobUrl = URL.createObjectURL(blob);
        let tfjsModel: any = null;

        try {
          tfjsModel = await tflite.loadTFLiteModel(blobUrl);
        } finally {
          URL.revokeObjectURL(blobUrl);
        }

        if (!tfjsModel) {
          throw new Error('Failed to instantiate TFLite model from buffer.');
        }

        let inputShape: [number, number, number, number] = MODEL_CONFIG.inputShape;
        let outputShape: [number, number, number] = MODEL_CONFIG.outputShape;

        if (tfjsModel.modelRunner) {
          try {
            const inputs = tfjsModel.modelRunner.getInputs();
            if (inputs && inputs[0] && inputs[0].shape) {
              const parsed = inputs[0].shape.split(',').map((n: string) => Number(n.trim()));
              if (parsed.length === 4) {
                inputShape = parsed as [number, number, number, number];
              }
            }
            const outputs = tfjsModel.modelRunner.getOutputs();
            if (outputs && outputs[0] && outputs[0].shape) {
              const parsedOut = outputs[0].shape.split(',').map((n: string) => Number(n.trim()));
              if (parsedOut.length === 3) {
                outputShape = parsedOut as [number, number, number];
              }
            }
          } catch (inspectErr) {
            console.warn('[TFLiteLoader] Input/Output tensor inspection note:', inspectErr);
          }
        }

        const modelFileName = sourcePath.split('/').pop() || 'inventory_yolo.tflite';

        const loaded: LoadedTFLiteModel = {
          isReady: true,
          modelName: modelFileName,
          sourceUrlOrName: sourcePath,
          modelPath: sourcePath,
          fileSizeBytes: buffer.byteLength,
          rawBuffer: buffer,
          weightsBuffer,
          tfjsModel,
          inputShape,
          outputShape,
          executionBackend: 'WebAssembly-TFLite',
        };

        this.cachedModel = loaded;
        return loaded;
      } finally {
        this.isLoading = false;
        this.loadPromise = null;
      }
    })();

    return this.loadPromise;
  }

  public static getCachedModel(): LoadedTFLiteModel | null {
    return this.cachedModel;
  }

  public static clearCache(): void {
    this.cachedModel = null;
  }
}

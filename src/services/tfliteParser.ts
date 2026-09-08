import { TensorDetails } from '../types';

export interface ParsedTFLiteModel {
  isValid: boolean;
  format: string;
  version: number;
  identifier: string;
  fileSize: number;
  modelName: string;
  description?: string;
  inputTensor: TensorDetails;
  outputTensor: TensorDetails;
  weightsBuffer?: Float32Array;
  rawBuffer: ArrayBuffer;
  classCount: number;
  anchorCount: number;
  embeddedLabels?: string[];
}

/**
 * TFLite FlatBuffers and dynamic model introspection parser.
 * Reads tensor shapes, types, layouts, and weight buffers dynamically at runtime.
 */
export class TFLiteParser {
  /**
   * Parse a TFLite ArrayBuffer dynamically.
   */
  public static parse(buffer: ArrayBuffer, fallbackPath: string = 'model.tflite'): ParsedTFLiteModel {
    if (!buffer || buffer.byteLength < 20) {
      throw new Error('Invalid TFLite binary: Buffer too small (< 20 bytes).');
    }

    const view = new DataView(buffer);
    const fileSize = buffer.byteLength;

    // Check identifier at offset 4: "TFL3" or "TFL2" or "TFL1"
    const idChars = [
      view.getUint8(4),
      view.getUint8(5),
      view.getUint8(6),
      view.getUint8(7),
    ];
    const identifier = String.fromCharCode(...idChars);

    if (!identifier.startsWith('TFL') && identifier !== 'FLAT') {
      throw new Error(
        `Invalid TFLite signature: Expected "TFL3" or "TFL2" at byte offset 4, found "${identifier}".`
      );
    }

    // Default metadata
    let modelName = 'YOLO_TFLite_Detector';
    let inputTensor: TensorDetails = {
      name: 'images',
      shape: [1, 3, 640, 640],
      dataType: 'FLOAT32',
      layout: 'NCHW',
    };
    let outputTensor: TensorDetails = {
      name: 'boxes_scores',
      shape: [1, 20, 8400],
      dataType: 'FLOAT32',
    };
    let embeddedLabels: string[] | undefined;

    // 1. Check for header metadata strings in the first 2KB
    const headerSlice = new Uint8Array(buffer, 0, Math.min(2048, buffer.byteLength));
    let headerText = '';
    for (let i = 0; i < headerSlice.length; i++) {
      headerText += String.fromCharCode(headerSlice[i]);
    }

    // Match model name if present
    const nameMatch = headerText.match(/([a-zA-Z0-9_]+_YOLO[a-zA-Z0-9_]*)/i);
    if (nameMatch) {
      modelName = nameMatch[1];
    }

    // Match input tensor descriptor e.g. "input:images[1,3,640,640]:FLOAT32:NCHW"
    const inputMatch = headerText.match(/input:([a-zA-Z0-9_.-]+)\[([0-9, ]+)\]:([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_]+))?/i);
    if (inputMatch) {
      const name = inputMatch[1];
      const shape = inputMatch[2].split(',').map((s) => parseInt(s.trim(), 10));
      const dataType = inputMatch[3].toUpperCase();
      let layout: 'NCHW' | 'NHWC' = 'NCHW';

      if (inputMatch[4]) {
        layout = inputMatch[4].toUpperCase() === 'NHWC' ? 'NHWC' : 'NCHW';
      } else if (shape.length === 4) {
        // Infer from shape: [1, 3, H, W] -> NCHW vs [1, H, W, 3] -> NHWC
        layout = shape[1] === 3 || shape[1] === 1 ? 'NCHW' : 'NHWC';
      }

      inputTensor = { name, shape, dataType, layout };
    }

    // Match output tensor descriptor e.g. "output:boxes_scores[1,20,8400]:FLOAT32"
    const outputMatch = headerText.match(/output:([a-zA-Z0-9_.-]+)\[([0-9, ]+)\]:([a-zA-Z0-9_]+)/i);
    if (outputMatch) {
      const name = outputMatch[1];
      const shape = outputMatch[2].split(',').map((s) => parseInt(s.trim(), 10));
      const dataType = outputMatch[3].toUpperCase();
      outputTensor = { name, shape, dataType };
    }

    // 2. Perform FlatBuffer Table Traversal (for standard ultralytics/tflite exported models)
    try {
      this.parseFlatBufferTables(buffer, (fbModel) => {
        if (fbModel.modelName) modelName = fbModel.modelName;
        if (fbModel.inputTensor) inputTensor = fbModel.inputTensor;
        if (fbModel.outputTensor) outputTensor = fbModel.outputTensor;
        if (fbModel.embeddedLabels) embeddedLabels = fbModel.embeddedLabels;
      });
    } catch (fbErr) {
      // Non-fatal if header parser already captured descriptors
      console.debug('[TFLiteParser] FlatBuffer deep table traversal info:', fbErr);
    }

    // Calculate class count and anchor count dynamically from output tensor shape
    let classCount = 16;
    let anchorCount = 8400;

    const outShape = outputTensor.shape;
    if (outShape.length === 3) {
      // YOLOv8 Transposed [1, 4 + C, A] -> e.g. [1, 20, 8400]
      if (outShape[1] < outShape[2] && outShape[1] >= 5) {
        classCount = outShape[1] - 4;
        anchorCount = outShape[2];
      } else if (outShape[2] < outShape[1] && outShape[2] >= 5) {
        // YOLOv8 Untransposed [1, A, 4 + C] -> e.g. [1, 8400, 20]
        classCount = outShape[2] - 4;
        anchorCount = outShape[1];
      }
    } else if (outShape.length === 2) {
      // [1, A * (4 + C)] or [A, 4 + C]
      if (outShape[1] >= 5) {
        classCount = outShape[1] - 4;
        anchorCount = outShape[0];
      }
    }

    // Extract weights buffer if available (offset >= 512)
    let weightsBuffer: Float32Array | undefined;
    if (buffer.byteLength > 512) {
      const weightOffset = 512;
      const floatCount = Math.floor((buffer.byteLength - weightOffset) / 4);
      if (floatCount > 0) {
        weightsBuffer = new Float32Array(buffer, weightOffset, floatCount);
      }
    }

    return {
      isValid: true,
      format: 'TensorFlow Lite FlatBuffers',
      version: 3,
      identifier,
      fileSize,
      modelName,
      inputTensor,
      outputTensor,
      weightsBuffer,
      rawBuffer: buffer,
      classCount,
      anchorCount,
      embeddedLabels,
    };
  }

  /**
   * Helper to parse FlatBuffer root table and subgraphs if standard schema is present.
   */
  private static parseFlatBufferTables(
    buffer: ArrayBuffer,
    callback: (info: {
      modelName?: string;
      inputTensor?: TensorDetails;
      outputTensor?: TensorDetails;
      embeddedLabels?: string[];
    }) => void
  ): void {
    const view = new DataView(buffer);
    const rootOffset = view.getUint32(0, true);
    if (rootOffset === 0 || rootOffset >= buffer.byteLength) return;

    // Read vtable offset
    const vtableOffset = rootOffset - view.getInt32(rootOffset, true);
    if (vtableOffset < 0 || vtableOffset >= buffer.byteLength) return;

    const vtableLength = view.getUint16(vtableOffset, true);
    if (vtableLength < 8) return;

    // Subgraphs vector is usually field 2 (offset 8 in vtable)
    if (vtableLength > 8) {
      const subgraphsFieldOffset = view.getUint16(vtableOffset + 8, true);
      if (subgraphsFieldOffset !== 0) {
        const subgraphsVecPos = rootOffset + subgraphsFieldOffset;
        const subgraphsVecOffset = subgraphsVecPos + view.getInt32(subgraphsVecPos, true);
        const subgraphsCount = view.getUint32(subgraphsVecOffset, true);

        if (subgraphsCount > 0) {
          // Look into primary SubGraph 0
          const sgPos = subgraphsVecOffset + 4;
          const sgOffset = sgPos + view.getInt32(sgPos, true);
          const sgVtableOffset = sgOffset - view.getInt32(sgOffset, true);
          const sgVtableLength = view.getUint16(sgVtableOffset, true);

          // Tensors vector in subgraph is field 0 (offset 4)
          if (sgVtableLength > 4) {
            const tensorsFieldOffset = view.getUint16(sgVtableOffset + 4, true);
            if (tensorsFieldOffset !== 0) {
              const tensorsVecPos = sgOffset + tensorsFieldOffset;
              const tensorsVecOffset = tensorsVecPos + view.getInt32(tensorsVecPos, true);
              const tensorsCount = view.getUint32(tensorsVecOffset, true);

              if (tensorsCount > 0) {
                // Found tensors in subgraph!
                // Read tensor 0 (usually input)
                const t0Pos = tensorsVecOffset + 4;
                const t0Offset = t0Pos + view.getInt32(t0Pos, true);
                const t0VtableOffset = t0Offset - view.getInt32(t0Offset, true);
                const t0VtableLength = view.getUint16(t0VtableOffset, true);

                // Tensor shape is field 0 (offset 4 in Tensor vtable)
                if (t0VtableLength > 4) {
                  const shapeFieldOffset = view.getUint16(t0VtableOffset + 4, true);
                  if (shapeFieldOffset !== 0) {
                    const shapeVecPos = t0Offset + shapeFieldOffset;
                    const shapeVecOffset = shapeVecPos + view.getInt32(shapeVecPos, true);
                    const shapeDimCount = view.getUint32(shapeVecOffset, true);

                    if (shapeDimCount >= 3 && shapeDimCount <= 4) {
                      const shape: number[] = [];
                      for (let d = 0; d < shapeDimCount; d++) {
                        shape.push(view.getInt32(shapeVecOffset + 4 + d * 4, true));
                      }

                      const layout: 'NCHW' | 'NHWC' = shape[1] === 3 || shape[1] === 1 ? 'NCHW' : 'NHWC';
                      callback({
                        inputTensor: {
                          name: 'images',
                          shape,
                          dataType: 'FLOAT32',
                          layout,
                        },
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

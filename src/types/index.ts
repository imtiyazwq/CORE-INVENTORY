export type ValidLocation =
  | 'CHEMICAL ROOM'
  | 'CHILLAX'
  | 'MAKER STUDIO'
  | 'STORE 1';

export type AssetType = 'Non-Consumable' | 'Consumable';

export type ItemStatus =
  | 'Available'
  | 'Checked Out'
  | 'Missing'
  | 'Lost'
  | 'Damaged'
  | 'Under Maintenance'
  | 'Disposed';

export type ItemCategory =
  | 'IT Equipment'
  | 'Office Supplies'
  | 'Laboratory & Chemical'
  | 'Storage & Facility'
  | 'Safety & Protective Equipment';

export interface UserAccount {
  id: string;
  userId: string;
  userName: string;
  teamName: string;
  role?: string;
  createdAt: string;
}

export interface InventoryItem {
  id: string;
  itemCode: string;
  name: string;
  category: ItemCategory;
  subCategory?: string;
  specification?: string;
  assetType: AssetType;
  quantity: number;
  availableQuantity: number;
  location: ValidLocation;
  rackShelf: string;
  status: ItemStatus;
  user?: string;
  team?: string;
  checkedOutAt?: string;
  lastSeen: string;
  lastStocktakeDate?: string;
  remarks?: string;
}

export interface BoundingBox {
  x: number;      // normalized 0..1 (left)
  y: number;      // normalized 0..1 (top)
  width: number;  // normalized 0..1
  height: number; // normalized 0..1
}

export interface DetectedObject {
  id: string;
  classIndex: number;
  className: string;
  confidence: number;
  bbox: BoundingBox;
}

export interface DetectedSummaryItem {
  className: string;
  count: number;
  averageConfidence: number;
  matchedInventoryId?: string;
}

export interface ScanRecord {
  id: string;
  timestamp: string;
  type: 'webcam' | 'upload';
  location: ValidLocation;
  user: string;
  team?: string;
  itemsDetected: Array<{
    className: string;
    quantity: number;
    confidence: number;
    // Real product SKU resolved at scan-confirm time (see yoloConfig.ts's
    // YOLO_CLASS_SKUS). Optional because older scan records predate this
    // field — StockCheckPage.tsx falls back to re-resolving from className
    // via the same lookup table when it's missing.
    sku?: string | null;
  }>;
  totalQuantity: number;
  status: 'Completed' | 'Confirmed' | 'Discrepancy Flagged';
  rawImagePreview?: string;
  previewUrl?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Stock Check — periodic per-location audit reconciling the inventory ledger
// ("expected") against a confirmed scan's detections ("detected"). See
// StockCheckPage.tsx. Matching is done by sku (not name/className) — see
// PROJECT_STATUS.md's Section 10 for why a name/className match is unsafe.
// ---------------------------------------------------------------------------

export interface StockCheckItem {
  // null means this row's className has no resolvable product mapping at
  // all (see YOLO_CLASS_SKUS) — it can never be posted as a transaction.
  sku: string | null;
  name: string;
  category: string;
  expected: number;
  detected: number;
  // difference and variance are the same value (detected - expected); both
  // are kept because StockCheckPage.tsx's UI already referred to it as
  // "variance" while the audit-trail semantics are clearer as "difference".
  difference: number;
  variance: number;
  status: 'Matched' | 'Short' | 'Extra';
  // True when this sku was detected in the scan but has no existing
  // store_inventory row for this location at all (expected implicitly 0
  // because there's nothing to compare against, not because a count of 0
  // was confirmed). These are deliberately excluded from auto-reconciliation
  // — see PROJECT_STATUS.md's Section 12 "isNew" note.
  isNew?: boolean;
}

export interface StockCheckRecord {
  id: string;
  timestamp: string;
  location: ValidLocation;
  operator: string;
  user?: string;
  team?: string;
  matchedCount: number;
  discrepancyCount: number;
  confirmedAt: string;
  notes?: string;
  items: StockCheckItem[];
  // Whether "synchronize inventory records with physical detected counts"
  // was checked when this record was confirmed — i.e. whether discrepant
  // rows actually got posted as ADJUSTMENT transactions, or this was a
  // review-only pass.
  appliedToInventory?: boolean;
}

export interface AuditAdjustmentRecord {
  id: string;
  timestamp: string;
  location: ValidLocation;
  scanId?: string;
  itemName: string;
  previousQuantity: number;
  detectedQuantity: number;
  confirmedQuantity: number;
  variance: number;
  updatedBy: string;
  team: string;
  notes?: string;
}

export interface YOLOClassLabel {
  id?: string;
  index: number;
  label: string;
  category: string;
  // Real product catalog SKU for this class, hand-verified against the
  // product database (see yoloConfig.ts's YOLO_CLASS_SKUS). null means no
  // product mapping exists — a scan/manual-add of this class must not post a
  // transaction, since there's nothing to attribute it to.
  sku: string | null;
}

export type YOLOClassMapping = YOLOClassLabel;

export type ModelEngineMode = 'Real TFLite Model Mode' | 'Demo Simulation Mode';
export type EngineMode = ModelEngineMode;

export interface ModelConfig {
  modelPath: string;
  engineMode: ModelEngineMode;
  confidenceThreshold: number;
  inputResolution: number; // e.g. 640
  nmsThreshold: number;
  labels: YOLOClassLabel[];
  classes?: YOLOClassLabel[];
}

export interface OfflineMutation {
  id: string;
  timestamp: string;
  action: 'UPDATE_ITEM' | 'CHECKOUT' | 'CHECKIN' | 'CONFIRM_SCAN';
  payload: any;
  synced: boolean;
}

export interface TensorDetails {
  name: string;
  shape: number[];
  dataType: string;
  layout?: 'NCHW' | 'NHWC';
  quantization?: {
    scale?: number;
    zeroPoint?: number;
  };
}

export interface PipelineDiagnostics {
  runtimeStatus: string;
  modelStatus: string;
  modelName: string;
  modelPath: string;
  modelFileSize: number;
  inputShape: number[];
  inputDataType: string;
  inputLayout: 'NCHW' | 'NHWC';
  outputShape: number[];
  outputDataType: string;
  rawOutputLength?: number;
  quantization?: {
    scale?: number;
    zeroPoint?: number;
  };
  rawPredictionsCount: number;
  aboveThresholdCount: number;
  afterNmsCount: number;
  suppressedCount: number;
  finalObjectCount: Record<string, number>;
  confidenceThreshold: number;
  nmsThreshold: number;
  inferenceTimeMs: number;
  preprocessTimeMs: number;
  nmsTimeMs: number;
  totalTimeMs: number;
  errorMessage?: string | null;
  timestamp: string;

  // Extended diagnostic metrics
  modelLoaded?: boolean;
  fileSizeBytes?: number;
  inputTensorDetails?: TensorDetails;
  outputTensorDetails?: TensorDetails;
  totalAnchorsEvaluated?: number;
  rawCandidatesAboveThreshold?: number;
  finalDetectionsAfterNMS?: number;
  preprocTimeMs?: number;
  postprocTimeMs?: number;
  confidenceThresholdUsed?: number;
  nmsThresholdUsed?: number;
  executionBackend?: string;
}

export interface StorageLedger {
  version: string;
  lastUpdated: string;
  items: InventoryItem[];
  scanHistory: ScanRecord[];
  modelConfig: ModelConfig;
  pendingMutations: OfflineMutation[];
}

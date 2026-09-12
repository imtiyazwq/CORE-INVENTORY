import { VALID_LOCATIONS } from '../data/locations';

export type ValidLocation = (typeof VALID_LOCATIONS)[number];

export type AssetType = 'Consumable' | 'Controllable Asset' | 'Non-Consumable';

export type ItemCategory =
  | 'IT Equipment'
  | 'Laboratory & Chemical'
  | 'Safety & Protective Equipment'
  | 'Office Supplies'
  | 'Craft Materials STEM Kits'
  | 'Electronics Robotics'
  | 'Laboratory Science Supplies'
  | 'Stationery Office Supplies'
  | 'Tools Equipment'
  | string;

export type ItemStatus =
  | 'Available'
  | 'Checked Out'
  | 'Missing'
  | 'Lost'
  | 'Damaged'
  | 'Under Maintenance'
  | 'Disposed'
  | 'Low Stock';

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
  unit?: string;
  itemsOutDate?: string;
  itemsInDate?: string;
  qtyReturn?: number;
  remarks?: string;
  imageReference?: string;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
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
}

export interface PipelineDiagnostics {
  modelName: string;
  modelPath: string;
  modelFileSize: number;
  modelStatus?: string;
  runtimeStatus?: string;
  inputShape: number[];
  inputLayout: string;
  inputDataType: string;
  outputShape: number[];
  outputDataType: string;
  rawOutputLength?: number;
  rawPredictionsCount: number;
  confidenceThreshold: number;
  aboveThresholdCount: number;
  afterNmsCount: number;
  suppressedCount: number;
  finalObjectCount?: Record<string, number>;
  preprocessTimeMs: number;
  inferenceTimeMs: number;
  nmsTimeMs: number;
  totalTimeMs: number;
  nmsThreshold: number;
  timestamp: string;
  errorMessage?: string | null;
  // Extended runtime diagnostics emitted by modelService.
  modelLoaded?: boolean;
  fileSizeBytes?: number;
  inputTensorDetails?: {
    name: string;
    shape: readonly number[];
    dataType: string;
    layout: string;
  };
  outputTensorDetails?: {
    name: string;
    shape: readonly number[];
    dataType: string;
  };
  totalAnchorsEvaluated?: number;
  rawCandidatesAboveThreshold?: number;
  finalDetectionsAfterNMS?: number;
  preprocTimeMs?: number;
  postprocTimeMs?: number;
  confidenceThresholdUsed?: number;
  nmsThresholdUsed?: number;
  executionBackend?: string;
}

export interface ScanRecord {
  id: string;
  type: 'webcam' | 'upload';
  location: ValidLocation;
  user: string;
  team?: string;
  itemsDetected: Array<{ className: string; quantity: number; confidence: number }>;
  totalQuantity: number;
  status: 'Confirmed' | 'Discrepancy Flagged' | 'Pending Review';
  timestamp: string;
  notes?: string;
  previewUrl?: string;
}

export interface StockCheckItem {
  name: string;
  category: string;
  expected: number;
  detected: number;
  difference: number;
  variance: number;
  status: 'Matched' | 'Short' | 'Extra';
}

export interface StockCheckRecord {
  id: string;
  location: ValidLocation;
  operator: string;
  user?: string;
  team?: string;
  matchedCount: number;
  discrepancyCount: number;
  timestamp: string;
  confirmedAt: string;
  notes?: string;
  items: StockCheckItem[];
}

export interface UserAccount {
  userId: string;
  userName: string;
  teamName: string;
}

export interface YOLOClassLabel {
  id: string;
  index: number;
  label: string;
  category: string;
  displayName?: string;
  quantityPerDetection?: number;
  enabled?: boolean;
}

export type EngineMode = 'Real TFLite Model Mode' | 'Demo Simulation Mode';

export interface ModelConfig {
  modelPath: string;
  engineMode: EngineMode;
  confidenceThreshold: number;
  nmsThreshold: number;
  labels?: YOLOClassLabel[];
  classes?: YOLOClassLabel[];
  inputResolution?: number;
  maxDetections?: number;
  inputWidth?: number;
  inputHeight?: number;
}

export interface OfflineMutation {
  id: string;
  action: 'SCAN' | 'CHECKOUT' | 'CHECKIN' | 'STOCK_CHECK' | 'UPDATE_ITEM';
  timestamp: string;
  payload: any;
}

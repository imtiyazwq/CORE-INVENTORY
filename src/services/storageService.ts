import {
  InventoryItem,
  ScanRecord,
  StockCheckRecord,
  ModelConfig,
  OfflineMutation,
  ValidLocation,
} from '../types';
import { REAL_INVENTORY_DATASET, INVENTORY_DATASET_VERSION } from '../data/realInventoryData';
import { DEFAULT_MODEL_CONFIG, DEFAULT_YOLO_LABELS } from './modelService';

export interface StorageState {
  items: InventoryItem[];
  scanHistory: ScanRecord[];
  stockChecks: StockCheckRecord[];
  modelConfig: ModelConfig;
  pendingMutations: OfflineMutation[];
  isOnline: boolean;
  simulatedOffline: boolean;
  lastSyncedAt: string;
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const apiUrl = (path: string) => `${API_BASE}${path}`;

class StorageService {
  private items: InventoryItem[] = [];
  private scanHistory: ScanRecord[] = [];
  private stockChecks: StockCheckRecord[] = [];
  private modelConfig: ModelConfig = { ...DEFAULT_MODEL_CONFIG };
  private pendingMutations: OfflineMutation[] = [];
  private isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private simulatedOffline = false;
  private lastSyncedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  private listeners = new Set<(state: StorageState) => void>();
  private initializedLocal = false;

  constructor() {
    this.loadLocalCache();
    this.setupNetworkListeners();
  }

  public getState(): StorageState {
    return {
      items: [...this.items],
      scanHistory: [...this.scanHistory],
      stockChecks: [...this.stockChecks],
      modelConfig: { ...this.modelConfig },
      pendingMutations: [...this.pendingMutations],
      isOnline: this.simulatedOffline ? false : this.isOnline,
      simulatedOffline: this.simulatedOffline,
      lastSyncedAt: this.lastSyncedAt,
    };
  }

  public subscribe(listener: (state: StorageState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const snapshot = this.getState();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private loadLocalCache(): void {
    try {
      const items = localStorage.getItem('visionstock_cache_items');
      const scans = localStorage.getItem('visionstock_cache_scans');
      const checks = localStorage.getItem('visionstock_cache_checks');
      const config = localStorage.getItem('visionstock_cache_config');
      const queue = localStorage.getItem('visionstock_cache_queue');
      const sync = localStorage.getItem('visionstock_cache_last_sync');

      this.items = items ? JSON.parse(items) : [...REAL_INVENTORY_DATASET];
      this.scanHistory = scans ? JSON.parse(scans) : [];
      this.stockChecks = checks ? JSON.parse(checks) : [];
      this.pendingMutations = queue ? JSON.parse(queue) : [];
      this.lastSyncedAt = sync || this.lastSyncedAt;

      if (config) {
        const parsed = JSON.parse(config);
        const savedLabels = Array.isArray(parsed.labels) ? parsed.labels : [];
        const official = DEFAULT_YOLO_LABELS.map((defaultLabel) => {
          const saved = savedLabels.find(
            (label: any) => label.label === defaultLabel.label || label.index === defaultLabel.index
          );
          return { ...defaultLabel, ...(saved || {}) };
        });
        const custom = savedLabels.filter(
          (label: any) => !DEFAULT_YOLO_LABELS.some((officialLabel) => officialLabel.label === label.label)
        );
        const labels = [...official, ...custom];
        this.modelConfig = {
          ...DEFAULT_MODEL_CONFIG,
          ...parsed,
          labels,
          classes: labels,
        };
      }
      this.initializedLocal = true;
    } catch (error) {
      console.error('[StorageService] Local cache load failed:', error);
      this.items = [...REAL_INVENTORY_DATASET];
      this.scanHistory = [];
      this.stockChecks = [];
    }
  }

  private persistLocalCache(): void {
    try {
      localStorage.setItem('visionstock_cache_items', JSON.stringify(this.items));
      localStorage.setItem('visionstock_cache_scans', JSON.stringify(this.scanHistory));
      localStorage.setItem('visionstock_cache_checks', JSON.stringify(this.stockChecks));
      localStorage.setItem('visionstock_cache_config', JSON.stringify(this.modelConfig));
      localStorage.setItem('visionstock_cache_queue', JSON.stringify(this.pendingMutations));
      localStorage.setItem('visionstock_cache_last_sync', this.lastSyncedAt);
    } catch (error) {
      console.error('[StorageService] Local cache save failed:', error);
    }
    this.notify();
  }

  private queueMutation(action: OfflineMutation['action'], payload: any): void {
    this.pendingMutations.push({
      id: `mut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action,
      timestamp: new Date().toISOString(),
      payload,
    });
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    return fetch(apiUrl(path), {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
  }

  private async sendMutation(path: string, method: string, payload: any): Promise<boolean> {
    if (!this.isOnline || this.simulatedOffline) return false;
    try {
      const response = await this.request(path, {
        method,
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await response.text());
      this.lastSyncedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      this.pendingMutations = [];
      this.persistLocalCache();
      return true;
    } catch (error) {
      console.error(`[StorageService] ${method} ${path} failed:`, error);
      return false;
    }
  }

  public async refreshFromCloud(): Promise<boolean> {
    if (!this.isOnline || this.simulatedOffline) return false;
    try {
      const response = await this.request('/api/state', { method: 'GET' });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();

      if (Array.isArray(data.items)) this.items = data.items;
      if (Array.isArray(data.scanHistory)) this.scanHistory = data.scanHistory;
      if (Array.isArray(data.stockChecks)) this.stockChecks = data.stockChecks;
      if (data.modelConfig) {
        this.modelConfig = {
          ...DEFAULT_MODEL_CONFIG,
          ...data.modelConfig,
          labels: data.modelConfig.labels || DEFAULT_YOLO_LABELS,
          classes: data.modelConfig.classes || data.modelConfig.labels || DEFAULT_YOLO_LABELS,
        };
      }

      // Keep the server seed synchronized with the exact spreadsheet dataset.
      // A version mismatch happens only when we intentionally ship a new factory dataset.
      // The force reseed runs once per dataset version, preventing stale 0/0 or shifted rows
      // from surviving in SQLite/PostgreSQL after a deployment.
      if (data.initialized === false || data.datasetVersion !== INVENTORY_DATASET_VERSION) {
        await this.seedExactDataset(data.initialized !== false);
        this.items = [...REAL_INVENTORY_DATASET];
        this.scanHistory = [];
        this.stockChecks = [];
      }

      this.lastSyncedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      this.pendingMutations = [];
      this.persistLocalCache();
      return true;
    } catch (error) {
      console.error('[StorageService] Cloud refresh failed:', error);
      return false;
    }
  }

  private async seedExactDataset(force: boolean): Promise<void> {
    const response = await this.request('/api/seed', {
      method: 'POST',
      body: JSON.stringify({
        items: REAL_INVENTORY_DATASET,
        force,
        datasetVersion: INVENTORY_DATASET_VERSION,
      }),
    });
    if (!response.ok) throw new Error(await response.text());
  }

  private setupNetworkListeners(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.refreshFromCloud();
      this.notify();
    });
    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.notify();
    });
  }

  public addItem(item: InventoryItem): void {
    this.items.push(item);
    this.queueMutation('UPDATE_ITEM', item);
    this.persistLocalCache();
    void this.sendMutation('/api/inventory/item', 'POST', { item });
  }

  public updateItem(item: InventoryItem): void {
    const index = this.items.findIndex((current) => current.id === item.id);
    if (index === -1) return;
    this.items[index] = { ...item };
    this.queueMutation('UPDATE_ITEM', item);
    this.persistLocalCache();
    void this.sendMutation('/api/inventory/item', 'PUT', { item });
  }

  public checkoutItem(itemId: string, user: string, team: string, qty: number): void {
    const item = this.items.find((current) => current.id === itemId);
    if (!item) return;

    const requestedQty = Math.max(0, Math.floor(Number(qty) || 0));
    if (requestedQty <= 0 || item.availableQuantity <= 0) return;

    const now = new Date().toISOString();
    const deduction = Math.min(item.availableQuantity, requestedQty);
    item.availableQuantity = Math.max(0, item.availableQuantity - deduction);

    // Checkout is a movement state, not a disposal event. Keep the row Available
    // while some stock remains, and mark it Checked Out only when all currently
    // available units are out. Condition statuses such as Damaged/Disposed are
    // separate from checkout.
    item.status = item.availableQuantity === 0 ? 'Checked Out' : 'Available';
    item.user = user;
    item.team = team;
    item.checkedOutAt = now;
    item.lastSeen = now.slice(0, 10);

    this.queueMutation('CHECKOUT', { itemId, user, team, qty: deduction });
    this.persistLocalCache();
    void this.sendMutation('/api/inventory/checkout', 'POST', { itemId, user, team, qty: deduction });
  }

  public checkinItem(itemId: string, returnLocation: ValidLocation, qty: number): void {
    const item = this.items.find((current) => current.id === itemId);
    if (!item) return;

    const requestedQty = Math.max(0, Math.floor(Number(qty) || 0));
    if (requestedQty <= 0) return;

    const now = new Date().toISOString();
    item.location = returnLocation;
    item.lastSeen = now.slice(0, 10);

    const outstandingQty = Math.max(0, item.quantity - item.availableQuantity);
    const returnedQty = Math.min(outstandingQty, requestedQty);
    item.availableQuantity = Math.min(item.quantity, item.availableQuantity + returnedQty);

    if (item.availableQuantity >= item.quantity) {
      item.status = 'Available';
      item.user = undefined;
      item.team = undefined;
      item.checkedOutAt = undefined;
    } else {
      item.status = 'Checked Out';
    }

    this.queueMutation('CHECKIN', { itemId, returnLocation, qty: requestedQty });
    this.persistLocalCache();
    void this.sendMutation('/api/inventory/checkin', 'POST', { itemId, returnLocation, qty: requestedQty });
  }

  public addScanRecord(scan: Omit<ScanRecord, 'id' | 'timestamp'>): void {
    const now = new Date();
    const record: ScanRecord = {
      ...scan,
      id: `SCAN-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      timestamp: `${now.toISOString().slice(0, 10)} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    };

    this.scanHistory.unshift(record);
    this.queueMutation('SCAN', record);
    this.persistLocalCache();
    void this.sendMutation('/api/scans', 'POST', { scan: record });
  }

  public addStockCheck(record: Omit<StockCheckRecord, 'id' | 'timestamp'>, applyToInventory = true): void {
    const now = new Date();
    const newRecord: StockCheckRecord = {
      ...record,
      id: `SC-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      timestamp: `${now.toISOString().slice(0, 10)} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    };

    this.stockChecks.unshift(newRecord);

    if (applyToInventory) {
      newRecord.items.forEach((audit) => {
        const item = this.items.find(
          (candidate) =>
            candidate.location === newRecord.location &&
            candidate.name.trim().toLowerCase() === audit.name.trim().toLowerCase()
        );
        if (item) {
          // A stock check verifies physical on-hand stock, so reconcile the
          // available quantity. Keep the overall ledger total unless the audit finds
          // more units than the current total, in which case expand the total so the
          // invariant availableQuantity <= quantity remains valid.
          const detectedAvailable = Math.max(0, Math.floor(Number(audit.detected) || 0));
          item.availableQuantity = detectedAvailable;
          if (detectedAvailable > item.quantity) item.quantity = detectedAvailable;

          item.lastSeen = now.toISOString().slice(0, 10);
          if (item.availableQuantity > 0) {
            item.status = 'Available';
          } else if (item.assetType === 'Consumable') {
            item.status = 'Disposed';
          } else if (item.user || item.checkedOutAt) {
            item.status = 'Checked Out';
          } else {
            item.status = 'Missing';
          }
          item.remarks = audit.status === 'Matched' ? 'Verified by stock check' : audit.name;
        }
      });
    }

    this.queueMutation('STOCK_CHECK', newRecord);
    this.persistLocalCache();
    void this.sendMutation('/api/stock-check', 'POST', { stockCheck: newRecord, applyToInventory });
  }

  public syncQueue(): { syncedCount: number; timestamp: string } {
    const count = this.pendingMutations.length;
    if (count > 0) {
      void this.refreshFromCloud();
    }
    this.lastSyncedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.persistLocalCache();
    return { syncedCount: count, timestamp: this.lastSyncedAt };
  }

  public toggleSimulatedOffline(): void {
    this.simulatedOffline = !this.simulatedOffline;
    if (!this.simulatedOffline) void this.refreshFromCloud();
    this.notify();
  }

  public updateModelConfig(config: Partial<ModelConfig>): void {
    this.modelConfig = { ...this.modelConfig, ...config };
    this.persistLocalCache();
    void this.sendMutation('/api/model-config', 'PUT', { modelConfig: this.modelConfig });
  }

  public exportJSON(): string {
    return JSON.stringify({
      version: '4.0',
      exportedAt: new Date().toISOString(),
      items: this.items,
      scanHistory: this.scanHistory,
      stockChecks: this.stockChecks,
      modelConfig: this.modelConfig,
    }, null, 2);
  }

  public importJSON(jsonString: string): { success: boolean; itemCount: number; message?: string } {
    try {
      const data = JSON.parse(jsonString);
      if (!data || !Array.isArray(data.items)) {
        return { success: false, itemCount: 0, message: 'Invalid JSON format: missing "items" array.' };
      }
      this.items = data.items;
      this.scanHistory = Array.isArray(data.scanHistory) ? data.scanHistory : [];
      this.stockChecks = Array.isArray(data.stockChecks) ? data.stockChecks : [];
      this.modelConfig = data.modelConfig ? { ...DEFAULT_MODEL_CONFIG, ...data.modelConfig } : this.modelConfig;
      this.persistLocalCache();
      void this.sendMutation('/api/state/import', 'POST', {
        items: this.items,
        scanHistory: this.scanHistory,
        stockChecks: this.stockChecks,
        modelConfig: this.modelConfig,
      });
      return { success: true, itemCount: this.items.length };
    } catch (error: any) {
      return { success: false, itemCount: 0, message: error?.message || 'Malformed JSON string.' };
    }
  }

  public clearAllData(): void {
    this.items = [];
    this.scanHistory = [];
    this.stockChecks = [];
    this.pendingMutations = [];
    this.lastSyncedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.persistLocalCache();
    void this.sendMutation('/api/state/clear', 'POST', {});
  }

  public resetToFactoryDataset(): void {
    this.items = [...REAL_INVENTORY_DATASET];
    this.scanHistory = [];
    this.stockChecks = [];
    this.pendingMutations = [];
    this.persistLocalCache();
    void this.sendMutation('/api/seed', 'POST', {
      items: REAL_INVENTORY_DATASET,
      force: true,
      datasetVersion: INVENTORY_DATASET_VERSION,
    });
  }

  public loadRealDataset(): void {
    this.resetToFactoryDataset();
  }

  public exportBackupJSON(): void {
    const blob = new Blob([this.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `core_inventory_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  public importBackupJSON(jsonString: string): { success: boolean; itemCount: number; message?: string } {
    return this.importJSON(jsonString);
  }
}

export const storageService = new StorageService();

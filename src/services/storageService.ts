import {
  InventoryItem,
  ScanRecord,
  StockCheckRecord,
  OfflineMutation,
  StorageLedger,
  ModelConfig,
  ValidLocation,
} from '../types';
import { INITIAL_INVENTORY_ITEMS } from '../data/initialInventory';
import { VALID_LOCATIONS } from '../data/locations';
import { DEFAULT_MODEL_CONFIG } from './modelService';

const STORAGE_KEY = 'ai_inventory_ledger_v1';
const NETWORK_OVERRIDE_KEY = 'ai_inventory_network_override';

export interface StorageState {
  items: InventoryItem[];
  scanHistory: ScanRecord[];
  stockChecks: StockCheckRecord[];
  modelConfig: ModelConfig;
  pendingMutations: OfflineMutation[];
  lastSyncedAt: string;
  isOnline: boolean;
  simulatedOffline: boolean;
}

type Subscriber = (state: StorageState) => void;

class StorageService {
  private state: StorageState;
  private subscribers: Set<Subscriber> = new Set();

  constructor() {
    this.state = this.loadInitialState();
    this.initNetworkListeners();
  }

  private loadInitialState(): StorageState {
    const isOnlineActual = typeof navigator !== 'undefined' ? navigator.onLine : true;
    const simulatedOffline = localStorage.getItem(NETWORK_OVERRIDE_KEY) === 'true';

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: StorageLedger = JSON.parse(stored);
        if (Array.isArray(parsed.items)) {
          // Cleanse items to filter out any mock initial inventory items (INV-001 to INV-109)
          const isMockItem = (it: InventoryItem) => /^INV-(0[0-9]{2}|10[0-9])$/.test(it.id);
          const validItems = parsed.items
            .filter((it) => !isMockItem(it))
            .map((it) => ({
              ...it,
              location: VALID_LOCATIONS.includes(it.location)
                ? it.location
                : VALID_LOCATIONS[0],
            }));

          const realScans = Array.isArray(parsed.scanHistory)
            ? parsed.scanHistory.filter((s) => !s.id.startsWith('scan-10') && !s.id.startsWith('scan-seed'))
            : [];
          const realStockChecks = Array.isArray(parsed.stockChecks)
            ? parsed.stockChecks.filter((c) => !c.id.startsWith('chk-20') && !c.id.startsWith('chk-seed'))
            : [];

          return {
            items: validItems,
            scanHistory: realScans,
            stockChecks: realStockChecks,
            modelConfig: parsed.modelConfig || DEFAULT_MODEL_CONFIG,
            pendingMutations: Array.isArray(parsed.pendingMutations) ? parsed.pendingMutations : [],
            lastSyncedAt: parsed.lastUpdated || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            isOnline: simulatedOffline ? false : isOnlineActual,
            simulatedOffline,
          };
        }
      }
    } catch (e) {
      console.warn('[StorageService] Failed to parse local ledger, loading clean state:', e);
    }

    return {
      items: [],
      scanHistory: [],
      stockChecks: [],
      modelConfig: { ...DEFAULT_MODEL_CONFIG },
      pendingMutations: [],
      lastSyncedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isOnline: simulatedOffline ? false : isOnlineActual,
      simulatedOffline,
    };
  }

  private getSeedScanHistory(): ScanRecord[] {
    return [];
  }

  private getSeedStockChecks(): StockCheckRecord[] {
    return [];
  }

  private initNetworkListeners(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('online', () => {
      if (!this.state.simulatedOffline) {
        this.updateState({ isOnline: true });
        this.syncQueue();
      }
    });

    window.addEventListener('offline', () => {
      this.updateState({ isOnline: false });
    });
  }

  private persist(): void {
    try {
      const ledger: StorageLedger = {
        version: '1.0.0',
        lastUpdated: this.state.lastSyncedAt,
        items: this.state.items,
        scanHistory: this.state.scanHistory,
        stockChecks: this.state.stockChecks,
        modelConfig: this.state.modelConfig,
        pendingMutations: this.state.pendingMutations,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
    } catch (e) {
      console.error('[StorageService] Failed to persist ledger to localStorage:', e);
    }
  }

  private updateState(partial: Partial<StorageState>): void {
    this.state = { ...this.state, ...partial };
    this.persist();
    this.notify();
  }

  private notify(): void {
    const currentState = { ...this.state };
    this.subscribers.forEach((sub) => sub(currentState));
  }

  public subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber({ ...this.state });
    return () => this.subscribers.delete(subscriber);
  }

  public getState(): StorageState {
    return { ...this.state };
  }

  /**
   * Records a mutation to the ledger. If offline or simulated offline,
   * enqueues into pendingMutations.
   */
  private recordMutation(action: OfflineMutation['action'], payload: any): void {
    const now = new Date().toISOString();
    const mutation: OfflineMutation = {
      id: `mut-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: now,
      action,
      payload,
      synced: this.state.isOnline,
    };

    let newPending = [...this.state.pendingMutations];
    if (!this.state.isOnline) {
      newPending.push(mutation);
    } else {
      this.state.lastSyncedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    this.updateState({ pendingMutations: newPending });
  }

  // --- CRUD & Business Operations ---

  public addItem(item: InventoryItem): void {
    const items = [item, ...this.state.items];
    this.recordMutation('UPDATE_ITEM', item);
    this.updateState({ items });
  }

  public deleteItem(itemId: string): void {
    const items = this.state.items.filter((it) => it.id !== itemId);
    this.updateState({ items });
  }

  public clearAllInventory(): void {
    this.updateState({ items: [] });
  }

  public updateItem(updatedItem: InventoryItem): void {
    const items = this.state.items.map((it) =>
      it.id === updatedItem.id ? updatedItem : it
    );
    this.recordMutation('UPDATE_ITEM', updatedItem);
    this.updateState({ items });
  }

  public checkoutItem(
    itemId: string,
    user: string,
    team: string,
    checkoutQty: number = 1
  ): void {
    const now = new Date();
    const formattedDate = `${now.toISOString().slice(0, 10)} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    const items = this.state.items.map((item) => {
      if (item.id !== itemId) return item;

      if (item.assetType === 'Consumable') {
        // Consumable: Available quantity decreases
        const newAvailable = Math.max(0, item.availableQuantity - checkoutQty);
        return {
          ...item,
          availableQuantity: newAvailable,
          user: user.trim() || item.user,
          team: team.trim() || item.team,
          checkedOutAt: now.toISOString(),
          lastSeen: formattedDate,
          status: newAvailable === 0 ? ('Checked Out' as const) : ('Available' as const),
        };
      } else {
        // Non-Consumable: Track individual checkout info
        return {
          ...item,
          availableQuantity: 0,
          status: 'Checked Out' as const,
          user: user.trim(),
          team: team.trim(),
          checkedOutAt: now.toISOString(),
          lastSeen: formattedDate,
        };
      }
    });

    this.recordMutation('CHECKOUT', { itemId, user, team, checkoutQty });
    this.updateState({ items });
  }

  public checkinItem(itemId: string, returnLocation: ValidLocation, returnQty: number = 1): void {
    const now = new Date();
    const formattedDate = `${now.toISOString().slice(0, 10)} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    const items = this.state.items.map((item) => {
      if (item.id !== itemId) return item;

      if (item.assetType === 'Consumable') {
        const newAvailable = Math.min(item.quantity, item.availableQuantity + returnQty);
        return {
          ...item,
          availableQuantity: newAvailable,
          location: returnLocation,
          lastSeen: formattedDate,
          status: 'Available' as const,
        };
      } else {
        return {
          ...item,
          availableQuantity: 1,
          status: 'Available' as const,
          location: returnLocation,
          user: undefined,
          team: undefined,
          checkedOutAt: undefined,
          lastSeen: formattedDate,
        };
      }
    });

    this.recordMutation('CHECKIN', { itemId, returnLocation, returnQty });
    this.updateState({ items });
  }

  public addScanRecord(scan: Omit<ScanRecord, 'id' | 'timestamp'>): ScanRecord {
    const record: ScanRecord = {
      ...scan,
      id: `scan-${Date.now()}`,
      timestamp: `${new Date().toISOString().slice(0, 10)} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    };

    const scanHistory = [record, ...this.state.scanHistory];
    this.recordMutation('CONFIRM_SCAN', record);
    this.updateState({ scanHistory });
    return record;
  }

  public addStockCheckRecord(check: Omit<StockCheckRecord, 'id' | 'timestamp'>): StockCheckRecord {
    const record: StockCheckRecord = {
      ...check,
      id: `chk-${Date.now()}`,
      timestamp: `${new Date().toISOString().slice(0, 10)} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    };

    const stockChecks = [record, ...this.state.stockChecks];
    this.recordMutation('STOCK_CHECK', record);
    this.updateState({ stockChecks });
    return record;
  }

  public updateModelConfig(config: Partial<ModelConfig>): void {
    const modelConfig = { ...this.state.modelConfig, ...config };
    this.updateState({ modelConfig });
  }

  // --- Offline & Sync Operations ---

  public toggleSimulatedOffline(): void {
    const nextState = !this.state.simulatedOffline;
    localStorage.setItem(NETWORK_OVERRIDE_KEY, String(nextState));
    const isOnlineActual = typeof navigator !== 'undefined' ? navigator.onLine : true;
    this.updateState({
      simulatedOffline: nextState,
      isOnline: nextState ? false : isOnlineActual,
    });
  }

  public syncQueue(): { syncedCount: number; timestamp: string } {
    const count = this.state.pendingMutations.length;
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    this.updateState({
      pendingMutations: [],
      lastSyncedAt: now,
    });

    return { syncedCount: count, timestamp: now };
  }

  // --- Backup & Restore ---

  public exportJSON(): string {
    const ledger: StorageLedger = {
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      items: this.state.items,
      scanHistory: this.state.scanHistory,
      stockChecks: this.state.stockChecks,
      modelConfig: this.state.modelConfig,
      pendingMutations: this.state.pendingMutations,
    };
    return JSON.stringify(ledger, null, 2);
  }

  public importJSON(jsonString: string): { success: boolean; itemCount: number; message?: string } {
    try {
      const parsed = JSON.parse(jsonString);

      if (!parsed || !Array.isArray(parsed.items)) {
        throw new Error('Invalid JSON format: missing "items" array.');
      }

      if (parsed.items.length === 0) {
        throw new Error('Import dataset contains 0 items.');
      }

      // Strict validation of items and locations
      const validatedItems: InventoryItem[] = parsed.items.map((it: any, idx: number) => {
        if (!it.id || !it.name || it.quantity === undefined) {
          throw new Error(`Item at row ${idx + 1} is missing required fields (id, name, quantity).`);
        }

        // Guarantee 4 valid locations rule
        const location: ValidLocation = VALID_LOCATIONS.includes(it.location)
          ? it.location
          : VALID_LOCATIONS[0];

        return {
          id: String(it.id),
          itemCode: it.itemCode || `ITEM-${idx + 1}`,
          name: String(it.name),
          category: it.category || 'Office Supplies',
          subCategory: it.subCategory || '',
          specification: it.specification || '',
          assetType: it.assetType === 'Consumable' ? 'Consumable' : 'Non-Consumable',
          quantity: Number(it.quantity) || 1,
          availableQuantity: it.availableQuantity !== undefined ? Number(it.availableQuantity) : Number(it.quantity) || 1,
          location,
          rackShelf: it.rackShelf || 'DEFAULT',
          status: it.status || 'Available',
          user: it.user || undefined,
          team: it.team || undefined,
          checkedOutAt: it.checkedOutAt || undefined,
          lastSeen: it.lastSeen || new Date().toISOString().slice(0, 16),
          lastStocktakeDate: it.lastStocktakeDate || undefined,
          remarks: it.remarks || '',
        };
      });

      this.updateState({
        items: validatedItems,
        scanHistory: Array.isArray(parsed.scanHistory) ? parsed.scanHistory : [],
        stockChecks: Array.isArray(parsed.stockChecks) ? parsed.stockChecks : [],
        pendingMutations: [],
        lastSyncedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });

      return {
        success: true,
        itemCount: validatedItems.length,
      };
    } catch (err) {
      return {
        success: false,
        itemCount: 0,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public resetToFactoryDataset(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.updateState({
      items: [],
      scanHistory: [],
      stockChecks: [],
      modelConfig: { ...DEFAULT_MODEL_CONFIG },
      pendingMutations: [],
      lastSyncedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
  }
}

export const storageService = new StorageService();

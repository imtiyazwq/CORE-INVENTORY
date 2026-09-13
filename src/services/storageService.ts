// src/services/storageService.ts
import { db, authReady } from './firebase';
import { collection, getDocs } from 'firebase/firestore';
import {
  InventoryItem,
  ScanRecord,
  OfflineMutation,
  StorageLedger,
  ModelConfig,
  ValidLocation,
} from '../types';
import { VALID_LOCATIONS } from '../data/locations';
import { DEFAULT_MODEL_CONFIG } from './modelService';

// Read the flag from environment variables
const USE_FIREBASE = import.meta.env.VITE_USE_FIREBASE === 'true';
const STORAGE_KEY = 'core_inventory_ledger_v2';
const NETWORK_OVERRIDE_KEY = 'core_inventory_network_override';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StorageState {
  items: InventoryItem[];
  scanHistory: ScanRecord[];
  modelConfig: ModelConfig;
  pendingMutations: OfflineMutation[];
  lastSyncedAt: string;
  isOnline: boolean;
  simulatedOffline: boolean;
}

type Subscriber = (state: StorageState) => void;

// ---------------------------------------------------------------------------
// TransactionPayload — shape expected by /api/inventory/transaction
// and buffered in pendingMutations when offline
// ---------------------------------------------------------------------------
export interface TransactionPayload {
  sku: string;
  store_name: string;
  action: 'IN' | 'OUT' | 'ADJUSTMENT';
  qty_changed: number;
}

export const getInventory = async (): Promise<InventoryItem[]> => {
  await storageService.fetchInventory();
  return storageService.getState().items;
};

// ---------------------------------------------------------------------------
// StorageService
// ---------------------------------------------------------------------------

class StorageService {
  private state: StorageState;
  private subscribers: Set<Subscriber> = new Set();

  constructor() {
    this.state = this.loadInitialState();
    this.initNetworkListeners();
    // Bootstrap inventory fetch from backend if running in browser
    if (typeof window !== 'undefined') {
      this.fetchInventory().catch((err) =>
        console.warn('[StorageService] Bootstrap fetchInventory failed:', err),
      );
    }
  }

  // --------------------------------------------------------------------------
  // State bootstrap
  // --------------------------------------------------------------------------

  private loadInitialState(): StorageState {
    const isOnlineActual = typeof navigator !== 'undefined' ? navigator.onLine : true;
    const simulatedOffline = localStorage.getItem(NETWORK_OVERRIDE_KEY) === 'true';

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: StorageLedger = JSON.parse(stored);
        if (Array.isArray(parsed.items)) {
          const validItems = parsed.items.map((it) => ({
            ...it,
            location: VALID_LOCATIONS.includes(it.location) ? it.location : VALID_LOCATIONS[0],
          }));

          return {
            items: validItems,
            scanHistory: Array.isArray(parsed.scanHistory) ? parsed.scanHistory : [],
            modelConfig: parsed.modelConfig || DEFAULT_MODEL_CONFIG,
            pendingMutations: Array.isArray(parsed.pendingMutations) ? parsed.pendingMutations : [],
            lastSyncedAt: parsed.lastUpdated || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            isOnline: simulatedOffline ? false : isOnlineActual,
            simulatedOffline,
          };
        }
      }
    } catch (e) {
      console.warn('[StorageService] Failed to parse local ledger — loading clean state:', e);
    }

    return {
      items: [],
      scanHistory: [],
      modelConfig: { ...DEFAULT_MODEL_CONFIG },
      pendingMutations: [],
      lastSyncedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isOnline: simulatedOffline ? false : isOnlineActual,
      simulatedOffline,
    };
  }

  private initNetworkListeners(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('online', () => {
      if (!this.state.simulatedOffline) {
        this.updateState({ isOnline: true });
        // Auto-flush pending mutations when connectivity is restored
        this.syncQueue().catch((err) =>
          console.warn('[StorageService] Auto-sync failed on reconnect:', err),
        );
      }
    });

    window.addEventListener('offline', () => {
      this.updateState({ isOnline: false });
    });
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  private persist(): void {
    try {
      const ledger: StorageLedger = {
        version: '2.0.0',
        lastUpdated: this.state.lastSyncedAt,
        items: this.state.items,
        scanHistory: this.state.scanHistory,
        modelConfig: this.state.modelConfig,
        pendingMutations: this.state.pendingMutations,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
    } catch (e) {
      console.error('[StorageService] Failed to persist ledger:', e);
    }
  }

  private updateState(partial: Partial<StorageState>): void {
    this.state = { ...this.state, ...partial };
    this.persist();
    this.notify();
  }

  private notify(): void {
    const s = { ...this.state };
    this.subscribers.forEach((sub) => sub(s));
  }

  /**
   * Buffer a pending transaction for offline replay.
   * When online the mutation is marked synced (it was already sent to the server).
   */
  private enqueueOfflineMutation(action: OfflineMutation['action'], payload: any): void {
    if (this.state.isOnline) {
      // Online path — mutation was (or will be) sent live; update sync timestamp
      this.updateState({
        lastSyncedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
      return;
    }

    const mutation: OfflineMutation = {
      id: `mut-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      action,
      payload,
      synced: false,
    };
    this.updateState({ pendingMutations: [...this.state.pendingMutations, mutation] });
  }

  // --------------------------------------------------------------------------
  // Public API — subscriptions & state
  // --------------------------------------------------------------------------

  public subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber({ ...this.state });
    return () => this.subscribers.delete(subscriber);
  }

  public getState(): StorageState {
    return { ...this.state };
  }

  // --------------------------------------------------------------------------
  // Public API — fetch inventory from Flask backend
  // --------------------------------------------------------------------------

  /**
   * Load inventory from GET /api/inventory and merge into local state.
   * Call this on mount after a successful login.
   */
  public async fetchInventory(storeName?: string): Promise<InventoryItem[]> {
    try {
      if (USE_FIREBASE) {
        console.log('[StorageService] Fetching from Firebase Firestore...');
        await authReady; // Firestore rules require an (anonymous) auth session to read
        const snapshot = await getDocs(collection(db, 'store_inventory'));
        const fbItems: InventoryItem[] = snapshot.docs.map((docSnap) => {
          const row = docSnap.data();
          const location: ValidLocation = VALID_LOCATIONS.includes(row.location as ValidLocation)
            ? (row.location as ValidLocation)
            : VALID_LOCATIONS.includes(row.store_name as ValidLocation)
            ? (row.store_name as ValidLocation)
            : VALID_LOCATIONS[0];
          return {
            id: row.id || docSnap.id,
            itemCode: row.itemCode || row.sku || docSnap.id,
            name: row.name || 'Unnamed Item',
            category: (row.category || 'Office Supplies') as any,
            assetType: (row.assetType === 'Non-Consumable' || row.asset_type === 'Controllable Asset') ? 'Non-Consumable' : 'Consumable',
            quantity: Number(row.quantity ?? row.qty ?? 0),
            availableQuantity: Number(row.availableQuantity ?? row.avail_qty ?? row.quantity ?? 0),
            location,
            rackShelf: row.rackShelf || 'DEFAULT',
            status: (row.status as InventoryItem['status']) || 'Available',
            lastSeen: row.lastSeen || row.last_stocktake || new Date().toISOString().slice(0, 10),
            remarks: row.remarks || '',
          } satisfies InventoryItem;
        });
        this.updateState({ items: fbItems });
        return fbItems;
      }

      const url = storeName
        ? `/api/inventory?store_name=${encodeURIComponent(storeName)}`
        : '/api/inventory';

      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        console.warn('[StorageService] fetchInventory: server returned', res.status);
        return this.state.items;
      }

      const data = await res.json();
      const rawList: any[] = Array.isArray(data)
        ? data
        : Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.inventory)
        ? data.inventory
        : [];

      const serverItems: InventoryItem[] = rawList.map((row: any) => {
        // Map server columns → frontend InventoryItem shape
        const location: ValidLocation = VALID_LOCATIONS.includes(row.store_name as ValidLocation)
          ? (row.store_name as ValidLocation)
          : VALID_LOCATIONS.includes(row.location as ValidLocation)
          ? (row.location as ValidLocation)
          : VALID_LOCATIONS[0];

        const isNonConsumable =
          row.asset_type === 'Controllable Asset' ||
          row.asset_type === 'Non-Consumable' ||
          row.assetType === 'Non-Consumable';

        return {
          id: row.sku || row.id || `ITEM-${Math.random().toString(36).substring(2, 7)}`,
          itemCode: row.sku || row.itemCode || '',
          name: row.name || row.product_name || 'Unnamed Item',
          category: (row.category || row.category_name || 'Office Supplies') as any,
          assetType: isNonConsumable ? 'Non-Consumable' : 'Consumable',
          quantity: Number(row.qty ?? row.quantity ?? 0),
          availableQuantity: Number(row.avail_qty ?? row.availableQuantity ?? row.qty ?? row.quantity ?? 0),
          location,
          rackShelf: row.rackShelf || 'DEFAULT',
          status: (row.status as InventoryItem['status']) || 'Available',
          lastSeen: row.last_stocktake || row.lastSeen || new Date().toISOString().slice(0, 10),
          remarks: row.remarks || '',
        } satisfies InventoryItem;
      });

      this.updateState({ items: serverItems });
      console.log(`[StorageService] Fetched ${serverItems.length} items from backend.`);
      return serverItems;
    } catch (e) {
      console.warn('[StorageService] fetchInventory failed (offline?) — using cached state:', e);
      return this.state.items;
    }
  }

  // --------------------------------------------------------------------------
  // Public API — post a transaction to Flask backend
  // --------------------------------------------------------------------------

  /**
   * Post an inventory transaction to POST /api/inventory/transaction.
   *
   * If online:  sends to server, updates local state optimistically.
   * If offline: applies change locally and buffers in pendingMutations for later sync.
   *
   * Returns whether the server actually accepted the transaction (e.g. an OUT
   * that exceeds available stock returns success: false with the server's
   * error message) — callers that need to show the user real success/failure
   * feedback should check this instead of assuming the promise resolving means
   * the transaction landed.
   */
  public async postTransaction(txn: TransactionPayload): Promise<{ success: boolean; error?: string }> {
    // Optimistic local update
    const delta = txn.action === 'OUT' ? -txn.qty_changed : txn.qty_changed;
    const updatedItems = this.state.items.map((item) => {
      if (item.itemCode !== txn.sku || item.location !== txn.store_name) return item;

      const newQty = Math.max(0, item.quantity + (txn.action === 'IN' ? txn.qty_changed : 0));
      const newAvail = Math.max(0, item.availableQuantity + delta);
      return {
        ...item,
        quantity: newQty,
        availableQuantity: newAvail,
        status: (newAvail > 0 ? 'Available' : 'Checked Out') as InventoryItem['status'],
        lastSeen: new Date().toISOString().slice(0, 10),
      };
    });
    this.updateState({ items: updatedItems });

    if (!this.state.isOnline) {
      // Buffer for later replay
      this.enqueueOfflineMutation('UPDATE_ITEM', txn);
      console.log('[StorageService] Offline — transaction buffered in pendingMutations.');
      return { success: true };
    }

    // Attempt live POST — writes always go through Flask, which uses the Firebase
    // Admin SDK to update Firestore server-side when USE_FIREBASE is enabled there.
    // (Firestore security rules block client-side writes entirely.)
    try {
      const res = await fetch('/api/inventory/transaction', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(txn),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('[StorageService] Transaction rejected by server:', err.error);
        // Revert optimistic update by re-fetching
        await this.fetchInventory();
        return { success: false, error: err.error || `Server returned ${res.status}` };
      }

      this.updateState({
        lastSyncedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
      return { success: true };
    } catch (networkErr) {
      // Network dropped mid-request — buffer for later
      console.warn('[StorageService] Network error — buffering transaction offline:', networkErr);
      this.enqueueOfflineMutation('UPDATE_ITEM', txn);
      return { success: true };
    }
  }

  // --------------------------------------------------------------------------
  // Public API — CRUD (local-only, used during offline or scan confirmation)
  // --------------------------------------------------------------------------

  public addItem(item: InventoryItem): void {
    const items = [item, ...this.state.items];
    this.updateState({ items });
  }

  public deleteItem(itemId: string): void {
    this.updateState({ items: this.state.items.filter((it) => it.id !== itemId) });
  }

  public clearAllInventory(): void {
    this.updateState({ items: [] });
  }

  public updateItem(updatedItem: InventoryItem): void {
    const items = this.state.items.map((it) =>
      it.id === updatedItem.id ? updatedItem : it,
    );
    this.updateState({ items });
  }

  public checkoutItem(itemId: string, user: string, team: string, checkoutQty: number = 1): void {
    const now = new Date();
    const dateStr = `${now.toISOString().slice(0, 10)} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    const items = this.state.items.map((item) => {
      if (item.id !== itemId) return item;

      if (item.assetType === 'Consumable') {
        const newAvailable = Math.max(0, item.availableQuantity - checkoutQty);
        return {
          ...item,
          availableQuantity: newAvailable,
          user: user.trim() || item.user,
          team: team.trim() || item.team,
          checkedOutAt: now.toISOString(),
          lastSeen: dateStr,
          status: (newAvailable === 0 ? 'Checked Out' : 'Available') as InventoryItem['status'],
        };
      }
      return {
        ...item,
        availableQuantity: 0,
        status: 'Checked Out' as const,
        user: user.trim(),
        team: team.trim(),
        checkedOutAt: now.toISOString(),
        lastSeen: dateStr,
      };
    });

    this.enqueueOfflineMutation('CHECKOUT', { itemId, user, team, checkoutQty });
    this.updateState({ items });
  }

  public checkinItem(itemId: string, returnLocation: ValidLocation, returnQty: number = 1): void {
    const now = new Date();
    const dateStr = `${now.toISOString().slice(0, 10)} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    const items = this.state.items.map((item) => {
      if (item.id !== itemId) return item;

      if (item.assetType === 'Consumable') {
        const newAvailable = Math.min(item.quantity, item.availableQuantity + returnQty);
        return { ...item, availableQuantity: newAvailable, location: returnLocation, lastSeen: dateStr, status: 'Available' as const };
      }
      return {
        ...item,
        availableQuantity: 1,
        status: 'Available' as const,
        location: returnLocation,
        user: undefined,
        team: undefined,
        checkedOutAt: undefined,
        lastSeen: dateStr,
      };
    });

    this.enqueueOfflineMutation('CHECKIN', { itemId, returnLocation, returnQty });
    this.updateState({ items });
  }

  public addScanRecord(scan: Omit<ScanRecord, 'id' | 'timestamp'>): ScanRecord {
    const record: ScanRecord = {
      ...scan,
      id: `scan-${Date.now()}`,
      timestamp: `${new Date().toISOString().slice(0, 10)} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    };
    this.updateState({ scanHistory: [record, ...this.state.scanHistory] });
    return record;
  }

  public updateModelConfig(config: Partial<ModelConfig>): void {
    this.updateState({ modelConfig: { ...this.state.modelConfig, ...config } });
  }

  // --------------------------------------------------------------------------
  // Public API — offline / sync
  // --------------------------------------------------------------------------

  public toggleSimulatedOffline(): void {
    const next = !this.state.simulatedOffline;
    localStorage.setItem(NETWORK_OVERRIDE_KEY, String(next));
    const isOnlineActual = typeof navigator !== 'undefined' ? navigator.onLine : true;
    this.updateState({ simulatedOffline: next, isOnline: next ? false : isOnlineActual });
  }

  /**
   * Flush all pending offline mutations to the server.
   * Each 'UPDATE_ITEM' mutation whose payload is a TransactionPayload is replayed
   * via POST /api/inventory/transaction.
   * CHECKOUT / CHECKIN mutations are posted as OUT / IN transactions respectively.
   */
  public async syncQueue(): Promise<{ syncedCount: number; timestamp: string }> {
    const pending = [...this.state.pendingMutations];
    if (pending.length === 0) {
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return { syncedCount: 0, timestamp: now };
    }

    let syncedCount = 0;
    const failed: OfflineMutation[] = [];

    for (const mutation of pending) {
      try {
        let txn: TransactionPayload | null = null;

        if (mutation.action === 'UPDATE_ITEM' && mutation.payload?.sku) {
          // Buffered postTransaction payload
          txn = mutation.payload as TransactionPayload;
        } else if (mutation.action === 'CHECKOUT' && mutation.payload?.itemId) {
          // Map checkout → OUT transaction
          const item = this.state.items.find((it) => it.id === mutation.payload.itemId);
          if (item) {
            txn = {
              sku: item.itemCode,
              store_name: item.location,
              action: 'OUT',
              qty_changed: mutation.payload.checkoutQty ?? 1,
            };
          }
        } else if (mutation.action === 'CHECKIN' && mutation.payload?.itemId) {
          const item = this.state.items.find((it) => it.id === mutation.payload.itemId);
          if (item) {
            txn = {
              sku: item.itemCode,
              store_name: mutation.payload.returnLocation ?? item.location,
              action: 'IN',
              qty_changed: mutation.payload.returnQty ?? 1,
            };
          }
        }

        if (txn) {
          const res = await fetch('/api/inventory/transaction', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(txn),
          });
          if (!res.ok) throw new Error(`Server returned ${res.status}`);
        }

        syncedCount++;
      } catch (err) {
        console.warn('[StorageService] Failed to sync mutation:', mutation.id, err);
        failed.push(mutation);
      }
    }

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.updateState({ pendingMutations: failed, lastSyncedAt: now });

    // Re-fetch authoritative state from server
    if (syncedCount > 0) {
      await this.fetchInventory();
    }

    return { syncedCount, timestamp: now };
  }

  // --------------------------------------------------------------------------
  // Public API — backup / restore
  // --------------------------------------------------------------------------

  public exportJSON(): string {
    return JSON.stringify(
      {
        version: '2.0.0',
        lastUpdated: new Date().toISOString(),
        items: this.state.items,
        scanHistory: this.state.scanHistory,
        modelConfig: this.state.modelConfig,
        pendingMutations: this.state.pendingMutations,
      } satisfies StorageLedger,
      null,
      2,
    );
  }

  public importJSON(jsonString: string): { success: boolean; itemCount: number; message?: string } {
    try {
      const parsed = JSON.parse(jsonString);
      if (!parsed || !Array.isArray(parsed.items)) throw new Error('Missing "items" array.');
      if (parsed.items.length === 0) throw new Error('Import dataset contains 0 items.');

      const validatedItems: InventoryItem[] = parsed.items.map((it: any, idx: number) => {
        if (!it.id || !it.name || it.quantity === undefined) {
          throw new Error(`Row ${idx + 1} is missing required fields (id, name, quantity).`);
        }
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
        } satisfies InventoryItem;
      });

      this.updateState({
        items: validatedItems,
        scanHistory: Array.isArray(parsed.scanHistory) ? parsed.scanHistory : [],
        pendingMutations: [],
        lastSyncedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });

      return { success: true, itemCount: validatedItems.length };
    } catch (err) {
      return { success: false, itemCount: 0, message: err instanceof Error ? err.message : String(err) };
    }
  }

  public resetToFactoryDataset(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.updateState({
      items: [],
      scanHistory: [],
      modelConfig: { ...DEFAULT_MODEL_CONFIG },
      pendingMutations: [],
      lastSyncedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
  }
}

export const storageService = new StorageService();

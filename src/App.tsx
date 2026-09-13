import React, { useState, useEffect } from 'react';
import { Sidebar, PageId } from './components/Sidebar';
import { HeaderBar } from './components/HeaderBar';
import { DashboardPage } from './pages/DashboardPage';
import { InventoryPage } from './pages/InventoryPage';
import { ScanInventoryPage } from './pages/ScanInventoryPage';
import { ActivityHistoryPage } from './pages/ActivityHistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { AuthPage } from './components/AuthPage.tsx';
import { storageService, StorageState, TransactionPayload } from './services/storageService';
import { authService } from './services/authService';
import { ValidLocation, ModelConfig, UserAccount } from './types';
import { VALID_LOCATIONS } from './data/locations';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

interface Toast {
  id: string;
  type: 'success' | 'info' | 'warning';
  title: string;
  message?: string;
}

export default function App() {
  const [currentUser, setCurrentUser]   = useState<UserAccount | null>(() => authService.getCurrentUser());
  const [activePage,  setActivePage]    = useState<PageId>('dashboard');
  const [scanLocation, setScanLocation] = useState<ValidLocation>(VALID_LOCATIONS[0]);
  const [scanMode, setScanMode]         = useState<'webcam' | 'upload'>('webcam');
  const [storageState, setStorageState] = useState<StorageState>(storageService.getState());
  const [toasts, setToasts]             = useState<Toast[]>([]);

  // Subscribe to storage updates
  useEffect(() => {
    const unsubscribe = storageService.subscribe((newState) => {
      setStorageState(newState);
    });
    return () => unsubscribe();
  }, []);

  // Fetch authoritative inventory from server on mount and user session change
  useEffect(() => {
    storageService.fetchInventory().catch((err) =>
      console.warn('[App] Initial inventory fetch failed:', err),
    );
  }, [currentUser]);

  // ---------------------------------------------------------------------------
  // Toast helpers
  // ---------------------------------------------------------------------------

  const addToast = (type: 'success' | 'info' | 'warning', title: string, message?: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // ---------------------------------------------------------------------------
  // Auth handlers
  // ---------------------------------------------------------------------------

  const handleLoginSuccess = (user: UserAccount) => {
    setCurrentUser(user);
    addToast('success', `Welcome back, ${user.userName}!`, `Active in ${user.teamName}`);
  };

  const handleLogout = () => {
    authService.logout();
    setCurrentUser(null);
    addToast('info', 'Logged Out', 'You have been safely signed out.');
  };

  // ---------------------------------------------------------------------------
  // Navigation handlers
  // ---------------------------------------------------------------------------

  const handleNavigate = (page: PageId, mode?: 'webcam' | 'upload') => {
    if (mode) setScanMode(mode);
    setActivePage(page);
  };

  const handleNavigateToScanWithLocation = (loc: ValidLocation) => {
    setScanLocation(loc);
    setActivePage('scan');
  };

  // ---------------------------------------------------------------------------
  // Inventory handlers
  // ---------------------------------------------------------------------------

  const handleCheckout = (itemId: string, user: string, team: string, qty: number) => {
    storageService.checkoutItem(itemId, user, team, qty);
    addToast('success', 'Asset Checked Out', `Assigned to ${user} (${team})`);
  };

  const handleCheckin = (itemId: string, returnLocation: ValidLocation, qty: number) => {
    storageService.checkinItem(itemId, returnLocation, qty);
    addToast('success', 'Asset Checked In', `Returned to ${returnLocation}`);
  };

  const handleStockAdjusted = (message: string) => {
    addToast('success', 'Stock Updated', message);
  };

  // ---------------------------------------------------------------------------
  // handleScanConfirmed — manual entry via ScanInventoryPage
  // Calls storageService.postTransaction() instead of the old CV detection API.
  // ---------------------------------------------------------------------------

  const handleScanConfirmed = async (data: {
    location:       ValidLocation;
    confirmedItems: Array<{ className: string; quantity: number; confidence: number; sku: string | null; action: 'IN' | 'OUT' }>;
    operator:       string;
    team?:          string;
    notes:          string;
    type:           'webcam' | 'upload';
    previewUrl?:    string;
  }) => {
    const totalQty = data.confirmedItems.reduce((acc, it) => acc + it.quantity, 0);
    const inQty  = data.confirmedItems.filter((it) => it.action === 'IN').reduce((acc, it) => acc + it.quantity, 0);
    const outQty = data.confirmedItems.filter((it) => it.action === 'OUT').reduce((acc, it) => acc + it.quantity, 0);

    // Record the scan in local activity history
    storageService.addScanRecord({
      type:           data.type,
      location:       data.location,
      user:           data.operator || currentUser?.userName || 'Unknown',
      team:           data.team     || currentUser?.teamName || 'Unknown',
      itemsDetected:  data.confirmedItems,
      totalQuantity:  totalQty,
      status:         'Confirmed',
      notes:          data.notes,
      previewUrl:     data.previewUrl,
    });

    // Post each confirmed item as an inventory transaction, tracking per-item
    // outcome so the final toast honestly reflects what did and didn't post —
    // no more claiming "Scan Committed" when some (or all) items were skipped.
    const results = await Promise.all(
      data.confirmedItems.map(async (det) => {
        // Primary: sku resolved at detection/manual-add time from
        // DEFAULT_YOLO_LABELS (yoloConfig.ts's hand-verified YOLO_CLASS_SKUS
        // map). Fallback (legacy/defensive only, not the source of truth): an
        // exact catalog-name match, in case sku somehow wasn't resolved. This
        // fallback is unreliable by design — YOLO class labels and product
        // names use different naming schemes and rarely match exactly.
        let sku = det.sku;
        if (!sku) {
          const matchedItem = storageState.items.find(
            (it) => it.location === data.location && it.name.toLowerCase() === det.className.toLowerCase(),
          );
          sku = matchedItem?.itemCode ?? null;
        }

        if (!sku) {
          console.warn(
            `[App] handleScanConfirmed: No product mapping for "${det.className}" — skipping transaction.`,
          );
          return { className: det.className, quantity: det.quantity, action: det.action, ok: false, reason: 'no matching product in inventory' };
        }

        // qty_changed is always the positive magnitude for IN/OUT — the
        // server negates it internally for OUT (see storageService's
        // TransactionPayload contract, also relied on by ConfirmScanModal).
        const txn: TransactionPayload = {
          sku,
          store_name: data.location,
          action:      det.action,
          qty_changed: det.quantity,
        };

        try {
          const result = await storageService.postTransaction(txn);
          if (!result.success) {
            return { className: det.className, quantity: det.quantity, action: det.action, ok: false, reason: result.error || 'rejected by server' };
          }
          return { className: det.className, quantity: det.quantity, action: det.action, ok: true, reason: null as string | null };
        } catch (err) {
          console.warn('[App] postTransaction error for', sku, err);
          return { className: det.className, quantity: det.quantity, action: det.action, ok: false, reason: err instanceof Error ? err.message : 'unexpected error' };
        }
      }),
    );

    const succeeded    = results.filter((r) => r.ok);
    const failed       = results.filter((r) => !r.ok);
    const succeededInQty  = succeeded.filter((r) => r.action === 'IN').reduce((acc, r) => acc + r.quantity, 0);
    const succeededOutQty = succeeded.filter((r) => r.action === 'OUT').reduce((acc, r) => acc + r.quantity, 0);
    const summaryLabel = (inU: number, outU: number) =>
      [inU > 0 ? `${inU} IN` : null, outU > 0 ? `${outU} OUT` : null].filter(Boolean).join(' · ') || `${inU + outU} units`;

    if (failed.length === 0) {
      addToast('success', 'Scan Committed', `Logged ${summaryLabel(inQty, outQty)} at ${data.location} by ${data.operator}`);
    } else if (succeeded.length === 0) {
      addToast(
        'warning',
        'Scan Not Recorded',
        `${failed.map((f) => f.className).join(', ')} could not be posted: no matching product in inventory.`,
      );
    } else {
      addToast('success', 'Scan Partially Committed', `Logged ${summaryLabel(succeededInQty, succeededOutQty)} at ${data.location}: ${succeeded.map((s) => s.className).join(', ')}.`);
      addToast(
        'warning',
        'Some Items Skipped',
        `${failed.map((f) => `${f.className} (${f.reason})`).join('; ')}`,
      );
    }

    setActivePage('dashboard');
  };

  // ---------------------------------------------------------------------------
  // Sync / Export / Import / Reset handlers
  // ---------------------------------------------------------------------------

  const handleForceSync = () => {
    storageService.syncQueue().then((result) => {
      addToast(
        'info',
        'Queue Synchronized',
        `Synchronized ${result.syncedCount} offline mutations at ${result.timestamp}`,
      );
    }).catch((err) => {
      console.error('[App] Sync failed:', err);
      addToast('warning', 'Sync Failed', 'Could not reach server. Mutations remain queued.');
    });
    // Return a compatible sync result immediately for HeaderBar (optimistic)
    return storageService.getState().pendingMutations.length > 0
      ? { syncedCount: storageState.pendingMutations.length, timestamp: new Date().toLocaleTimeString() }
      : { syncedCount: 0, timestamp: new Date().toLocaleTimeString() };
  };

  const handleExportJSON = () => {
    const jsonStr = storageService.exportJSON();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `inventory_ledger_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addToast('success', 'JSON Backup Exported');
  };

  const handleImportJSON = (jsonString: string) => {
    const res = storageService.importJSON(jsonString);
    if (res.success) {
      addToast('success', 'Data Restored', `Imported ${res.itemCount} inventory items.`);
    } else {
      addToast('warning', 'Import Failed', res.message);
    }
    return res;
  };

  const handleResetFactory = () => {
    storageService.resetToFactoryDataset();
    addToast('info', 'Reset Complete', 'Cleared local ledger. Fetching server data…');
    storageService.fetchInventory();
  };

  const handleUpdateModelConfig = (config: Partial<ModelConfig>) => {
    storageService.updateModelConfig(config);
    addToast('success', 'Model Configuration Saved');
  };

  // ---------------------------------------------------------------------------
  // Auth gate
  // ---------------------------------------------------------------------------

  if (!currentUser) {
    return <AuthPage onLoginSuccess={handleLoginSuccess} />;
  }

  // ---------------------------------------------------------------------------
  // Main layout
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-200/80 font-sans text-slate-900">
      {/* Left Sidebar */}
      <Sidebar
        activePage={activePage}
        onSelectPage={setActivePage}
        pendingCount={storageState.pendingMutations.length}
        isOnline={storageState.isOnline}
        totalAssetsCount={storageState.items.length}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Header Bar */}
        <HeaderBar
          activePage={activePage}
          isOnline={storageState.isOnline}
          pendingCount={storageState.pendingMutations.length}
          lastSyncedAt={storageState.lastSyncedAt}
          onSyncNow={handleForceSync}
          currentUser={currentUser}
          onLogout={handleLogout}
        />

        {/* Page Viewport */}
        <main className="flex-1 overflow-y-auto px-6 py-6 min-w-0">
          <div className="max-w-7xl mx-auto">
            {activePage === 'dashboard' && (
              <DashboardPage
                items={storageState.items}
                scanHistory={storageState.scanHistory}
                onNavigate={handleNavigate}
              />
            )}

            {activePage === 'scan' && (
              <ScanInventoryPage
                onScanConfirmed={handleScanConfirmed}
                defaultLocation={scanLocation}
                initialMode={scanMode}
                currentUser={currentUser}
                items={storageState.items}
              />
            )}

            {activePage === 'inventory' && (
              <InventoryPage
                items={storageState.items}
                onCheckoutItem={handleCheckout}
                onCheckinItem={handleCheckin}
                onStockAdjusted={handleStockAdjusted}
              />
            )}

            {activePage === 'history' && (
              <ActivityHistoryPage scanHistory={storageState.scanHistory} />
            )}

            {activePage === 'settings' && (
              <SettingsPage
                modelConfig={storageState.modelConfig}
                onUpdateModelConfig={handleUpdateModelConfig}
                isOnline={storageState.isOnline}
                simulatedOffline={storageState.simulatedOffline}
                onToggleSimulateOffline={() => storageService.toggleSimulatedOffline()}
                pendingCount={storageState.pendingMutations.length}
                lastSyncedAt={storageState.lastSyncedAt}
                onSyncNow={handleForceSync}
                onExportJSON={handleExportJSON}
                onImportJSON={handleImportJSON}
                onResetFactory={handleResetFactory}
              />
            )}
          </div>
        </main>
      </div>

      {/* Toast Notifications */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-lg shadow-lg border text-xs transition-all duration-200 animate-in fade-in slide-in-from-bottom-2 ${
              toast.type === 'success'
                ? 'bg-emerald-900/95 text-white border-emerald-700'
                : toast.type === 'warning'
                ? 'bg-rose-900/95 text-white border-rose-700'
                : 'bg-slate-900/95 text-white border-slate-700'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
            ) : toast.type === 'warning' ? (
              <AlertCircle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
            ) : (
              <Info className="w-4 h-4 text-teal-300 shrink-0 mt-0.5" />
            )}

            <div className="flex-1">
              <div className="font-semibold">{toast.title}</div>
              {toast.message && (
                <div className="text-[11px] opacity-85 mt-0.5">{toast.message}</div>
              )}
            </div>

            <button
              onClick={() => removeToast(toast.id)}
              className="text-white/60 hover:text-white p-0.5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

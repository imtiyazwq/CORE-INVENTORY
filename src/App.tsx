import React, { useState, useEffect } from 'react';
import { Sidebar, PageId } from './components/Sidebar';
import { HeaderBar } from './components/HeaderBar';
import { DashboardPage } from './pages/DashboardPage';
import { InventoryPage } from './pages/InventoryPage';
import { ScanInventoryPage } from './pages/ScanInventoryPage';
import { StockCheckPage } from './pages/StockCheckPage';
import { ActivityHistoryPage } from './pages/ActivityHistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { AuthPage } from './components/AuthPage';
import { storageService, StorageState } from './services/storageService';
import { authService } from './services/authService';
import { ValidLocation, ModelConfig, UserAccount, ItemCategory } from './types';
import { VALID_LOCATIONS } from './data/locations';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

interface Toast {
  id: string;
  type: 'success' | 'info' | 'warning';
  title: string;
  message?: string;
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => authService.getCurrentUser());
  const [activePage, setActivePage] = useState<PageId>('dashboard');
  const [scanLocation, setScanLocation] = useState<ValidLocation>(VALID_LOCATIONS[0]);
  const [scanMode, setScanMode] = useState<'webcam' | 'upload'>('webcam');
  const [storageState, setStorageState] = useState<StorageState>(storageService.getState());
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Subscribe to central persistence storage
  useEffect(() => {
    const unsubscribe = storageService.subscribe((newState) => {
      setStorageState(newState);
    });
    return () => unsubscribe();
  }, []);

  const addToast = (type: 'success' | 'info' | 'warning', title: string, message?: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleLoginSuccess = (user: UserAccount) => {
    setCurrentUser(user);
    addToast('success', `Welcome back, ${user.userName}!`, `Active in ${user.teamName}`);
  };

  const handleLogout = () => {
    authService.logout();
    setCurrentUser(null);
    addToast('info', 'Logged Out', 'You have been safely signed out.');
  };

  // --- Handlers ---

  const handleNavigate = (page: PageId, mode?: 'webcam' | 'upload') => {
    if (mode) setScanMode(mode);
    setActivePage(page);
  };

  const handleNavigateToScanWithLocation = (loc: ValidLocation) => {
    setScanLocation(loc);
    setActivePage('scan');
  };

  const handleCheckout = (itemId: string, user: string, team: string, qty: number) => {
    storageService.checkoutItem(itemId, user, team, qty);
    addToast('success', 'Asset Checked Out', `Assigned to ${user} (${team})`);
  };

  const handleCheckin = (itemId: string, returnLocation: ValidLocation, qty: number) => {
    storageService.checkinItem(itemId, returnLocation, qty);
    addToast('success', 'Asset Checked In', `Returned to ${returnLocation}`);
  };

  const handleScanConfirmed = (data: {
    location: ValidLocation;
    confirmedItems: Array<{ className: string; quantity: number; confidence: number }>;
    operator: string;
    team?: string;
    notes: string;
    type: 'webcam' | 'upload';
    previewUrl?: string;
  }) => {
    const totalQty = data.confirmedItems.reduce((acc, it) => acc + it.quantity, 0);

    storageService.addScanRecord({
      type: data.type,
      location: data.location,
      user: data.operator || currentUser?.userName || 'John Smith',
      team: data.team || currentUser?.teamName || 'Warehouse Team A',
      itemsDetected: data.confirmedItems,
      totalQuantity: totalQty,
      status: 'Confirmed',
      notes: data.notes,
      previewUrl: data.previewUrl,
    });

    // Update existing inventory item quantities or add detected item to inventory
    data.confirmedItems.forEach((det) => {
      const match = storageState.items.find(
        (it) => it.location === data.location && it.name.toLowerCase() === det.className.toLowerCase()
      );
      const nowStr = `${new Date().toISOString().slice(0, 10)} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      if (match) {
        storageService.updateItem({
          ...match,
          quantity: match.quantity + det.quantity,
          availableQuantity: match.availableQuantity + det.quantity,
          lastSeen: nowStr,
        });
      } else {
        const lower = det.className.toLowerCase();
        let cat: ItemCategory = 'IT Equipment';
        if (
          lower.includes('beaker') ||
          lower.includes('flask') ||
          lower.includes('chemical') ||
          lower.includes('pipette') ||
          lower.includes('stirrer') ||
          lower.includes('tube') ||
          lower.includes('scale')
        ) {
          cat = 'Laboratory & Chemical';
        } else if (
          lower.includes('goggle') ||
          lower.includes('glove') ||
          lower.includes('safety') ||
          lower.includes('cone') ||
          lower.includes('barrier')
        ) {
          cat = 'Safety & Protective Equipment';
        } else if (
          lower.includes('scissor') ||
          lower.includes('tape') ||
          lower.includes('paper') ||
          lower.includes('pen') ||
          lower.includes('marker') ||
          lower.includes('glue')
        ) {
          cat = 'Office Supplies';
        }
        const skuPrefix =
          cat === 'Laboratory & Chemical'
            ? 'LAB'
            : cat === 'Safety & Protective Equipment'
            ? 'SAF'
            : cat === 'Office Supplies'
            ? 'OFF'
            : 'IT';
        const cleanName = det.className.toUpperCase().replace(/[^A-Z0-9]/g, '-').slice(0, 6);
        const randCode = Math.floor(Math.random() * 900) + 100;
        storageService.addItem({
          id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          itemCode: `${skuPrefix}-${cleanName}-${randCode}`,
          name: det.className,
          category: cat,
          specification: 'YOLO Computer Vision Verified',
          assetType: 'Non-Consumable',
          quantity: det.quantity,
          availableQuantity: det.quantity,
          location: data.location,
          rackShelf: 'RACK-01',
          status: 'Available',
          lastSeen: nowStr,
          remarks: `Scanned and confirmed by ${data.operator}`,
        });
      }
    });

    // Sync detection events to SQLite Backend with User/Team accountability
    const storeMap: Record<string, number> = {
      'Store 1 (Main Retail Hub)': 1,
      'Store 2 (Suburban Outlet)': 2,
      'Store 3 (Remote Warehouse Alpha)': 3,
      'Store 4 (Field Operations Unit)': 4,
    };
    const storeId = storeMap[data.location] || 1;

    const skuMap: Record<string, string> = {
      'arduino uno rev3': 'ELE-ARD-001',
      'raspberry pi 4 model b': 'ELE-RPI-002',
      'esp32 wroom module': 'ELE-ESP-003',
      'digital soldering station': 'ELE-SOL-004',
      'digital multimeter pro': 'ELE-MUL-005',
      'borosilicate glass beaker 500ml': 'SCI-GLS-001',
      'safety goggles': 'SCI-GOG-002',
      'magnetic stirrer hotplate': 'SCI-STR-003',
      'digital balance scale': 'SCI-BAL-004',
      'hydraulic robotics arm kit': 'KIT-ROB-001',
      'solar energy experimenter kit': 'KIT-SOL-002',
      'iot smart home sensor bundle': 'KIT-IOT-003',
    };

    const serverDetections = data.confirmedItems.map((it) => {
      const lower = it.className.toLowerCase();
      let sku = skuMap[lower];
      if (!sku) {
        const found = Object.keys(skuMap).find((k) => lower.includes(k) || k.includes(lower));
        sku = found ? skuMap[found] : 'ELE-ARD-001';
      }
      return {
        sku,
        detected_quantity: it.quantity,
        confidence_score: it.confidence,
        image_path: 'cv_captures/detection_' + Date.now() + '.jpg',
      };
    });

    const token = localStorage.getItem('session_token');
    fetch('/api/process-detections', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        store_id: storeId,
        detections: serverDetections,
      }),
    })
      .then((res) => res.json())
      .then((resData) => {
        if (resData.status === 'success') {
          console.log('[SQLite Audit Log] Recorded detection batch for User:', resData.user, 'Team:', resData.team);
        }
      })
      .catch((err) => {
        console.warn('[SQLite Audit Log] Error posting detection batch to server:', err);
      });

    addToast(
      'success',
      'YOLO Scan Committed',
      `Logged ${totalQty} units at ${data.location} by ${data.operator}`
    );
    setActivePage('dashboard');
  };

  const handleConfirmStockCheck = (record: any, applyToInventory?: boolean) => {
    const enrichedRecord = {
      ...record,
      user: record.user || currentUser?.userName || 'Senior Storekeeper',
      team: record.team || currentUser?.teamName || 'Warehouse Team A',
    };

    storageService.addStockCheckRecord(enrichedRecord);

    // If requested, synchronize official inventory available quantities with verified physical counts
    if (applyToInventory && record.items) {
      record.items.forEach((auditItem: any) => {
        const match = storageState.items.find(
          (it) => it.location === record.location && it.name.toLowerCase() === auditItem.name.toLowerCase()
        );
        if (match) {
          storageService.updateItem({
            ...match,
            availableQuantity: auditItem.detected,
            quantity: auditItem.detected + (match.quantity - match.availableQuantity),
            lastStocktakeDate: new Date().toISOString().slice(0, 10),
            lastSeen: `${new Date().toISOString().slice(0, 10)} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
          });
        }
      });
    }

    addToast(
      'success',
      'Stock Check Completed',
      `Audit recorded for ${record.location} with ${record.discrepancyCount} discrepancies.`
    );
  };

  const handleForceSync = () => {
    const result = storageService.syncQueue();
    addToast(
      'info',
      'Queue Synchronized',
      `Synchronized ${result.syncedCount} offline mutations at ${result.timestamp}`
    );
    return result;
  };

  const handleExportJSON = () => {
    const jsonStr = storageService.exportJSON();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
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
      addToast('success', 'Data Restored', `Imported ${res.itemCount} inventory items successfully.`);
    } else {
      addToast('warning', 'Import Failed', res.message);
    }
    return res;
  };

  const handleResetFactory = () => {
    storageService.resetToFactoryDataset();
    addToast('info', 'Reset Complete', 'Reloaded initial dataset across the 4 verified stores.');
  };

  const handleUpdateModelConfig = (config: Partial<ModelConfig>) => {
    storageService.updateModelConfig(config);
    addToast('success', 'Model Configuration Saved');
  };

  // If user is not authenticated, render the Authentication screen
  if (!currentUser) {
    return <AuthPage onLoginSuccess={handleLoginSuccess} />;
  }

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
        {/* Compact Header Bar */}
        <HeaderBar
          activePage={activePage}
          isOnline={storageState.isOnline}
          pendingCount={storageState.pendingMutations.length}
          lastSyncedAt={storageState.lastSyncedAt}
          onSyncNow={handleForceSync}
          currentUser={currentUser}
          onLogout={handleLogout}
        />

        {/* Dynamic Page Content Viewport */}
        <main className="flex-1 overflow-y-auto px-6 py-6 min-w-0">
          <div className="max-w-7xl mx-auto">
            {activePage === 'dashboard' && (
              <DashboardPage
                items={storageState.items}
                scanHistory={storageState.scanHistory}
                stockChecks={storageState.stockChecks}
                onNavigate={handleNavigate}
              />
            )}

            {activePage === 'scan' && (
              <ScanInventoryPage
                onScanConfirmed={handleScanConfirmed}
                defaultLocation={scanLocation}
                initialMode={scanMode}
                currentUser={currentUser}
              />
            )}

            {activePage === 'inventory' && (
              <InventoryPage
                items={storageState.items}
                onCheckoutItem={handleCheckout}
                onCheckinItem={handleCheckin}
              />
            )}

            {activePage === 'stock-check' && (
              <StockCheckPage
                items={storageState.items}
                scanHistory={storageState.scanHistory}
                onConfirmStockCheck={handleConfirmStockCheck}
                onNavigateToScan={handleNavigateToScanWithLocation}
                currentUser={currentUser}
              />
            )}

            {activePage === 'history' && (
              <ActivityHistoryPage
                scanHistory={storageState.scanHistory}
                stockChecks={storageState.stockChecks}
              />
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

      {/* Floating Notifications Toast Container */}
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

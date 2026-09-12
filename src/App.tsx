import React, { useEffect, useState } from 'react';
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
import { modelService } from './services/modelService';
import { authService } from './services/authService';
import { InventoryItem, ValidLocation, UserAccount } from './types';
import { VALID_LOCATIONS } from './data/locations';

export const App: React.FC = () => {
  const [activePage, setActivePage] = useState<PageId>('dashboard');
  const [scanInitialMode, setScanInitialMode] = useState<'webcam' | 'upload'>('webcam');
  const [storageState, setStorageState] = useState<StorageState>(() => storageService.getState());
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const unsubscribe = storageService.subscribe((newState) => setStorageState(newState));
    return unsubscribe;
  }, []);

  // Restore the server-side session. Until this finishes we do not render the app.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const user = await authService.restoreSession();
      if (!mounted) return;
      setCurrentUser(user);
      setAuthChecked(true);
      if (user) {
        await storageService.refreshFromCloud();
        modelService.updateConfig(storageService.getState().modelConfig);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Reload the shared cloud state every 2 seconds while logged in.
  // This makes another user's approved stock update appear without requiring a manual refresh.
  useEffect(() => {
    if (!currentUser) return;
    const refresh = async () => {
      const ok = await storageService.refreshFromCloud();
      if (ok) modelService.updateConfig(storageService.getState().modelConfig);
    };
    refresh();
    const interval = window.setInterval(refresh, 2000);
    return () => window.clearInterval(interval);
  }, [currentUser]);

  const handleNavigate = (page: PageId, scanMode?: 'webcam' | 'upload') => {
    setActivePage(page);
    if (scanMode) setScanInitialMode(scanMode);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // A scan is a proposal. It is saved as Pending Review and MUST NOT change Inventory.
  const handleScanConfirmed = (scanData: {
    location: ValidLocation;
    confirmedItems: Array<{ className: string; quantity: number; confidence: number }>;
    operator: string;
    team?: string;
    notes: string;
    type: 'webcam' | 'upload';
    previewUrl?: string;
  }) => {
    const totalQuantity = scanData.confirmedItems.reduce((sum, item) => sum + item.quantity, 0);

    storageService.addScanRecord({
      type: scanData.type,
      location: scanData.location,
      user: scanData.operator,
      team: scanData.team || currentUser?.teamName || 'Inventory Team',
      itemsDetected: scanData.confirmedItems,
      totalQuantity,
      status: 'Pending Review',
      notes: scanData.notes || 'YOLO detection awaiting Stock Check verification.',
      previewUrl: scanData.previewUrl,
    });

    // DO NOT call addItem() or updateItem() here.
    // Inventory changes only after Stock Check reconciliation.
    setActivePage('stockcheck');
  };

  const handleCheckoutItem = (itemId: string, user: string, team: string, qty: number) => {
    storageService.checkoutItem(itemId, user, team, qty);
  };

  const handleCheckinItem = (itemId: string, returnLocation: ValidLocation, qty: number) => {
    storageService.checkinItem(itemId, returnLocation, qty);
  };

  const handleReconcileStock = (
    location: ValidLocation,
    updates: Array<{ itemId: string; newQuantity: number; reason: string; isNew?: boolean; name?: string; category?: string }>
  ) => {
    const reconciledItemsList = updates
      .map((update) => {
        const item = storageState.items.find((candidate) => candidate.id === update.itemId);
        if (item) {
          // Stock Check compares the physical shelf count against what is currently
          // available at the selected location, not against the overall ledger total.
          const expectedAvailable = Math.max(0, Number(item.availableQuantity ?? item.quantity ?? 0));
          const difference = update.newQuantity - expectedAvailable;
          return {
            name: item.name,
            category: item.category,
            expected: expectedAvailable,
            detected: update.newQuantity,
            difference,
            variance: difference,
            status: difference === 0 ? 'Matched' as const : difference < 0 ? 'Short' as const : 'Extra' as const,
          };
        }

        if (update.isNew && update.name) {
          return {
            name: update.name,
            category: update.category || 'Electronics & Robotics',
            expected: 0,
            detected: update.newQuantity,
            difference: update.newQuantity,
            variance: update.newQuantity,
            status: 'Extra' as const,
          };
        }
        return null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    if (!reconciledItemsList.length) return;

    // A class that was enabled/registered in Settings may become a new inventory item,
    // but only after this Stock Check approval. A scan alone never creates it.
    updates.forEach((update) => {
      if (!update.isNew || !update.name || update.newQuantity <= 0) return;
      const alreadyExists = storageState.items.some(
        (item) => item.location === location && item.name.trim().toLowerCase() === update.name!.trim().toLowerCase()
      );
      if (alreadyExists) return;

      const now = new Date().toISOString().slice(0, 10);
      const newItem: InventoryItem = {
        id: `ITEM-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        itemCode: `YOLO-${update.name.substring(0, 3).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`,
        name: update.name,
        category: update.category || 'Electronics & Robotics',
        assetType: 'Non-Consumable',
        quantity: update.newQuantity,
        availableQuantity: update.newQuantity,
        location,
        rackShelf: 'Detected Shelf A',
        status: 'Available',
        lastSeen: now,
        team: currentUser?.teamName,
        remarks: 'Registered after approved Stock Check',
      };
      storageService.addItem(newItem);
    });

    // This is the ONLY place where a Stock Check is allowed to change Inventory.
    // storageService.addStockCheck(..., true) applies the verified physical counts.
    storageService.addStockCheck({
      location,
      operator: currentUser?.userName || 'Stock Auditor',
      user: currentUser?.userName,
      team: currentUser?.teamName,
      matchedCount: reconciledItemsList.filter((item) => item.status === 'Matched').length,
      discrepancyCount: reconciledItemsList.filter((item) => item.status !== 'Matched').length,
      confirmedAt: new Date().toISOString(),
      notes: `Reconciled ${reconciledItemsList.length} items at ${location}`,
      items: reconciledItemsList,
    }, true);
  };

  const handleLogout = async () => {
    await authService.logout();
    setCurrentUser(null);
    setActivePage('dashboard');
  };

  const handleUserLogin = async (user: UserAccount) => {
    setCurrentUser(user);
    await storageService.refreshFromCloud();
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center text-white">
        <div className="text-sm font-semibold">Loading VisionStock...</div>
      </div>
    );
  }

  if (!currentUser) {
    return <AuthPage onLoginSuccess={handleUserLogin} />;
  }

  return (
    <div className="h-screen bg-[#f8fafc] text-slate-900 flex flex-col md:flex-row antialiased overflow-hidden">
      <Sidebar
        activePage={activePage}
        onSelectPage={(page) => setActivePage(page)}
        pendingCount={storageState.pendingMutations.length}
        isOnline={storageState.isOnline}
        totalAssetsCount={storageState.items.length}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full overflow-y-auto overflow-x-hidden">
        <HeaderBar
          activePage={activePage}
          isOnline={storageState.isOnline}
          pendingCount={storageState.pendingMutations.length}
          lastSyncedAt={storageState.lastSyncedAt}
          onSyncNow={() => storageService.syncQueue()}
          currentUser={currentUser}
          onLogout={handleLogout}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {activePage === 'dashboard' && (
            <DashboardPage items={storageState.items} scanHistory={storageState.scanHistory} onNavigate={handleNavigate} />
          )}

          {activePage === 'scan' && (
            <ScanInventoryPage
              onScanConfirmed={handleScanConfirmed}
              defaultLocation={VALID_LOCATIONS[0]}
              initialMode={scanInitialMode}
              currentUser={currentUser}
            />
          )}

          {activePage === 'inventory' && (
            <InventoryPage
              items={storageState.items}
              onCheckoutItem={handleCheckoutItem}
              onCheckinItem={handleCheckinItem}
            />
          )}

          {activePage === 'stockcheck' && (
            <StockCheckPage
              items={storageState.items}
              recentScans={storageState.scanHistory}
              onReconcileStock={handleReconcileStock}
            />
          )}

          {activePage === 'history' && <ActivityHistoryPage scanHistory={storageState.scanHistory} />}

          {activePage === 'settings' && (
            <SettingsPage
              modelConfig={modelService.getConfig()}
              onUpdateModelConfig={(cfg) => {
                modelService.updateConfig(cfg);
                storageService.updateModelConfig(cfg);
              }}
              isOnline={storageState.isOnline}
              simulatedOffline={storageState.simulatedOffline}
              onToggleSimulateOffline={() => storageService.toggleSimulatedOffline()}
              pendingCount={storageState.pendingMutations.length}
              lastSyncedAt={storageState.lastSyncedAt}
              onSyncNow={() => storageService.syncQueue()}
              onExportJSON={() => {
                const json = storageService.exportJSON();
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `inventory-ledger-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              onImportJSON={(jsonString) => {
                const result = storageService.importJSON(jsonString);
                if (result.success) setStorageState(storageService.getState());
                return result;
              }}
              onResetFactory={() => storageService.resetToFactoryDataset()}
              onClearAllData={() => setStorageState(storageService.getState())}
              onImportData={() => setStorageState(storageService.getState())}
            />
          )}
        </main>

        <footer className="border-t border-slate-200/80 bg-white py-3 px-6 text-center text-[11px] text-slate-500 shrink-0">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
            <span>VisionStock AI • 4 Verified Storage Locations • Cloud Shared Ledger</span>
            <span className="font-mono text-slate-400">Cloud Records ({storageState.items.length})</span>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default App;

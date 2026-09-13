import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  GitCompare,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RotateCcw,
  Download,
  Filter,
  Package,
  Layers,
  Save,
  Scan,
} from 'lucide-react';
import { InventoryItem, ValidLocation, ScanRecord } from '../types';
import { VALID_LOCATIONS } from '../data/locations';
import { YOLO_CLASS_DEFINITIONS } from '../services/yoloConfig';

interface StockCheckPageProps {
  items: InventoryItem[];
  recentScans: ScanRecord[];
  initialLocation?: ValidLocation;
  onReconcileStock: (
    location: ValidLocation,
    updates: Array<{ itemId: string; newQuantity: number; reason: string; isNew?: boolean; name?: string; category?: string }>
  ) => void;
}

interface ComparisonRow {
  id: string;
  itemCode: string;
  name: string;
  category: string;
  assetType: string;
  expectedQty: number;
  countedQty: number;
  discrepancy: number; // counted - expected
  status: 'Match' | 'Surplus' | 'Deficit' | 'Uncounted';
}

export const StockCheckPage: React.FC<StockCheckPageProps> = ({
  items,
  recentScans,
  initialLocation = VALID_LOCATIONS[0],
  onReconcileStock,
}) => {
  // Start Stock Check at the location that created the pending scan.
  const [selectedLocation, setSelectedLocation] = useState<ValidLocation>(initialLocation);
  const [filterDiscrepancyOnly, setFilterDiscrepancyOnly] = useState(false);
  const [reconcileReason, setReconcileReason] = useState('Quarterly physical stock audit reconciliation');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Items already registered in the inventory.
  const locationItems = useMemo(() => {
    return items.filter((it) => it.location === selectedLocation);
  }, [items, selectedLocation]);

  const latestPendingScan = useMemo(
    () => recentScans.find((scan) => scan.location === selectedLocation && scan.status === 'Pending Review'),
    [recentScans, selectedLocation]
  );

  const [physicalCounts, setPhysicalCounts] = useState<Record<string, number>>({});
  const autoLoadedScanIdRef = useRef<string | null>(null);

  const normaliseName = (value: string) => value.trim().toLowerCase().replace(/_/g, ' ');

  // When App sends us here after confirming a scan, follow that scan's location.
  useEffect(() => {
    setSelectedLocation(initialLocation);
    setPhysicalCounts({});
    autoLoadedScanIdRef.current = null;
  }, [initialLocation]);

  // Automatically copy the newest pending YOLO result into Physical Count once.
  // This makes the detected quantity visible immediately instead of requiring the
  // user to press "Load from Recent Scan" after every scan. The scan-id guard
  // prevents the 2-second cloud refresh from overwriting manual corrections.
  useEffect(() => {
    if (!latestPendingScan) return;
    if (autoLoadedScanIdRef.current === latestPendingScan.id) return;

    const counts: Record<string, number> = {};
    for (const detected of latestPendingScan.itemsDetected) {
      const existing = locationItems.find(
        (item) => normaliseName(item.name) === normaliseName(detected.className)
      );
      const id = existing?.id || `NEW:${latestPendingScan.id}:${normaliseName(detected.className)}`;
      counts[id] = detected.quantity;
    }

    setPhysicalCounts(counts);
    autoLoadedScanIdRef.current = latestPendingScan.id;
  }, [latestPendingScan, locationItems]);

  // Build registered rows plus YOLO-detected-but-not-yet-registered rows.
  // New rows can only become inventory records after the user commits Stock Check.
  const comparisonData: ComparisonRow[] = useMemo(() => {
    const rows: ComparisonRow[] = locationItems.map((item) => {
      // Stock Check verifies what is physically available at this location.
      // `quantity` is the overall ledger total, while `availableQuantity` is what
      // should actually be present on the shelf and therefore what YOLO/manual
      // counting must be compared against.
      const expectedQty = Math.max(0, Number(item.availableQuantity ?? item.quantity ?? 0));
      const isEntered = physicalCounts[item.id] !== undefined;
      const counted = isEntered ? physicalCounts[item.id] : expectedQty;
      const discrepancy = counted - expectedQty;
      const status: ComparisonRow['status'] = !isEntered
        ? 'Uncounted'
        : discrepancy === 0
          ? 'Match'
          : discrepancy > 0
            ? 'Surplus'
            : 'Deficit';
      return {
        id: item.id,
        itemCode: item.itemCode,
        name: item.name,
        category: item.category,
        assetType: item.assetType,
        expectedQty,
        countedQty: counted,
        discrepancy,
        status,
      };
    });

    if (latestPendingScan) {
      for (const detected of latestPendingScan.itemsDetected) {
        const existing = locationItems.find((item) => normaliseName(item.name) === normaliseName(detected.className));
        if (existing) continue;

        const syntheticId = `NEW:${latestPendingScan.id}:${normaliseName(detected.className)}`;
        const counted = physicalCounts[syntheticId] ?? detected.quantity;
        rows.push({
          id: syntheticId,
          itemCode: 'PENDING-YOLO',
          name: detected.className,
          category: YOLO_CLASS_DEFINITIONS.find((definition) => definition.inventoryName.toLowerCase() === detected.className.toLowerCase())?.category || 'Electronics & Robotics',
          assetType: 'Non-Consumable',
          expectedQty: 0,
          countedQty: counted,
          discrepancy: counted,
          status: physicalCounts[syntheticId] !== undefined ? (counted > 0 ? 'Surplus' : 'Uncounted') : 'Uncounted',
        });
      }
    }

    return rows;
  }, [locationItems, physicalCounts, latestPendingScan]);

  const handleLoadFromLatestScan = () => {
    if (!latestPendingScan) {
      alert(`No pending YOLO scan found for location: ${selectedLocation}`);
      return;
    }

    const counts: Record<string, number> = {};
    for (const detected of latestPendingScan.itemsDetected) {
      const existing = locationItems.find((item) => normaliseName(item.name) === normaliseName(detected.className));
      const id = existing?.id || `NEW:${latestPendingScan.id}:${normaliseName(detected.className)}`;
      counts[id] = detected.quantity;
    }
    setPhysicalCounts(counts);
  };

  const handleSetCount = (itemId: string, val: number) => {
    setPhysicalCounts((prev) => ({ ...prev, [itemId]: Math.max(0, val) }));
  };

  const handleSetAllToExpected = () => {
    const counts: Record<string, number> = {};
    comparisonData.forEach((row) => { counts[row.id] = row.expectedQty; });
    setPhysicalCounts(counts);
  };

  const handleResetCounts = () => setPhysicalCounts({});

  const displayedRows = useMemo(() => {
    if (!filterDiscrepancyOnly) return comparisonData;
    return comparisonData.filter((r) => r.status === 'Surplus' || r.status === 'Deficit');
  }, [comparisonData, filterDiscrepancyOnly]);

  const matchCount = comparisonData.filter((r) => r.status === 'Match').length;
  const surplusCount = comparisonData.filter((r) => r.status === 'Surplus').length;
  const deficitCount = comparisonData.filter((r) => r.status === 'Deficit').length;
  const uncountedCount = comparisonData.filter((r) => r.status === 'Uncounted').length;
  const hasChanges = comparisonData.some((r) => physicalCounts[r.id] !== undefined && r.discrepancy !== 0);

  const handleCommitReconciliation = () => {
    const updates: Array<{ itemId: string; newQuantity: number; reason: string; isNew?: boolean; name?: string; category?: string }> = [];

    comparisonData.forEach((row) => {
      if (physicalCounts[row.id] === undefined) return;
      const isNew = row.id.startsWith('NEW:');
      if (!isNew && row.discrepancy === 0) return;
      if (isNew && row.countedQty <= 0) return;

      updates.push({
        itemId: row.id,
        newQuantity: row.countedQty,
        reason: reconcileReason || 'Stock check reconciliation',
        isNew,
        name: row.name,
        category: row.category,
      });
    });

    if (updates.length === 0) {
      alert('No verified changes found. Load a pending scan or enter a physical count first.');
      return;
    }

    onReconcileStock(selectedLocation, updates);
    setPhysicalCounts({});
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 5000);
  };

  const handleExportCSV = () => {
    const headers = [
      'Item Code',
      'Item Name',
      'Category',
      'Location',
      'Expected Qty',
      'Physical Counted',
      'Discrepancy (Variance)',
      'Status',
    ];
    const rows = comparisonData.map((r) => [
      r.itemCode,
      `"${r.name.replace(/"/g, '""')}"`,
      r.category,
      selectedLocation,
      r.expectedQty,
      r.countedQty,
      r.discrepancy > 0 ? `+${r.discrepancy}` : r.discrepancy,
      r.status,
    ]);

    const csvContent = [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `stock_check_comparison_${selectedLocation.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-5 pb-12">
      {/* Top Header Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#005f60] text-white flex items-center justify-center">
              <GitCompare className="w-4 h-4" />
            </div>
            <h2 className="text-base font-bold text-slate-900">
              Stock Check Comparison
            </h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-teal-50 text-[#005f60] border border-teal-200 font-semibold">
              Variance Verification
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Compare system expected catalog inventory with real physical audit counts to detect variances and reconcile the ledger.
          </p>
        </div>

        {/* Location Selector */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <label className="text-xs font-semibold text-slate-700 whitespace-nowrap flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 text-[#005f60]" />
            Location:
          </label>
          <select
            value={selectedLocation}
            onChange={(e) => {
              setSelectedLocation(e.target.value as ValidLocation);
              setPhysicalCounts({});
              autoLoadedScanIdRef.current = null;
            }}
            className="text-xs font-semibold px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60] bg-white text-slate-800 cursor-pointer w-full md:w-64"
          >
            {VALID_LOCATIONS.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>
        </div>
      </div>

      {latestPendingScan && (
        <div className="p-3 rounded-lg bg-teal-50 border border-teal-200 text-teal-900 text-xs flex items-center gap-2">
          <Scan className="w-4 h-4 shrink-0" />
          <span><strong>Pending YOLO scan:</strong> {latestPendingScan.itemsDetected.length} detected item type(s). Review the physical count below before committing.</span>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Total Items
          </div>
          <div className="text-xl font-bold font-mono text-slate-900 mt-1">
            {locationItems.length}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            Registered at this location
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Verified Matches
          </div>
          <div className="text-xl font-bold font-mono text-emerald-700 mt-1">
            {matchCount}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            Physical = Expected
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            Surplus Items
          </div>
          <div className="text-xl font-bold font-mono text-amber-700 mt-1">
            {surplusCount}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            Count exceeds expected
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="text-[11px] font-semibold text-rose-700 uppercase tracking-wider flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            Deficit Items
          </div>
          <div className="text-xl font-bold font-mono text-rose-700 mt-1">
            {deficitCount}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            Physical missing units
          </div>
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleLoadFromLatestScan}
            className="px-3 py-1.5 text-xs font-semibold text-[#005f60] bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Populate physical counts from recent YOLO scan"
          >
            <Scan className="w-3.5 h-3.5" />
            Load from Recent Scan
          </button>

          <button
            type="button"
            onClick={handleSetAllToExpected}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            Prefill All with Expected
          </button>

          <button
            type="button"
            onClick={handleResetCounts}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            Reset Counts
          </button>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={filterDiscrepancyOnly}
              onChange={(e) => setFilterDiscrepancyOnly(e.target.checked)}
              className="rounded border-slate-300 text-[#005f60] focus:ring-[#005f60]"
            />
            <span>Show Discrepancies Only</span>
          </label>

          <button
            type="button"
            onClick={handleExportCSV}
            className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            Export Report
          </button>
        </div>
      </div>

      {saveSuccess && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>Stock reconciliation successfully committed to ledger! System quantities have been aligned with physical counts.</span>
        </div>
      )}

      {/* Comparison Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold select-none">
              <tr>
                <th className="px-4 py-3">Item Code & Name</th>
                <th className="px-3 py-3">Category</th>
                <th className="px-3 py-3">Asset Type</th>
                <th className="px-3 py-3 text-center">System Expected</th>
                <th className="px-3 py-3 text-center">Physical Count</th>
                <th className="px-3 py-3 text-center">Discrepancy</th>
                <th className="px-3 py-3 text-center">Comparison Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {displayedRows.map((row) => {
                const isEntered = physicalCounts[row.id] !== undefined;

                return (
                  <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{row.name}</div>
                      <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                        {row.itemCode}
                      </div>
                    </td>

                    <td className="px-3 py-3 text-slate-600">
                      {row.category}
                    </td>

                    <td className="px-3 py-3 text-slate-600">
                      <span className="px-2 py-0.5 rounded text-[11px] bg-slate-100 border border-slate-200">
                        {row.assetType}
                      </span>
                    </td>

                    <td className="px-3 py-3 text-center font-mono font-bold text-slate-700 text-sm">
                      {row.expectedQty}
                    </td>

                    <td className="px-3 py-3 text-center">
                      <input
                        type="number"
                        min={0}
                        max={999}
                        value={isEntered ? physicalCounts[row.id] : ''}
                        placeholder={String(row.expectedQty)}
                        onChange={(e) => {
                          const val = e.target.value === '' ? row.expectedQty : parseInt(e.target.value) || 0;
                          handleSetCount(row.id, val);
                        }}
                        className="w-20 text-center font-mono text-xs font-bold px-2 py-1 border border-slate-300 rounded focus:ring-1 focus:ring-[#005f60] focus:outline-none"
                      />
                    </td>

                    <td className="px-3 py-3 text-center font-mono font-bold text-xs">
                      {row.discrepancy === 0 ? (
                        <span className="text-emerald-600">0</span>
                      ) : row.discrepancy > 0 ? (
                        <span className="text-amber-600 font-bold">+{row.discrepancy}</span>
                      ) : (
                        <span className="text-rose-600 font-bold">{row.discrepancy}</span>
                      )}
                    </td>

                    <td className="px-3 py-3 text-center">
                      {row.status === 'Match' && (
                        <span className="px-2.5 py-1 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Match
                        </span>
                      )}
                      {row.status === 'Surplus' && (
                        <span className="px-2.5 py-1 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 inline-flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          +{row.discrepancy} Surplus
                        </span>
                      )}
                      {row.status === 'Deficit' && (
                        <span className="px-2.5 py-1 rounded text-[11px] font-semibold bg-rose-50 text-rose-800 border border-rose-200 inline-flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          {row.discrepancy} Missing
                        </span>
                      )}
                      {row.status === 'Uncounted' && (
                        <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                          Pending Verification
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {displayedRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <Package className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <p className="font-semibold text-slate-600">No items to compare at this location</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {filterDiscrepancyOnly
                        ? 'All entered counts match the expected system stock.'
                        : 'No items currently registered at this storage location.'}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reconciliation Commit Bar */}
      {(hasChanges || latestPendingScan) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" />
            <div>
              <div className="text-xs font-bold text-amber-900">
                Discrepancies Detected ({surplusCount} Surplus, {deficitCount} Deficit)
              </div>
              <div className="text-[11px] text-amber-800">
                Reconciling will update system ledger quantities to match verified physical audit counts.
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <input
              type="text"
              value={reconcileReason}
              onChange={(e) => setReconcileReason(e.target.value)}
              placeholder="Reconciliation reason..."
              className="text-xs px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-slate-800 flex-1 sm:w-64"
            />
            <button
              type="button"
              onClick={handleCommitReconciliation}
              className="px-4 py-1.5 text-xs font-bold text-white bg-[#005f60] hover:bg-[#004d4e] rounded-lg shadow-xs transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              Reconcile Ledger
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useState, useMemo, useEffect } from 'react';
import {
  ClipboardCheck,
  MapPin,
  Camera,
  CheckCircle2,
  AlertTriangle,
  Layers,
  ArrowRight,
  RotateCcw,
  Sparkles,
  Search,
  Filter,
  Check,
  Clock,
  Scan,
  User,
  FileCheck,
  ExternalLink,
  ChevronDown,
  Info,
} from 'lucide-react';
import {
  InventoryItem,
  ValidLocation,
  StockCheckRecord,
  StockCheckItem,
  ScanRecord,
  UserAccount,
} from '../types';
import { VALID_LOCATIONS } from '../data/locations';
import { PageId } from '../components/Sidebar';

interface StockCheckPageProps {
  items: InventoryItem[];
  scanHistory: ScanRecord[];
  onConfirmStockCheck: (record: Omit<StockCheckRecord, 'id' | 'timestamp'>, applyToInventory?: boolean) => void;
  onNavigateToScan?: (location: ValidLocation) => void;
  currentUser?: UserAccount | null;
}

interface VerificationRow {
  name: string;
  category: string;
  expected: number;
  detected: number;
  variance: number;
  status: 'Matched' | 'Short' | 'Extra';
  originalDetected: number;
  isCustomAdjusted?: boolean;
}

export const StockCheckPage: React.FC<StockCheckPageProps> = ({
  items,
  scanHistory,
  onConfirmStockCheck,
  onNavigateToScan,
  currentUser,
}) => {
  // 1. Location Selection
  const [selectedLocation, setSelectedLocation] = useState<ValidLocation>(VALID_LOCATIONS[0]);
  const [selectedScanId, setSelectedScanId] = useState<string>('latest');
  const [operator, setOperator] = useState(currentUser?.userName || 'Senior Storekeeper');
  const [notes, setNotes] = useState('');
  const [applyToInventory, setApplyToInventory] = useState(false);

  // 2. Filters & View State
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DISCREPANCIES' | 'MATCHED' | 'SHORT' | 'EXTRA'>('ALL');
  const [reviewMode, setReviewMode] = useState(false);
  const [isConfirmedSuccess, setIsConfirmedSuccess] = useState(false);
  const [confirmedDetails, setConfirmedDetails] = useState<{ matched: number; discrepancies: number } | null>(null);

  // 3. User manual overrides for detected quantities
  const [manualDetectedOverrides, setManualDetectedOverrides] = useState<Record<string, number>>({});

  // Reset state when changing location
  useEffect(() => {
    setSelectedScanId('latest');
    setManualDetectedOverrides({});
    setIsConfirmedSuccess(false);
    setConfirmedDetails(null);
  }, [selectedLocation]);

  // Find confirmed scans for the selected location
  const locationScans = useMemo(() => {
    return scanHistory.filter((s) => s.location === selectedLocation);
  }, [scanHistory, selectedLocation]);

  // Determine active scan record being verified
  const activeScan = useMemo(() => {
    if (locationScans.length === 0) return null;
    if (selectedScanId === 'latest') return locationScans[0];
    return locationScans.find((s) => s.id === selectedScanId) || locationScans[0];
  }, [locationScans, selectedScanId]);

  // 4. Generate Ready-Made Expected vs Detected Comparison List
  const verificationRows: VerificationRow[] = useMemo(() => {
    // A. Expected inventory at this location
    const expectedMap = new Map<string, { category: string; expected: number }>();
    items
      .filter((it) => it.location === selectedLocation)
      .forEach((it) => {
        const existing = expectedMap.get(it.name);
        if (existing) {
          existing.expected += it.availableQuantity;
        } else {
          expectedMap.set(it.name, {
            category: it.category,
            expected: it.availableQuantity,
          });
        }
      });

    // B. Detected items from the selected confirmed scan
    const detectedMap = new Map<string, number>();
    if (activeScan && activeScan.itemsDetected) {
      activeScan.itemsDetected.forEach((d) => {
        const current = detectedMap.get(d.className) || 0;
        detectedMap.set(d.className, current + d.quantity);
      });
    }

    // C. Combine all unique item names
    const allNames = Array.from(new Set([...expectedMap.keys(), ...detectedMap.keys()])).sort();

    return allNames.map((name) => {
      const expectedData = expectedMap.get(name);
      const expected = expectedData ? expectedData.expected : 0;
      const category = expectedData ? expectedData.category : 'General Equipment';

      // Base detected from scan
      const scanDetected = detectedMap.get(name) || 0;

      // Check if user manually adjusted this count
      const isCustomAdjusted = name in manualDetectedOverrides;
      const detected = isCustomAdjusted ? manualDetectedOverrides[name] : scanDetected;

      // Variance = Detected Quantity - Expected Quantity
      const variance = detected - expected;

      let status: 'Matched' | 'Short' | 'Extra' = 'Matched';
      if (variance < 0) status = 'Short';
      else if (variance > 0) status = 'Extra';

      return {
        name,
        category,
        expected,
        detected,
        variance,
        status,
        originalDetected: scanDetected,
        isCustomAdjusted,
      };
    });
  }, [items, selectedLocation, activeScan, manualDetectedOverrides]);

  // Filtered rows for the table view
  const displayedRows = useMemo(() => {
    return verificationRows.filter((row) => {
      const matchesSearch =
        row.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        row.category.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      if (statusFilter === 'DISCREPANCIES') return row.status !== 'Matched';
      if (statusFilter === 'MATCHED') return row.status === 'Matched';
      if (statusFilter === 'SHORT') return row.status === 'Short';
      if (statusFilter === 'EXTRA') return row.status === 'Extra';

      return true;
    });
  }, [verificationRows, searchQuery, statusFilter]);

  // Summary Metrics
  const totalExpectedUnits = verificationRows.reduce((sum, r) => sum + r.expected, 0);
  const totalDetectedUnits = verificationRows.reduce((sum, r) => sum + r.detected, 0);
  const totalItemsCount = verificationRows.length;
  const matchedCount = verificationRows.filter((r) => r.status === 'Matched').length;
  const shortCount = verificationRows.filter((r) => r.status === 'Short').length;
  const extraCount = verificationRows.filter((r) => r.status === 'Extra').length;
  const discrepanciesCount = shortCount + extraCount;

  // Handle manual count adjustment
  const handleCountChange = (itemName: string, newCount: number) => {
    setManualDetectedOverrides((prev) => ({
      ...prev,
      [itemName]: Math.max(0, newCount),
    }));
  };

  const handleResetItemCount = (itemName: string) => {
    setManualDetectedOverrides((prev) => {
      const copy = { ...prev };
      delete copy[itemName];
      return copy;
    });
  };

  const handleResetAllCounts = () => {
    setManualDetectedOverrides({});
  };

  // Final Confirmation Handler
  const handleConfirm = () => {
    if (verificationRows.length === 0) return;

    const itemsPayload: StockCheckItem[] = verificationRows.map((r) => ({
      name: r.name,
      category: r.category,
      expected: r.expected,
      detected: r.detected,
      difference: r.variance,
      variance: r.variance,
      status: r.status,
    }));

    onConfirmStockCheck(
      {
        location: selectedLocation,
        operator: operator.trim() || currentUser?.userName || 'Senior Storekeeper',
        user: currentUser?.userName || operator.trim(),
        team: currentUser?.teamName,
        matchedCount,
        discrepancyCount: discrepanciesCount,
        confirmedAt: new Date().toISOString(),
        notes: notes.trim() || (activeScan ? `Verified against YOLO Scan #${activeScan.id.slice(-6)}` : 'Manual audit'),
        items: itemsPayload,
      },
      applyToInventory
    );

    setConfirmedDetails({ matched: matchedCount, discrepancies: discrepanciesCount });
    setIsConfirmedSuccess(true);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* ========================================================================= */}
      {/* 1. LOCATION SELECTION & SCAN SOURCE BAR                                  */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#005f60] text-white flex items-center justify-center shadow-xs shrink-0">
              <ClipboardCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 tracking-normal">
                Physical Stock Check
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Compare expected inventory against confirmed YOLO scan detections.
              </p>
            </div>
          </div>

          {/* Location Selector */}
          <div className="flex items-center gap-2.5">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5 shrink-0">
              <MapPin className="w-4 h-4 text-[#005f60]" />
              Location:
            </label>
            <div className="relative">
              <select
                id="stockcheck-location-select"
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value as ValidLocation)}
                className="text-xs font-semibold px-3 py-2 pr-8 rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#005f60] appearance-none shadow-2xs cursor-pointer min-w-[230px]"
              >
                {VALID_LOCATIONS.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Scan Source Status Banner */}
        <div className="mt-4 pt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-600">
            <span className="font-semibold text-slate-800">Scan Source:</span>
            {activeScan ? (
              <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-1 rounded font-medium">
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                Latest Confirmed Scan ({activeScan.itemsDetected.length} object types, {activeScan.totalQuantity} units) • {new Date(activeScan.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-800 border border-amber-200 px-2.5 py-1 rounded font-medium">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                No confirmed scan recorded for this location yet
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {locationScans.length > 1 && (
              <select
                value={selectedScanId}
                onChange={(e) => setSelectedScanId(e.target.value)}
                className="text-[11px] font-medium px-2 py-1 rounded border border-slate-300 bg-slate-50 text-slate-700"
              >
                <option value="latest">Use Latest Scan</option>
                {locationScans.map((s, idx) => (
                  <option key={s.id} value={s.id}>
                    Scan #{idx + 1} ({new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                  </option>
                ))}
              </select>
            )}

            {onNavigateToScan && (
              <button
                onClick={() => onNavigateToScan(selectedLocation)}
                className="px-3 py-1.5 rounded-lg bg-[#005f60] hover:bg-[#004d4e] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs"
              >
                <Scan className="w-3.5 h-3.5" />
                <span>Scan This Location</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. SUMMARY METRICS CARDS (EXPECTED / DETECTED / MATCHED / DISCREPANCIES)  */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Card 1: Expected Items */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Expected Items
            </span>
            <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold">
              Ledger
            </span>
          </div>
          <div className="text-2xl font-black text-slate-900 mt-2 font-mono">
            {totalExpectedUnits} <span className="text-xs font-normal text-slate-500 font-sans">units ({totalItemsCount} SKUs)</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Recorded in inventory database
          </div>
        </div>

        {/* Card 2: Detected Items */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Detected Items
            </span>
            <span className="text-[10px] font-mono bg-teal-50 text-[#005f60] border border-teal-200 px-1.5 py-0.5 rounded font-bold">
              YOLO CV
            </span>
          </div>
          <div className="text-2xl font-black text-[#005f60] mt-2 font-mono">
            {totalDetectedUnits} <span className="text-xs font-normal text-slate-500 font-sans">units</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Physically captured by model
          </div>
        </div>

        {/* Card 3: Matched Items */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Matched Items
            </span>
            <span className="text-[10px] font-mono bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded font-bold">
              Variance: 0
            </span>
          </div>
          <div className="text-2xl font-black text-emerald-700 mt-2 font-mono">
            {matchedCount} <span className="text-xs font-normal text-slate-500 font-sans">SKUs</span>
          </div>
          <div className="text-[11px] text-emerald-600 mt-1 flex items-center gap-1 font-medium">
            <CheckCircle2 className="w-3 h-3" /> Exact quantity match
          </div>
        </div>

        {/* Card 4: Discrepancies */}
        <div className={`bg-white rounded-xl border p-4 shadow-xs ${discrepanciesCount > 0 ? 'border-rose-300 bg-rose-50/10' : 'border-slate-200'}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Discrepancies
            </span>
            {discrepanciesCount > 0 ? (
              <span className="text-[10px] font-mono bg-rose-100 text-rose-900 border border-rose-300 px-1.5 py-0.5 rounded font-bold">
                Action Needed
              </span>
            ) : (
              <span className="text-[10px] font-mono bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-bold">
                Clean Audit
              </span>
            )}
          </div>
          <div className={`text-2xl font-black mt-2 font-mono ${discrepanciesCount > 0 ? 'text-rose-700' : 'text-slate-800'}`}>
            {discrepanciesCount} <span className="text-xs font-normal text-slate-500 font-sans">SKUs</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2">
            <span className="text-rose-600 font-semibold">{shortCount} Short</span>
            <span>•</span>
            <span className="text-rose-600 font-semibold">{extraCount} Extra</span>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. COMPARISON TABLE & FILTER CONTROLS                                    */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {/* Table Toolbar */}
        <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-slate-50/50">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                statusFilter === 'ALL'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              All Items ({verificationRows.length})
            </button>
            <button
              onClick={() => setStatusFilter('DISCREPANCIES')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                statusFilter === 'DISCREPANCIES'
                  ? 'bg-rose-700 text-white'
                  : 'bg-white text-rose-800 border border-rose-200 hover:bg-rose-50'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Discrepancies ({discrepanciesCount})
            </button>
            <button
              onClick={() => setStatusFilter('MATCHED')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                statusFilter === 'MATCHED'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              Matched ({matchedCount})
            </button>
            <button
              onClick={() => setStatusFilter('SHORT')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                statusFilter === 'SHORT'
                  ? 'bg-rose-700 text-white'
                  : 'bg-white text-rose-800 border border-rose-200 hover:bg-rose-50'
              }`}
            >
              Short ({shortCount})
            </button>
            <button
              onClick={() => setStatusFilter('EXTRA')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                statusFilter === 'EXTRA'
                  ? 'bg-rose-700 text-white'
                  : 'bg-white text-rose-800 border border-rose-200 hover:bg-rose-50'
              }`}
            >
              Extra ({extraCount})
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1 md:w-56">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search items or category..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60] bg-white text-slate-900"
              />
            </div>

            {Object.keys(manualDetectedOverrides).length > 0 && (
              <button
                onClick={handleResetAllCounts}
                title="Reset manual adjustments back to raw scan values"
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 text-xs font-medium flex items-center gap-1 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Reset Counts
              </button>
            )}
          </div>
        </div>

        {/* Verification Comparison Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4">Item Name / Asset</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4 text-right">Expected Qty.</th>
                <th className="py-3 px-4 text-right">Detected Qty.</th>
                <th className="py-3 px-4 text-center">Variance</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Action / Adjust</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {displayedRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    No items found matching the current search or filter criteria.
                  </td>
                </tr>
              ) : (
                displayedRows.map((row) => (
                  <tr
                    key={row.name}
                    className={`hover:bg-slate-50/80 transition-colors ${
                      row.variance !== 0 ? 'bg-rose-50/20' : ''
                    }`}
                  >
                    {/* Item Name */}
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900">{row.name}</div>
                      {row.isCustomAdjusted && (
                        <span className="text-[10px] text-slate-600 font-mono bg-slate-100 px-1.5 py-0.2 rounded border border-slate-200">
                          Recounted from {row.originalDetected}
                        </span>
                      )}
                    </td>

                    {/* Category */}
                    <td className="py-3 px-4">
                      <span className="text-slate-600 bg-slate-100 px-2 py-0.5 rounded text-[11px] font-medium">
                        {row.category}
                      </span>
                    </td>

                    {/* Expected Qty */}
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-700 text-sm">
                      {row.expected}
                    </td>

                    {/* Detected Qty */}
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 text-sm">
                      {row.detected}
                    </td>

                    {/* Variance = Detected - Expected */}
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-block font-mono font-bold text-xs px-2 py-0.5 rounded ${
                          row.variance === 0
                            ? 'text-slate-600 bg-slate-100'
                            : 'text-rose-700 bg-rose-100'
                        }`}
                      >
                        {row.variance > 0 ? `+${row.variance}` : row.variance}
                      </span>
                    </td>

                    {/* Status Badge */}
                    <td className="py-3 px-4 text-center">
                      {row.status === 'Matched' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                          <CheckCircle2 className="w-3 h-3 text-slate-500" />
                          Matched
                        </span>
                      )}
                      {row.status === 'Short' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-bold bg-rose-100 text-rose-900 border border-rose-300">
                          <AlertTriangle className="w-3 h-3 text-rose-700" />
                          Short ({row.variance})
                        </span>
                      )}
                      {row.status === 'Extra' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-bold bg-rose-100 text-rose-900 border border-rose-300">
                          <AlertTriangle className="w-3 h-3 text-rose-700" />
                          Extra (+{row.variance})
                        </span>
                      )}
                    </td>

                    {/* Manual Correction Input */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <input
                          type="number"
                          min="0"
                          value={row.detected}
                          onChange={(e) => handleCountChange(row.name, parseInt(e.target.value, 10) || 0)}
                          className="w-16 px-2 py-1 text-xs border border-slate-300 rounded font-mono text-center focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white"
                          title="Override detected count if manual recount was conducted"
                        />
                        {row.isCustomAdjusted && (
                          <button
                            onClick={() => handleResetItemCount(row.name)}
                            title="Reset to scan detection value"
                            className="p-1 text-slate-400 hover:text-slate-700"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 4. AUDIT REVIEW & CONFIRMATION PANEL                                     */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <FileCheck className="w-4 h-4 text-[#005f60]" />
            <h3 className="text-sm font-bold text-slate-900">
              Audit Review & Final Ledger Confirmation
            </h3>
          </div>
          <span className="text-[11px] text-slate-500 font-mono">
            Location: {selectedLocation}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Auditor / Storekeeper Name <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <User className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
                placeholder="e.g. Senior Storekeeper"
                className="w-full text-xs pl-8 pr-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60] bg-white font-medium text-slate-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Audit Remarks & Notes (Optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Verified with optical webcam scan #004"
              className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60] bg-white font-medium text-slate-900"
            />
          </div>
        </div>

        {/* Sync checkbox option */}
        <div className="pt-2">
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={applyToInventory}
              onChange={(e) => setApplyToInventory(e.target.checked)}
              className="mt-0.5 rounded text-[#005f60] focus:ring-[#005f60] border-slate-300"
            />
            <div>
              <span className="text-xs font-semibold text-slate-800">
                Synchronize inventory records with physical detected counts
              </span>
              <p className="text-[11px] text-slate-500">
                If checked, official available quantities in the catalog will be updated to match the detected stock.
              </p>
            </div>
          </label>
        </div>

        {/* Success Confirmation Toast Notice */}
        {isConfirmedSuccess && confirmedDetails && (
          <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center justify-between text-xs animate-in fade-in duration-200">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                <strong>Stock Check Confirmed:</strong> Recorded {confirmedDetails.matched} matched items and {confirmedDetails.discrepancies} discrepancies for {selectedLocation}.
              </span>
            </div>
            <span className="text-[11px] font-mono text-emerald-700 font-semibold">
              Logged to Audit Trail
            </span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            {discrepanciesCount > 0 ? (
              <span className="text-amber-800 font-semibold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                {discrepanciesCount} discrepancies will be logged in the permanent audit ledger.
              </span>
            ) : (
              <span className="text-emerald-700 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                All {totalItemsCount} items match ledger expectations perfectly.
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <button
              onClick={() => setStatusFilter(statusFilter === 'DISCREPANCIES' ? 'ALL' : 'DISCREPANCIES')}
              className="flex-1 sm:flex-initial px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 text-xs font-semibold transition-colors"
            >
              {statusFilter === 'DISCREPANCIES' ? 'Show All Rows' : 'Review Discrepancies'}
            </button>

            <button
              id="confirm-stock-check-btn"
              onClick={handleConfirm}
              className="flex-1 sm:flex-initial px-5 py-2 rounded-lg bg-[#005f60] hover:bg-[#004d4e] text-white text-xs font-bold transition-colors shadow-xs flex items-center justify-center gap-2"
            >
              <Check className="w-4 h-4" />
              <span>Confirm Stock Check</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

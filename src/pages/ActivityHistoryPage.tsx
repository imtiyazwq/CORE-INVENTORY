import React, { useState } from 'react';
import {
  History,
  Scan,
  ClipboardCheck,
  Filter,
  Calendar,
  User,
  MapPin,
  CheckCircle,
  AlertTriangle,
  Search,
  Users,
} from 'lucide-react';
import { ScanRecord, StockCheckRecord } from '../types';
import { VALID_LOCATIONS } from '../data/locations';

interface ActivityHistoryPageProps {
  scanHistory: ScanRecord[];
  stockChecks: StockCheckRecord[];
}

export const ActivityHistoryPage: React.FC<ActivityHistoryPageProps> = ({
  scanHistory,
  stockChecks,
}) => {
  const [filterType, setFilterType] = useState<'ALL' | 'YOLO_SCAN' | 'STOCK_CHECK'>('ALL');
  const [selectedLocation, setSelectedLocation] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Unify entries into audit logs
  type UnifiedHistoryEntry = {
    id: string;
    type: 'YOLO_SCAN' | 'STOCK_CHECK';
    date: string;
    time: string;
    location: string;
    user: string;
    team?: string;
    itemsSummary: string;
    totalQuantity: number;
    result: string;
    isDiscrepancy: boolean;
  };

  const unifiedLogs: UnifiedHistoryEntry[] = [];

  scanHistory.forEach((scan) => {
    const parts = scan.timestamp.split(' ');
    const date = parts[0] || scan.timestamp;
    const time = parts[1] || '';
    const itemsSummary = scan.itemsDetected
      .map((it) => `${it.className} (${it.quantity})`)
      .join(', ');

    unifiedLogs.push({
      id: scan.id,
      type: 'YOLO_SCAN',
      date,
      time,
      location: scan.location,
      user: scan.user,
      team: scan.team,
      itemsSummary,
      totalQuantity: scan.totalQuantity,
      result: scan.status,
      isDiscrepancy: scan.status !== 'Confirmed',
    });
  });

  stockChecks.forEach((chk) => {
    const parts = chk.timestamp.split(' ');
    const date = parts[0] || chk.timestamp;
    const time = parts[1] || '';
    const itemsSummary = chk.items
      .map((it) => `${it.name} [Exp: ${it.expected}, Det: ${it.detected}]`)
      .join(', ');
    const totalDet = chk.items.reduce((acc, it) => acc + it.detected, 0);

    unifiedLogs.push({
      id: chk.id,
      type: 'STOCK_CHECK',
      date,
      time,
      location: chk.location,
      user: chk.operator || chk.user || 'Storekeeper',
      team: chk.team,
      itemsSummary,
      totalQuantity: totalDet,
      result:
        chk.discrepancyCount === 0
          ? '100% Matched'
          : `${chk.discrepancyCount} Discrepanc${chk.discrepancyCount === 1 ? 'y' : 'ies'}`,
      isDiscrepancy: chk.discrepancyCount > 0,
    });
  });

  // Filter logs
  const filteredLogs = unifiedLogs.filter((entry) => {
    if (filterType !== 'ALL' && entry.type !== filterType) return false;
    if (selectedLocation !== 'ALL' && entry.location !== selectedLocation) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const match =
        entry.location.toLowerCase().includes(q) ||
        entry.user.toLowerCase().includes(q) ||
        (entry.team && entry.team.toLowerCase().includes(q)) ||
        entry.itemsSummary.toLowerCase().includes(q) ||
        entry.result.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4 pb-12">
      {/* Controls & Filter Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search activity records..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-xs pl-9 pr-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          {/* Scan Type Filter */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs">
            <button
              onClick={() => setFilterType('ALL')}
              className={`px-2.5 py-1 rounded font-medium transition-all cursor-pointer ${
                filterType === 'ALL'
                  ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              All Logs
            </button>
            <button
              onClick={() => setFilterType('YOLO_SCAN')}
              className={`px-2.5 py-1 rounded font-medium transition-all flex items-center gap-1 cursor-pointer ${
                filterType === 'YOLO_SCAN'
                  ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Scan className="w-3 h-3 text-[#005f60]" />
              YOLO Scans
            </button>
            <button
              onClick={() => setFilterType('STOCK_CHECK')}
              className={`px-2.5 py-1 rounded font-medium transition-all flex items-center gap-1 cursor-pointer ${
                filterType === 'STOCK_CHECK'
                  ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <ClipboardCheck className="w-3 h-3 text-[#005f60]" />
              Stock Checks
            </button>
          </div>

          {/* Location Filter */}
          <select
            value={selectedLocation}
            onChange={(e) => setSelectedLocation(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60] bg-white font-medium text-slate-800 cursor-pointer"
          >
            <option value="ALL">All Stores</option>
            {VALID_LOCATIONS.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* History Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap border-collapse">
            <thead className="bg-slate-100/90 border-b-2 border-slate-200 text-slate-700 font-bold select-none">
              <tr>
                <th className="px-3.5 py-2.5 border-r border-slate-200/80">Date & Time</th>
                <th className="px-3.5 py-2.5 border-r border-slate-200/80">Type</th>
                <th className="px-3.5 py-2.5 border-r border-slate-200/80">Location</th>
                <th className="px-3.5 py-2.5 border-r border-slate-200/80">User / Operator</th>
                <th className="px-3.5 py-2.5 border-r border-slate-200/80">Team</th>
                <th className="px-3.5 py-2.5 border-r border-slate-200/80">Items Summary</th>
                <th className="px-3.5 py-2.5 text-center border-r border-slate-200/80">Quantity</th>
                <th className="px-3.5 py-2.5 text-right">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {filteredLogs.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50/80 transition-colors divide-x divide-slate-100">
                  <td className="px-3.5 py-2.5 font-mono text-[11px] text-slate-700 font-medium">
                    {entry.date} <span className="text-slate-400 font-normal">{entry.time}</span>
                  </td>
                  <td className="px-3.5 py-2.5">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 w-max border ${
                        entry.type === 'YOLO_SCAN'
                          ? 'bg-teal-50 text-teal-800 border-teal-200'
                          : 'bg-indigo-50 text-indigo-800 border-indigo-200'
                      }`}
                    >
                      {entry.type === 'YOLO_SCAN' ? (
                        <>
                          <Scan className="w-2.5 h-2.5" />
                          YOLO Scan
                        </>
                      ) : (
                        <>
                          <ClipboardCheck className="w-2.5 h-2.5" />
                          Stock Check
                        </>
                      )}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5 text-slate-700 font-medium">
                    <span className="truncate max-w-[160px] block" title={entry.location}>
                      {entry.location}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5 font-medium text-slate-900">
                    {entry.user}
                  </td>
                  <td className="px-3.5 py-2.5 text-slate-600 font-medium">
                    {entry.team ? (
                      <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-slate-800 text-[10px] border border-slate-200">
                        {entry.team}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5 text-slate-600 max-w-xs truncate" title={entry.itemsSummary}>
                    {entry.itemsSummary}
                  </td>
                  <td className="px-3.5 py-2.5 text-center font-mono font-bold text-slate-900">
                    {entry.totalQuantity}
                  </td>
                  <td className="px-3.5 py-2.5 text-right">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                        entry.isDiscrepancy
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      }`}
                    >
                      {entry.result}
                    </span>
                  </td>
                </tr>
              ))}

              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    No activity records found matching filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

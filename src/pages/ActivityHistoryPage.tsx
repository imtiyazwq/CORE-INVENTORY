import React, { useState, useMemo } from 'react';
import {
  History,
  Scan,
  MapPin,
  User,
  Clock,
  Filter,
  Download,
  Calendar,
  Layers,
  ChevronDown,
} from 'lucide-react';
import { ScanRecord, ValidLocation } from '../types';
import { VALID_LOCATIONS } from '../data/locations';

interface ActivityHistoryPageProps {
  scanHistory: ScanRecord[];
}

export const ActivityHistoryPage: React.FC<ActivityHistoryPageProps> = ({
  scanHistory,
}) => {
  const [selectedLocation, setSelectedLocation] = useState<ValidLocation | 'ALL'>('ALL');
  const [selectedType, setSelectedType] = useState<'ALL' | 'webcam' | 'upload'>('ALL');

  const filteredScans = useMemo(() => {
    return scanHistory.filter((scan) => {
      if (selectedLocation !== 'ALL' && scan.location !== selectedLocation) return false;
      if (selectedType !== 'ALL' && scan.type !== selectedType) return false;
      return true;
    });
  }, [scanHistory, selectedLocation, selectedType]);

  const handleExportHistoryCSV = () => {
    const headers = ['Scan ID', 'Timestamp', 'Location', 'Type', 'Operator', 'Team', 'Status', 'Items Detected', 'Notes'];
    const rows = filteredScans.map((s) => [
      s.id,
      s.timestamp,
      s.location,
      s.type,
      `"${s.user.replace(/"/g, '""')}"`,
      `"${(s.team || '').replace(/"/g, '""')}"`,
      s.status,
      `"${s.itemsDetected.map((i) => `${i.className} x${i.quantity}`).join('; ')}"`,
      `"${(s.notes || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `inventory_activity_log_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4 pb-12">
      {/* Header & Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#005f60] text-white flex items-center justify-center">
              <History className="w-4 h-4" />
            </div>
            <h2 className="text-base font-bold text-slate-900">Activity & Audit Log</h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 font-semibold">
              {filteredScans.length} Entries
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Complete immutable ledger of camera scans, file imports, and stock reconciliations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Location filter */}
          <select
            value={selectedLocation}
            onChange={(e) => setSelectedLocation(e.target.value as any)}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-medium text-slate-800"
          >
            <option value="ALL">All Stores</option>
            {VALID_LOCATIONS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>

          {/* Type filter */}
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value as any)}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-medium text-slate-800"
          >
            <option value="ALL">All Scan Types</option>
            <option value="webcam">Live Webcam</option>
            <option value="upload">Image Upload</option>
          </select>

          <button
            onClick={handleExportHistoryCSV}
            className="px-3 py-1.5 text-xs font-semibold text-[#005f60] bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export Log
          </button>
        </div>
      </div>

      {/* Log Feed Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold select-none">
              <tr>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-3 py-3">Location</th>
                <th className="px-3 py-3 text-center">Type</th>
                <th className="px-3 py-3">Auditor / Operator</th>
                <th className="px-3 py-3">Team</th>
                <th className="px-4 py-3">Items Logged</th>
                <th className="px-3 py-3">Notes</th>
                <th className="px-3 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredScans.map((scan) => {
                const totalUnits = scan.itemsDetected.reduce((acc, it) => acc + it.quantity, 0);

                return (
                  <tr key={scan.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-600">
                      <div className="font-semibold text-slate-900">{scan.timestamp}</div>
                      <div className="text-[10px] text-slate-400">{scan.id}</div>
                    </td>

                    <td className="px-3 py-3">
                      <span className="font-medium text-slate-900 flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-[#005f60]" />
                        {scan.location}
                      </span>
                    </td>

                    <td className="px-3 py-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          scan.type === 'webcam'
                            ? 'bg-purple-50 text-purple-800 border-purple-200'
                            : 'bg-blue-50 text-blue-800 border-blue-200'
                        }`}
                      >
                        {scan.type === 'webcam' ? 'Webcam' : 'Upload'}
                      </span>
                    </td>

                    <td className="px-3 py-3 font-medium text-slate-800">
                      {scan.user}
                    </td>

                    <td className="px-3 py-3 text-slate-600">
                      {scan.team || '—'}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1 max-w-sm">
                        {scan.itemsDetected.map((item, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[11px] font-medium text-slate-700"
                          >
                            {item.className} × <strong>{item.quantity}</strong>
                          </span>
                        ))}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                        {totalUnits} units total
                      </div>
                    </td>

                    <td className="px-3 py-3 text-slate-600 italic text-[11px] max-w-xs truncate">
                      {scan.notes || '—'}
                    </td>

                    <td className="px-3 py-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          scan.status === 'Confirmed'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}
                      >
                        {scan.status}
                      </span>
                    </td>
                  </tr>
                );
              })}

              {filteredScans.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <History className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <p className="font-semibold text-slate-600">No activity logged</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Scans and audits will appear here once executed.
                    </p>
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

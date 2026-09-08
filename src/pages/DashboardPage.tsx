import React from 'react';
import {
  Package,
  Layers,
  CheckCircle2,
  Clock,
  MapPin,
  Scan,
  AlertTriangle,
  ArrowUpRight,
  ExternalLink,
  ShieldCheck,
  Camera,
  Upload,
  Sparkles,
} from 'lucide-react';
import { InventoryItem, ScanRecord } from '../types';
import { VALID_LOCATIONS } from '../data/locations';
import { StatCard } from '../components/StatCard';
import { PageId } from '../components/Sidebar';

interface DashboardPageProps {
  items: InventoryItem[];
  scanHistory: ScanRecord[];
  onNavigate: (page: PageId, scanMode?: 'webcam' | 'upload') => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  items,
  scanHistory,
  onNavigate,
}) => {
  // Statistics calculations
  const totalAssetsCount = items.length; // Number of inventory records/items
  const totalPhysicalQuantity = items.reduce((acc, it) => acc + it.quantity, 0); // Total number of physical units
  const availableCount = items.reduce((acc, it) => acc + it.availableQuantity, 0); // Currently available
  const checkedOutCount = totalPhysicalQuantity - availableCount; // Currently checked out

  // Recent YOLO scans (up to 4)
  const recentScans = scanHistory.slice(0, 4);

  // Low stock items (available quantity <= 2 or marked Low Stock)
  const lowStockItems = items.filter(
    (it) => it.availableQuantity <= 2 || it.status === 'Low Stock'
  );

  // Recent Checked Out non-consumable assets
  const checkedOutAssets = items
    .filter((it) => it.assetType === 'Non-Consumable' && it.status === 'Checked Out')
    .slice(0, 5);

  return (
    <div className="space-y-6 pb-12">
      {/* ========================================================================= */}
      {/* 1. COMPACT SCAN INVENTORY SHORTCUT ACTION BAR                              */}
      {/* ========================================================================= */}
      <div className="bg-[#1e242d] rounded-xl border border-[#323c4a] px-4 py-3.5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#005f60] flex items-center justify-center text-white shadow-xs shrink-0 border border-teal-500/30">
            <Scan className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-white tracking-normal">
                Scan Inventory
              </h2>
              <span className="text-[10px] font-mono font-medium text-teal-300 bg-teal-950/80 border border-teal-700/60 px-1.5 py-0.2 rounded">
                YOLO Neural Detection
              </span>
            </div>
            <p className="text-[11px] text-slate-300">
              Run real-time computer vision detection to identify, count, and log inventory across stores.
            </p>
          </div>
        </div>

        {/* Compact, responsive action buttons that do not dominate the dashboard */}
        <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
          {/* Button 1: Scan with Webcam */}
          <button
            onClick={() => onNavigate('scan', 'webcam')}
            className="flex-1 sm:flex-initial px-3 py-1.5 rounded-lg bg-[#005f60] hover:bg-[#004d4e] text-white text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-colors border border-teal-500/30 cursor-pointer"
            title="Scan items using connected camera"
          >
            <Camera className="w-3.5 h-3.5 text-teal-200" />
            <span>Scan Webcam</span>
          </button>

          {/* Button 2: Upload Image */}
          <button
            onClick={() => onNavigate('scan', 'upload')}
            className="flex-1 sm:flex-initial px-3 py-1.5 rounded-lg bg-[#2b3543] hover:bg-[#354152] text-slate-200 hover:text-white border border-[#3e4c5e] text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            title="Upload and analyze an inventory photo"
          >
            <Upload className="w-3.5 h-3.5 text-slate-300" />
            <span>Upload Image</span>
          </button>
        </div>
      </div>

      {/* 5 Stats Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          id="stat-total-assets"
          title="Total Assets"
          value={totalAssetsCount}
          subtitle="Registered catalog entries"
          icon={Package}
          badgeText={`${totalAssetsCount} active`}
          badgeType="slate"
        />

        <StatCard
          id="stat-total-quantity"
          title="Total Quantity"
          value={totalPhysicalQuantity}
          subtitle="Physical units in stock"
          icon={Layers}
          badgeText="Physical"
          badgeType="teal"
        />

        <StatCard
          id="stat-available"
          title="Available"
          value={availableCount}
          subtitle={
            totalPhysicalQuantity > 0
              ? `${Math.round((availableCount / totalPhysicalQuantity) * 100)}% available ratio`
              : '0% available ratio'
          }
          icon={CheckCircle2}
          badgeText="Ready"
          badgeType="emerald"
        />

        <StatCard
          id="stat-checked-out"
          title="Checked Out"
          value={checkedOutCount}
          subtitle="Assigned to personnel"
          icon={Clock}
          badgeText={checkedOutCount > 0 ? 'In Use' : 'None'}
          badgeType="amber"
        />

        <StatCard
          id="stat-locations"
          title="Locations"
          value="4 Locations"
          subtitle="Single source of truth"
          icon={MapPin}
          badgeText="100% Verified"
          badgeType="teal"
        />
      </div>

      {/* Balanced 2-Column Section: Recent YOLO Scans vs Audit Discrepancies */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* Recent YOLO Scan Card */}
        <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-[#005f60]/10 text-[#005f60] flex items-center justify-center">
                  <Scan className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Recent YOLO Scan</h3>
                  <p className="text-[11px] text-slate-500">
                    Most recent inventory scans & neural detections
                  </p>
                </div>
              </div>
              <button
                onClick={() => onNavigate('scan', 'webcam')}
                className="text-xs font-bold text-[#005f60] hover:underline flex items-center gap-1"
              >
                New Scan
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-3">
              {recentScans.length > 0 ? (
                recentScans.map((scan) => (
                  <div
                    key={scan.id}
                    className="p-3 rounded-lg border border-slate-200/80 bg-slate-50/70 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="font-bold text-slate-900 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#005f60]"></span>
                        {scan.location}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500">
                        {scan.timestamp}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      {scan.itemsDetected.map((item, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded bg-white border border-slate-200 text-[11px] font-medium"
                        >
                          {item.className} ×{' '}
                          <strong className="text-slate-900 font-mono">
                            {item.quantity}
                          </strong>{' '}
                          <span className="text-slate-500 font-mono text-[10px]">
                            ({(item.confidence * 100).toFixed(0)}%)
                          </span>
                        </span>
                      ))}
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 pt-1.5 border-t border-slate-200/60">
                      <span>Operator: {scan.user}</span>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] font-semibold border ${
                          scan.status === 'Confirmed'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}
                      >
                        {scan.status}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center flex flex-col items-center justify-center">
                  <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-2">
                    <Scan className="w-4 h-4" />
                  </div>
                  <p className="text-xs font-medium text-slate-700">No scans recorded yet</p>
                  <p className="text-[11px] text-slate-400 max-w-xs mt-0.5">
                    Upload an image or start a webcam scan to record real detection activity.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Powered by YOLOv8 TFLite Engine</span>
            <button
              onClick={() => onNavigate('history')}
              className="text-[#005f60] font-semibold hover:underline text-[11px]"
            >
              View Full History →
            </button>
          </div>
        </div>

        {/* Stock Level Alerts Card */}
        <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-amber-50 border border-amber-200/60 text-amber-700 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Stock Level Alerts</h3>
                  <p className="text-[11px] text-slate-500">
                    Low quantity and replenishment monitors
                  </p>
                </div>
              </div>
              <button
                onClick={() => onNavigate('inventory')}
                className="text-xs font-bold text-[#005f60] hover:underline flex items-center gap-1"
              >
                View Inventory
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-2.5">
              {lowStockItems.length > 0 ? (
                lowStockItems.slice(0, 4).map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-lg border border-slate-200/80 bg-slate-50/70 hover:bg-slate-50 transition-colors flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-bold text-slate-900 block text-xs">
                        {item.name}
                      </span>
                      <span className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3 text-[#005f60]" />
                        {item.location} • {item.category}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right text-[11px] font-mono text-slate-500">
                        <div>
                          Avail: <span className="text-slate-800 font-bold">{item.availableQuantity}</span>
                        </div>
                        <div>
                          Total: <span className="text-slate-800 font-bold">{item.quantity}</span>
                        </div>
                      </div>

                      <div
                        className={`px-2.5 py-1 rounded font-mono text-xs font-bold ${
                          item.availableQuantity === 0
                            ? 'bg-rose-100 text-rose-800 border border-rose-200'
                            : 'bg-amber-100 text-amber-800 border border-amber-200'
                        }`}
                      >
                        {item.availableQuantity === 0 ? 'Out of Stock' : `${item.availableQuantity} Left`}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center text-xs text-emerald-800 bg-emerald-50/60 rounded-lg border border-emerald-200 flex flex-col items-center justify-center">
                  <ShieldCheck className="w-6 h-6 text-emerald-600 mb-1" />
                  <span className="font-medium">All store inventory levels are healthy.</span>
                </div>
              )}
            </div>
          </div>

          <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Keep safety buffers to prevent stockouts</span>
            <button
              onClick={() => onNavigate('inventory')}
              className="text-[#005f60] font-semibold hover:underline text-[11px]"
            >
              Open Inventory List →
            </button>
          </div>
        </div>
      </div>

      {/* Checked Out Assets Section */}
      <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-xs">
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-slate-100 border border-slate-200/60 text-slate-700 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Checked Out Assets</h3>
              <p className="text-[11px] text-slate-500">
                Active custodian tracking for non-consumable equipment
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigate('inventory')}
            className="text-xs font-bold text-[#005f60] hover:underline flex items-center gap-1"
          >
            Catalog Table
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold">
              <tr>
                <th className="px-3 py-2">Item Code</th>
                <th className="px-3 py-2">Asset Name</th>
                <th className="px-3 py-2">Custodian User</th>
                <th className="px-3 py-2">Team / Dept</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Checked Out Date</th>
                <th className="px-3 py-2">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {checkedOutAssets.map((asset) => (
                <tr key={asset.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-3 py-2 font-mono text-[11px] font-bold text-slate-700">
                    {asset.itemCode}
                  </td>
                  <td className="px-3 py-2 font-bold text-slate-900 max-w-xs truncate">
                    {asset.name}
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {asset.user || '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {asset.team || '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-600 truncate">
                    {asset.location}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-500">
                    {asset.checkedOutAt ? asset.checkedOutAt.slice(0, 10) : '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-500">
                    {asset.lastSeen}
                  </td>
                </tr>
              ))}
              {checkedOutAssets.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-400 font-medium">
                    All non-consumable assets are currently checked in and available.
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

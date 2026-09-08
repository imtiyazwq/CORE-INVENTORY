import React from 'react';
import {
  LayoutDashboard,
  Boxes,
  ScanLine,
  ClipboardCheck,
  History,
  Settings,
  Database,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { VALID_LOCATIONS } from '../data/locations';

export type PageId =
  | 'dashboard'
  | 'inventory'
  | 'scan'
  | 'stock-check'
  | 'history'
  | 'settings';

interface SidebarProps {
  activePage: PageId;
  onSelectPage: (page: PageId) => void;
  pendingCount: number;
  isOnline: boolean;
  totalAssetsCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activePage,
  onSelectPage,
  pendingCount,
  isOnline,
  totalAssetsCount,
}) => {
  const navItems: Array<{
    id: PageId;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string | number;
  }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'scan', label: 'Scan Inventory', icon: ScanLine },
    { id: 'inventory', label: 'Inventory', icon: Boxes, badge: totalAssetsCount },
    { id: 'stock-check', label: 'Stock Check', icon: ClipboardCheck },
    { id: 'history', label: 'Activity / History', icon: History },
    { id: 'settings', label: 'Settings', icon: Settings, badge: pendingCount > 0 ? `${pendingCount} queue` : undefined },
  ];

  return (
    <aside
      id="app-sidebar"
      className="w-64 bg-[#1e242d] text-slate-200 flex flex-col shrink-0 border-r border-[#2d3642] select-none min-h-screen"
    >
      {/* Brand Header with Modern Graphic Inventory Logo */}
      <div className="p-5 border-b border-[#2d3642] flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#005f60] flex items-center justify-center text-white shadow-md border border-teal-500/40 shrink-0">
          {/* Refined Modern Vector Inventory Box & Optical Reticle Logo */}
          <svg
            className="w-5 h-5 text-white"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* Isometric Stock Container Cube */}
            <path d="M12 2L3 7v10l9 5 9-5V7L12 2z" />
            <path d="M12 22V12" />
            <path d="M21 7l-9 5L3 7" />
            {/* Horizontal Stored Layer Dividers */}
            <path d="M7.5 9.5l4.5 2.5 4.5-2.5" stroke="#5eead4" strokeWidth="1.4" opacity="0.85" />
            {/* Precision Optical Scanner Target */}
            <circle cx="12" cy="7" r="1.5" fill="#5eead4" />
          </svg>
        </div>
        <div>
          <h1 className="text-[13px] font-extrabold text-white tracking-wider uppercase leading-none font-sans">
            CORE INVENTORY
          </h1>
          <p className="text-[10px] text-teal-400 mt-1 font-mono flex items-center gap-1.5 font-medium">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-teal-400"></span>
            YOLO TFLite v8
          </p>
        </div>
      </div>

      {/* Nav Items */}
      <nav className="flex-1 px-3 py-4 space-y-1.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              id={`nav-btn-${item.id}`}
              onClick={() => onSelectPage(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold transition-all duration-150 text-left ${
                isActive
                  ? 'bg-[#005f60] text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-[#28313e]'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon
                  className={`w-4 h-4 transition-colors ${
                    isActive ? 'text-teal-200' : 'text-slate-400'
                  }`}
                />
                <span className="tracking-wide">{item.label}</span>
              </div>
              {item.badge !== undefined && (
                <span
                  className={`px-1.5 py-0.5 text-[10px] font-mono rounded ${
                    isActive
                      ? 'bg-teal-900/80 text-teal-100'
                      : 'bg-[#2b3543] text-slate-300'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Locations Footprint Indicator (Darker shade of reference color) */}
      <div className="px-4 py-3.5 border-t border-[#2a333f] bg-[#141922]">
        <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
          <span className="font-semibold text-slate-300">Managed Locations</span>
          <span className="font-mono text-teal-400 font-bold">
            {VALID_LOCATIONS.length} Active
          </span>
        </div>
        <div className="space-y-1.5 text-[10px] font-mono text-slate-400">
          {VALID_LOCATIONS.map((loc) => (
            <div key={loc} className="truncate flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-500/60 shrink-0"></span>
              <span className="truncate text-slate-300">{loc.replace(/Store_\d+_/, '')}</span>
            </div>
          ))}
        </div>
      </div>

      {/* System Status Footer */}
      <div className="p-4 border-t border-[#2a333f] bg-[#191f28]">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            {isOnline ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span
              className={`text-[11px] font-medium ${
                isOnline ? 'text-slate-300' : 'text-amber-300'
              }`}
            >
              {isOnline ? 'Connected' : 'Offline Storage'}
            </span>
          </div>
          <span className="text-[10px] font-mono text-slate-400 font-medium">Local Ledger</span>
        </div>
      </div>
    </aside>
  );
};

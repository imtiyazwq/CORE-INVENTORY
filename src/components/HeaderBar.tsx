import React from 'react';
import { Wifi, WifiOff, RefreshCw, LogOut } from 'lucide-react';
import { PageId } from './Sidebar';
import { UserAccount } from '../types';

interface HeaderBarProps {
  activePage: PageId;
  isOnline: boolean;
  pendingCount: number;
  lastSyncedAt: string;
  onSyncNow: () => void;
  currentUser?: UserAccount | null;
  onLogout?: () => void;
}

const PAGE_TITLES: Record<PageId, string> = {
  dashboard: 'Dashboard',
  scan: 'Scan Inventory',
  inventory: 'Inventory',
  stockcheck: 'Stock Check',
  history: 'Activity / History',
  settings: 'Settings',
};

export const HeaderBar: React.FC<HeaderBarProps> = ({
  activePage,
  isOnline,
  pendingCount,
  lastSyncedAt,
  onSyncNow,
  currentUser,
  onLogout,
}) => {
  const currentTitle = PAGE_TITLES[activePage] || 'Inventory';

  return (
    <header
      id="app-header-bar"
      className="h-14 px-4 sm:px-6 border-b border-slate-200/90 bg-white flex items-center justify-between shrink-0 shadow-2xs sticky top-0 z-20"
    >
      <div>
        <h2 className="text-base sm:text-lg font-semibold text-slate-900 tracking-normal">
          {currentTitle}
        </h2>
      </div>

      <div className="flex items-center gap-3 sm:gap-4">
        {/* Network & Offline Status Pill */}
        <div className="hidden sm:flex items-center gap-2.5 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg text-xs shadow-2xs">
          {isOnline ? (
            <div className="flex items-center gap-1.5 text-emerald-800">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className="font-semibold text-[11px]">Online</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-amber-800">
              <WifiOff className="w-3.5 h-3.5 text-amber-600" />
              <span className="font-semibold text-[11px]">Offline Storage</span>
            </div>
          )}

          <span className="text-slate-300">|</span>

          <span className="text-[11px] text-slate-600 font-mono">
            Sync: {lastSyncedAt}
          </span>

          {pendingCount > 0 && (
            <button
              onClick={onSyncNow}
              title="Force sync pending changes"
              className="ml-1 px-2 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300/80 rounded text-[10px] font-mono font-bold flex items-center gap-1 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-2.5 h-2.5" />
              {pendingCount} queued
            </button>
          )}
        </div>

        {/* Authenticated User Account Indicator */}
        {currentUser && (
          <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg">
              <div className="w-6 h-6 rounded-full bg-[#005f60] text-white flex items-center justify-center text-xs font-bold shrink-0">
                {currentUser.userName ? currentUser.userName.charAt(0).toUpperCase() : 'U'}
              </div>
              <div className="text-left hidden md:block">
                <div className="text-xs font-bold text-slate-900 leading-tight">
                  {currentUser.userName}
                </div>
                <div className="text-[10px] text-slate-500 leading-tight">
                  {currentUser.teamName}
                </div>
              </div>
            </div>

            {onLogout && (
              <button
                onClick={onLogout}
                title="Sign out of account"
                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
};

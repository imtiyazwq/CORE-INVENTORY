import React, { useState, useMemo } from 'react';
import {
  Search,
  Download,
  Filter,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  UserCheck,
  RotateCcw,
  MapPin,
  Package,
} from 'lucide-react';
import { InventoryItem, AssetType, ItemStatus, ValidLocation } from '../types';
import { VALID_LOCATIONS } from '../data/locations';
import {
  filterInventoryItems,
  sortInventoryItems,
  exportInventoryToCSV,
  SortField,
  SortDirection,
} from '../services/inventoryService';
import { CheckoutModal } from '../components/CheckoutModal';

interface InventoryPageProps {
  items: InventoryItem[];
  onCheckoutItem: (itemId: string, user: string, team: string, qty: number) => void;
  onCheckinItem: (itemId: string, returnLocation: ValidLocation, qty: number) => void;
}

export const InventoryPage: React.FC<InventoryPageProps> = ({
  items,
  onCheckoutItem,
  onCheckinItem,
}) => {
  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAssetType, setSelectedAssetType] = useState<AssetType | 'ALL'>('ALL');
  const [selectedLocation, setSelectedLocation] = useState<ValidLocation | 'ALL'>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<ItemStatus | 'ALL'>('ALL');
  const [selectedTeam, setSelectedTeam] = useState<string | 'ALL'>('ALL');

  // Sorting States
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Checkout / Check-in Modal State
  const [activeModalItem, setActiveModalItem] = useState<InventoryItem | null>(null);
  const [activeModalMode, setActiveModalMode] = useState<'checkout' | 'checkin'>('checkout');

  // Extract unique existing teams for filter dropdown
  const uniqueTeams = useMemo(() => {
    const set = new Set<string>();
    items.forEach((it) => {
      if (it.team && it.team.trim() && it.team !== 'Unassigned') {
        set.add(it.team.trim());
      }
    });
    return Array.from(set).sort();
  }, [items]);

  // Handle header click for sorting
  const handleSortClick = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Filter and sort items
  const filteredAndSortedItems = useMemo(() => {
    const filtered = filterInventoryItems(items, {
      searchQuery,
      assetType: selectedAssetType,
      location: selectedLocation,
      status: selectedStatus,
      team: selectedTeam,
    });
    return sortInventoryItems(filtered, sortField, sortDirection);
  }, [
    items,
    searchQuery,
    selectedAssetType,
    selectedLocation,
    selectedStatus,
    selectedTeam,
    sortField,
    sortDirection,
  ]);

  const handleExportCSV = () => {
    exportInventoryToCSV(filteredAndSortedItems);
  };

  const renderSortIndicator = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-slate-400 opacity-60 inline ml-1" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-[#005f60] inline ml-1" />
    ) : (
      <ArrowDown className="w-3 h-3 text-[#005f60] inline ml-1" />
    );
  };

  const getStatusBadge = (status: ItemStatus) => {
    switch (status) {
      case 'Available':
        return 'bg-emerald-50 text-emerald-800 border-emerald-200';
      case 'Checked Out':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'Under Maintenance':
        return 'bg-blue-50 text-blue-800 border-blue-200';
      case 'Missing':
      case 'Lost':
      case 'Damaged':
        return 'bg-rose-50 text-rose-800 border-rose-200';
      case 'Disposed':
        return 'bg-slate-100 text-slate-700 border-slate-200';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  return (
    <div className="space-y-4 pb-12">
      {/* Search & Actions Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search item, code, spec, user..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-xs pl-9 pr-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-[10px] text-slate-400 hover:text-slate-600 absolute right-2.5 top-1/2 -translate-y-1/2 font-mono"
            >
              CLEAR
            </button>
          )}
        </div>

        <div className="flex items-center gap-2.5 w-full md:w-auto justify-between md:justify-end">
          <span className="text-xs text-slate-500 font-mono">
            Showing <strong>{filteredAndSortedItems.length}</strong> of {items.length} items
          </span>
          <button
            onClick={handleExportCSV}
            className="px-3 py-2 text-xs font-semibold text-[#005f60] bg-teal-50 hover:bg-teal-100/70 border border-teal-200 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* 4 Strict Filters Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 mb-2">
          <Filter className="w-3.5 h-3.5 text-[#005f60]" />
          Filter Inventory:
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Asset Type Filter */}
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">
              Asset Type
            </label>
            <select
              value={selectedAssetType}
              onChange={(e) => setSelectedAssetType(e.target.value as any)}
              className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60] bg-white font-medium text-slate-800"
            >
              <option value="ALL">All Asset Types</option>
              <option value="Consumable">Consumable</option>
              <option value="Controllable Asset">Controllable Asset</option>
              <option value="Non-Consumable">Non-Consumable</option>
            </select>
          </div>

          {/* Location Filter: STRICTLY 4 LOCATIONS ONLY */}
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1 flex items-center justify-between">
              <span>Location (4 Stores)</span>
              <span className="text-[10px] text-teal-700 font-mono">Verified</span>
            </label>
            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value as any)}
              className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60] bg-white font-medium text-slate-800"
            >
              <option value="ALL">All 4 Stores</option>
              {VALID_LOCATIONS.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">
              Status
            </label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value as any)}
              className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60] bg-white font-medium text-slate-800"
            >
              <option value="ALL">All Statuses</option>
              <option value="Available">Available</option>
              <option value="Checked Out">Checked Out</option>
              <option value="Missing">Missing</option>
              <option value="Lost">Lost</option>
              <option value="Damaged">Damaged</option>
              <option value="Under Maintenance">Under Maintenance</option>
              <option value="Disposed">Disposed</option>
            </select>
          </div>

          {/* Team Filter */}
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">
              Responsible Team
            </label>
            <select
              value={selectedTeam}
              onChange={(e) => setSelectedTeam(e.target.value)}
              className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60] bg-white font-medium text-slate-800"
            >
              <option value="ALL">All Teams</option>
              <option value="None">None (Unassigned)</option>
              {uniqueTeams.map((tm) => (
                <option key={tm} value={tm}>
                  {tm}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Full Inventory Catalog Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap border-collapse">
            <thead className="bg-slate-100/90 border-b-2 border-slate-200 text-slate-700 font-bold select-none">
              <tr>
                <th
                  onClick={() => handleSortClick('name')}
                  className="px-3.5 py-2.5 cursor-pointer hover:text-[#005f60] transition-colors border-r border-slate-200/80"
                >
                  Item / Code {renderSortIndicator('name')}
                </th>
                <th
                  onClick={() => handleSortClick('assetType')}
                  className="px-3.5 py-2.5 cursor-pointer hover:text-[#005f60] transition-colors border-r border-slate-200/80"
                >
                  Asset Type {renderSortIndicator('assetType')}
                </th>
                <th
                  onClick={() => handleSortClick('quantity')}
                  className="px-3.5 py-2.5 text-center cursor-pointer hover:text-[#005f60] transition-colors border-r border-slate-200/80"
                >
                  Quantity {renderSortIndicator('quantity')}
                </th>
                <th
                  onClick={() => handleSortClick('location')}
                  className="px-3.5 py-2.5 cursor-pointer hover:text-[#005f60] transition-colors border-r border-slate-200/80"
                >
                  Location {renderSortIndicator('location')}
                </th>
                <th className="px-3.5 py-2.5 border-r border-slate-200/80">Rack / Shelf</th>
                <th className="px-3.5 py-2.5 text-center border-r border-slate-200/80">Status</th>
                <th className="px-3.5 py-2.5 border-r border-slate-200/80">User (Custodian)</th>
                <th
                  onClick={() => handleSortClick('team')}
                  className="px-3.5 py-2.5 cursor-pointer hover:text-[#005f60] transition-colors border-r border-slate-200/80"
                >
                  Team {renderSortIndicator('team')}
                </th>
                <th className="px-3.5 py-2.5 border-r border-slate-200/80">Checked Out</th>
                <th
                  onClick={() => handleSortClick('lastSeen')}
                  className="px-3.5 py-2.5 cursor-pointer hover:text-[#005f60] transition-colors border-r border-slate-200/80"
                >
                  Last Seen {renderSortIndicator('lastSeen')}
                </th>
                <th className="px-3.5 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {filteredAndSortedItems.map((item) => {
                const isConsumable = item.assetType === 'Consumable';
                const hasAvailable = item.availableQuantity > 0;

                // A partial checkout can still leave the overall row "Available".
                // Borrower metadata tells us the quantity gap represents units currently out.
                const hasCheckoutRecord = Boolean(item.user || item.checkedOutAt);
                const outstandingQuantity = hasCheckoutRecord
                  ? Math.max(0, item.quantity - item.availableQuantity)
                  : 0;

                const canCheckout = item.status === 'Available' && hasAvailable;
                const canCheckin = outstandingQuantity > 0;
                const unavailableActionLabel =
                  item.status === 'Under Maintenance'
                    ? 'Maintenance'
                    : item.status === 'Available'
                      ? 'No Stock'
                      : item.status;

                return (
                  <tr key={item.id} className="hover:bg-slate-50/80 transition-colors divide-x divide-slate-100">
                    {/* Item Name & Code */}
                    <td className="px-3.5 py-2.5">
                      <div className="font-semibold text-slate-900 truncate max-w-xs" title={item.name}>
                        {item.name}
                      </div>
                      <div className="text-[10px] font-mono text-slate-500 flex items-center gap-1 mt-0.5">
                        <span className="bg-slate-100 px-1 rounded">{item.itemCode}</span>
                        {item.subCategory && (
                          <span className="text-slate-400">• {item.subCategory}</span>
                        )}
                      </div>
                      {item.remarks && (
                        <div className="text-[10px] text-teal-700 italic truncate max-w-xs mt-0.5">
                          {item.remarks}
                        </div>
                      )}
                    </td>

                    {/* Asset Type */}
                    <td className="px-3.5 py-2.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-medium border ${
                          isConsumable
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-teal-50 text-teal-800 border-teal-200'
                        }`}
                      >
                        {item.assetType}
                      </span>
                    </td>

                    {/* Quantity (Units & Available) */}
                    <td className="px-3.5 py-2.5 text-center">
                      <div className="font-mono text-xs">
                        <strong className="text-slate-900">{item.availableQuantity}</strong>
                        <span className="text-slate-400"> / {item.quantity}</span>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {item.availableQuantity === 0
                          ? item.status === 'Available'
                            ? 'No stock available'
                            : item.status
                          : `${item.availableQuantity} available`}
                      </div>
                    </td>

                    {/* Location */}
                    <td className="px-3.5 py-2.5 text-slate-700">
                      <div className="flex items-center gap-1 font-medium">
                        <MapPin className="w-3 h-3 text-[#005f60] shrink-0" />
                        <span className="truncate max-w-[160px]" title={item.location}>
                          {item.location}
                        </span>
                      </div>
                    </td>

                    {/* Rack / Shelf */}
                    <td className="px-3.5 py-2.5 font-mono text-[11px] text-slate-600">
                      {item.rackShelf}
                    </td>

                    {/* Status */}
                    <td className="px-3.5 py-2.5 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${getStatusBadge(
                          item.status
                        )}`}
                      >
                        {item.status}
                      </span>
                    </td>

                    {/* User */}
                    <td className="px-3.5 py-2.5">
                      {item.user ? (
                        <span className="font-medium text-slate-900">{item.user}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>

                    {/* Team */}
                    <td className="px-3.5 py-2.5 text-slate-600">
                      {item.team ? (
                        <span className="text-slate-800 font-medium">{item.team}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>

                    {/* Checked Out Date */}
                    <td className="px-3.5 py-2.5 font-mono text-[11px] text-slate-500">
                      {item.checkedOutAt ? item.checkedOutAt.slice(0, 10) : '—'}
                    </td>

                    {/* Last Seen */}
                    <td className="px-3.5 py-2.5 font-mono text-[11px] text-slate-500">
                      {item.lastSeen}
                    </td>

                    {/* Actions */}
                    <td className="px-3.5 py-2.5 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {canCheckin && (
                          <button
                            onClick={() => {
                              setActiveModalMode('checkin');
                              setActiveModalItem(item);
                            }}
                            className="px-2.5 py-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md transition-colors inline-flex items-center gap-1 cursor-pointer"
                            title={`Return up to ${outstandingQuantity} checked-out unit${outstandingQuantity === 1 ? '' : 's'}`}
                          >
                            <RotateCcw className="w-3 h-3" />
                            Check In
                          </button>
                        )}

                        {canCheckout && (
                          <button
                            onClick={() => {
                              setActiveModalMode('checkout');
                              setActiveModalItem(item);
                            }}
                            className="px-2.5 py-1 text-[11px] font-semibold text-[#005f60] bg-teal-50 hover:bg-teal-100/80 border border-teal-200 rounded-md transition-colors inline-flex items-center gap-1 cursor-pointer"
                          >
                            <UserCheck className="w-3 h-3" />
                            Check Out
                          </button>
                        )}

                        {!canCheckin && !canCheckout && (
                          <button
                            disabled
                            className="px-2 py-1 text-[11px] font-medium text-slate-400 bg-slate-100 rounded-md cursor-not-allowed"
                            title={`Action unavailable while item status is ${item.status}`}
                          >
                            {unavailableActionLabel}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredAndSortedItems.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-16 text-center">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
                        <Package className="w-6 h-6" />
                      </div>
                      <h4 className="text-sm font-bold text-slate-800 mb-1">
                        {items.length === 0 ? 'No Inventory Items in Ledger' : 'No Matching Records Found'}
                      </h4>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        {items.length === 0
                          ? 'All mock items have been removed. Perform a camera scan or import real inventory items to populate the ledger.'
                          : 'Try adjusting your search query, location filter, or status filter to locate items.'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Checkout / Return Modal */}
      {activeModalItem && (
        <CheckoutModal
          item={activeModalItem}
          mode={activeModalMode}
          isOpen={true}
          onClose={() => setActiveModalItem(null)}
          onConfirmCheckout={onCheckoutItem}
          onConfirmReturn={onCheckinItem}
        />
      )}
    </div>
  );
};

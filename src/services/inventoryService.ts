import { InventoryItem, AssetType, ItemStatus, ValidLocation } from '../types';

export type SortField = 'name' | 'assetType' | 'quantity' | 'location' | 'team' | 'lastSeen';
export type SortDirection = 'asc' | 'desc';

export interface InventoryFilterOptions {
  searchQuery?: string;
  assetType?: AssetType | 'ALL';
  location?: ValidLocation | 'ALL';
  status?: ItemStatus | 'ALL';
  team?: string | 'ALL';
}

export function filterInventoryItems(
  items: InventoryItem[],
  options: InventoryFilterOptions
): InventoryItem[] {
  return items.filter((item) => {
    // Search query filter
    if (options.searchQuery && options.searchQuery.trim()) {
      const q = options.searchQuery.toLowerCase().trim();
      const match =
        item.name.toLowerCase().includes(q) ||
        item.itemCode.toLowerCase().includes(q) ||
        (item.specification && item.specification.toLowerCase().includes(q)) ||
        (item.user && item.user.toLowerCase().includes(q)) ||
        (item.team && item.team.toLowerCase().includes(q)) ||
        item.rackShelf.toLowerCase().includes(q) ||
        (item.remarks && item.remarks.toLowerCase().includes(q));
      if (!match) return false;
    }

    // Asset Type filter
    if (options.assetType && options.assetType !== 'ALL') {
      if (item.assetType !== options.assetType) return false;
    }

    // Location filter
    if (options.location && options.location !== 'ALL') {
      if (item.location !== options.location) return false;
    }

    // Status filter
    if (options.status && options.status !== 'ALL') {
      if (item.status !== options.status) return false;
    }

    // Team filter
    if (options.team && options.team !== 'ALL') {
      if (options.team === 'None') {
        if (item.team && item.team.trim() && item.team !== 'Unassigned') return false;
      } else {
        if (item.team !== options.team) return false;
      }
    }

    return true;
  });
}

export function sortInventoryItems(
  items: InventoryItem[],
  field: SortField,
  direction: SortDirection
): InventoryItem[] {
  const sorted = [...items];
  const mult = direction === 'asc' ? 1 : -1;

  sorted.sort((a, b) => {
    if (field === 'name') {
      return a.name.localeCompare(b.name) * mult;
    }
    if (field === 'assetType') {
      return a.assetType.localeCompare(b.assetType) * mult;
    }
    if (field === 'quantity') {
      return (a.availableQuantity - b.availableQuantity) * mult;
    }
    if (field === 'location') {
      return a.location.localeCompare(b.location) * mult;
    }
    if (field === 'team') {
      return (a.team || '').localeCompare(b.team || '') * mult;
    }
    if (field === 'lastSeen') {
      return a.lastSeen.localeCompare(b.lastSeen) * mult;
    }
    return 0;
  });

  return sorted;
}

export function exportInventoryToCSV(items: InventoryItem[]): void {
  const headers = [
    'Item Code',
    'Item Name',
    'Category',
    'Sub Category',
    'Asset Type',
    'Total Quantity',
    'Available Quantity',
    'Location',
    'Rack / Shelf',
    'Status',
    'Assigned User',
    'Assigned Team',
    'Checked Out Date',
    'Last Seen Date',
    'Specification',
    'Remarks',
  ];

  const rows = items.map((item) => [
    `"${item.itemCode}"`,
    `"${item.name.replace(/"/g, '""')}"`,
    `"${item.category}"`,
    `"${item.subCategory || ''}"`,
    `"${item.assetType}"`,
    item.quantity,
    item.availableQuantity,
    `"${item.location}"`,
    `"${item.rackShelf}"`,
    `"${item.status}"`,
    `"${(item.user || '').replace(/"/g, '""')}"`,
    `"${(item.team || '').replace(/"/g, '""')}"`,
    `"${item.checkedOutAt || ''}"`,
    `"${item.lastSeen}"`,
    `"${(item.specification || '').replace(/"/g, '""')}"`,
    `"${(item.remarks || '').replace(/"/g, '""')}"`,
  ]);

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `inventory_catalog_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

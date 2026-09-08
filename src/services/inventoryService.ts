import { InventoryItem, AssetType, ItemStatus, ValidLocation } from '../types';

export interface InventoryFilterOptions {
  searchQuery: string;
  assetType: AssetType | 'ALL';
  team: string | 'ALL';
  location: ValidLocation | 'ALL';
  status: ItemStatus | 'ALL';
}

export type SortField = 'name' | 'quantity' | 'lastSeen' | 'location' | 'assetType' | 'team';
export type SortDirection = 'asc' | 'desc';

export function filterInventoryItems(
  items: InventoryItem[],
  filters: InventoryFilterOptions
): InventoryItem[] {
  return items.filter((item) => {
    // Search query matches name, itemCode, specification, rackShelf, or user
    if (filters.searchQuery.trim()) {
      const q = filters.searchQuery.toLowerCase().trim();
      const match =
        item.name.toLowerCase().includes(q) ||
        item.itemCode.toLowerCase().includes(q) ||
        item.location.toLowerCase().includes(q) ||
        item.rackShelf.toLowerCase().includes(q) ||
        (item.specification && item.specification.toLowerCase().includes(q)) ||
        (item.user && item.user.toLowerCase().includes(q)) ||
        (item.team && item.team.toLowerCase().includes(q));

      if (!match) return false;
    }

    // Asset type filter
    if (filters.assetType !== 'ALL' && item.assetType !== filters.assetType) {
      return false;
    }

    // Location filter
    if (filters.location !== 'ALL' && item.location !== filters.location) {
      return false;
    }

    // Status filter
    if (filters.status !== 'ALL' && item.status !== filters.status) {
      return false;
    }

    // Team filter
    if (filters.team !== 'ALL') {
      if (filters.team === 'None') {
        if (item.team) return false;
      } else if (item.team !== filters.team) {
        return false;
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
  return [...items].sort((a, b) => {
    let comparison = 0;
    switch (field) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'quantity':
        comparison = a.quantity - b.quantity;
        break;
      case 'lastSeen':
        comparison = a.lastSeen.localeCompare(b.lastSeen);
        break;
      case 'location':
        comparison = a.location.localeCompare(b.location);
        break;
      case 'assetType':
        comparison = a.assetType.localeCompare(b.assetType);
        break;
      case 'team':
        comparison = (a.team || '').localeCompare(b.team || '');
        break;
      default:
        comparison = 0;
    }

    return direction === 'asc' ? comparison : -comparison;
  });
}

export function exportInventoryToCSV(items: InventoryItem[]): void {
  const headers = [
    'Item ID',
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
    'Responsible User',
    'Team',
    'Checked Out At',
    'Last Seen',
    'Last Stocktake Date',
    'Remarks',
  ];

  const rows = items.map((item) => [
    escapeCSV(item.id),
    escapeCSV(item.itemCode),
    escapeCSV(item.name),
    escapeCSV(item.category),
    escapeCSV(item.subCategory || ''),
    escapeCSV(item.assetType),
    item.quantity.toString(),
    item.availableQuantity.toString(),
    escapeCSV(item.location),
    escapeCSV(item.rackShelf),
    escapeCSV(item.status),
    escapeCSV(item.user || ''),
    escapeCSV(item.team || ''),
    escapeCSV(item.checkedOutAt || ''),
    escapeCSV(item.lastSeen),
    escapeCSV(item.lastStocktakeDate || ''),
    escapeCSV(item.remarks || ''),
  ]);

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `inventory_catalog_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function escapeCSV(str: string): string {
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

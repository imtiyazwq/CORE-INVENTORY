import { describe, expect, it } from 'vitest';
import { InventoryItem } from '../types';
import { filterInventoryItems, sortInventoryItems } from './inventoryService';

function makeItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'ITEM-001',
    itemCode: 'T-001',
    name: 'Test Widget',
    category: 'Electronics & Robotics',
    assetType: 'Consumable',
    quantity: 10,
    availableQuantity: 10,
    location: 'CHILLAX',
    rackShelf: 'SHELF A',
    status: 'Available',
    lastSeen: '2026-01-01',
    ...overrides,
  };
}

describe('filterInventoryItems', () => {
  const items = [
    makeItem({ id: '1', name: 'Arduino Uno', itemCode: 'E001', location: 'CHILLAX', assetType: 'Controllable Asset', status: 'Available', team: 'Engineering', rackShelf: 'DRAWER 1' }),
    makeItem({ id: '2', name: 'Breadboard', itemCode: 'E004', location: 'STORE 1', assetType: 'Consumable', status: 'Checked Out', user: 'Sarah Jenkins', team: 'Engineering', rackShelf: 'DRAWER 2' }),
    makeItem({ id: '3', name: 'Popsicle Stick', itemCode: 'C009', location: 'MAKER STUDIO', assetType: 'Consumable', status: 'Available', team: undefined, rackShelf: 'YELLOW DRAWER' }),
  ];

  it('returns every item when no filters are set', () => {
    expect(filterInventoryItems(items, {})).toHaveLength(3);
  });

  it('matches search query against name (case-insensitive)', () => {
    const result = filterInventoryItems(items, { searchQuery: 'arduino' });
    expect(result.map((i) => i.id)).toEqual(['1']);
  });

  it('matches search query against item code', () => {
    const result = filterInventoryItems(items, { searchQuery: 'e004' });
    expect(result.map((i) => i.id)).toEqual(['2']);
  });

  it('matches search query against the assigned user', () => {
    const result = filterInventoryItems(items, { searchQuery: 'sarah' });
    expect(result.map((i) => i.id)).toEqual(['2']);
  });

  it('filters by exact asset type', () => {
    const result = filterInventoryItems(items, { assetType: 'Controllable Asset' });
    expect(result.map((i) => i.id)).toEqual(['1']);
  });

  it('ALL is treated as no filter for asset type', () => {
    expect(filterInventoryItems(items, { assetType: 'ALL' })).toHaveLength(3);
  });

  it('filters by location', () => {
    const result = filterInventoryItems(items, { location: 'MAKER STUDIO' });
    expect(result.map((i) => i.id)).toEqual(['3']);
  });

  it('filters by status', () => {
    const result = filterInventoryItems(items, { status: 'Checked Out' });
    expect(result.map((i) => i.id)).toEqual(['2']);
  });

  it('team "None" matches items with no team assigned', () => {
    const result = filterInventoryItems(items, { team: 'None' });
    expect(result.map((i) => i.id)).toEqual(['3']);
  });

  it('filters by an exact team name', () => {
    const result = filterInventoryItems(items, { team: 'Engineering' });
    expect(result.map((i) => i.id).sort()).toEqual(['1', '2']);
  });

  it('combines multiple filters with AND semantics', () => {
    const result = filterInventoryItems(items, { team: 'Engineering', status: 'Checked Out' });
    expect(result.map((i) => i.id)).toEqual(['2']);
  });
});

describe('sortInventoryItems', () => {
  const items = [
    makeItem({ id: 'a', name: 'Zebra Widget', availableQuantity: 5, location: 'STORE 1', team: 'Zeta', lastSeen: '2026-01-03' }),
    makeItem({ id: 'b', name: 'Apple Widget', availableQuantity: 20, location: 'CHILLAX', team: 'Alpha', lastSeen: '2026-01-01' }),
    makeItem({ id: 'c', name: 'Mango Widget', availableQuantity: 10, location: 'MAKER STUDIO', team: undefined, lastSeen: '2026-01-02' }),
  ];

  it('does not mutate the input array', () => {
    const copy = [...items];
    sortInventoryItems(items, 'name', 'asc');
    expect(items).toEqual(copy);
  });

  it('sorts by name ascending', () => {
    const result = sortInventoryItems(items, 'name', 'asc');
    expect(result.map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by name descending', () => {
    const result = sortInventoryItems(items, 'name', 'desc');
    expect(result.map((i) => i.id)).toEqual(['a', 'c', 'b']);
  });

  it('sorts by available quantity numerically, not lexicographically', () => {
    const result = sortInventoryItems(items, 'quantity', 'asc');
    expect(result.map((i) => i.id)).toEqual(['a', 'c', 'b']);
  });

  it('sorts by lastSeen date ascending', () => {
    const result = sortInventoryItems(items, 'lastSeen', 'asc');
    expect(result.map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('treats a missing team as an empty string for sorting purposes', () => {
    const result = sortInventoryItems(items, 'team', 'asc');
    // '' (item c) sorts before 'Alpha' (item b) before 'Zeta' (item a)
    expect(result.map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });
});

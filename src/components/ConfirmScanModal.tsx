import React, { useState } from 'react';
import { X, Check, AlertCircle, MapPin, Scan, Sliders } from 'lucide-react';
import { DetectedSummaryItem, ValidLocation } from '../types';
import { VALID_LOCATIONS } from '../data/locations';

interface ConfirmScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  detectedItems: DetectedSummaryItem[];
  defaultLocation?: ValidLocation;
  scanType: 'webcam' | 'upload';
  onConfirm: (data: {
    location: ValidLocation;
    confirmedItems: Array<{ className: string; quantity: number; confidence: number }>;
    operator: string;
    notes: string;
  }) => void;
}

export const ConfirmScanModal: React.FC<ConfirmScanModalProps> = ({
  isOpen,
  onClose,
  detectedItems,
  defaultLocation = VALID_LOCATIONS[0],
  scanType,
  onConfirm,
}) => {
  if (!isOpen) return null;

  const [location, setLocation] = useState<ValidLocation>(defaultLocation);
  const [operator, setOperator] = useState('Inventory Inspector');
  const [notes, setNotes] = useState(
    scanType === 'webcam' ? 'Live visual webcam scan' : 'High-resolution file batch detection'
  );

  // Editable quantities state
  const [items, setItems] = useState<Array<{ className: string; quantity: number; confidence: number }>>(
    detectedItems.map((d) => ({
      className: d.className,
      quantity: d.count,
      confidence: d.averageConfidence,
    }))
  );

  const handleQuantityChange = (index: number, newQty: number) => {
    const updated = [...items];
    updated[index].quantity = Math.max(0, newQty);
    setItems(updated);
  };

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const totalQuantity = items.reduce((acc, curr) => acc + curr.quantity, 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (items.length === 0 || totalQuantity === 0) {
      alert('Please include at least 1 verified item.');
      return;
    }
    onConfirm({
      location,
      confirmedItems: items.filter((i) => i.quantity > 0),
      operator: operator.trim() || 'Inventory Inspector',
      notes,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#005f60] text-white flex items-center justify-center">
              <Scan className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Review & Confirm YOLO Scan</h3>
              <p className="text-[11px] text-slate-500 font-mono">
                Verify detected quantities before ledger commit
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Location Selection (Strictly 4 locations) */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-[#005f60]" />
              Store Location <span className="text-rose-500">*</span>
            </label>
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value as ValidLocation)}
              className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60] bg-white font-medium text-slate-800"
            >
              {VALID_LOCATIONS.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              Inventory record updates will be mapped to this designated active store.
            </p>
          </div>

          {/* Detected Items Table with Quantity Overrides */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-slate-500" />
                Detected Items ({items.length} classes, {totalQuantity} units)
              </label>
              <span className="text-[11px] text-slate-500">Edit quantities as needed</span>
            </div>

            <div className="border border-slate-200 rounded-lg overflow-hidden max-h-56 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <tr>
                    <th className="px-3 py-2">Detected Item</th>
                    <th className="px-3 py-2 text-center">Confidence</th>
                    <th className="px-3 py-2 text-right">Quantity</th>
                    <th className="px-2 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((it, idx) => (
                    <tr key={it.className} className="hover:bg-slate-50/60">
                      <td className="px-3 py-2 font-medium text-slate-800">
                        {it.className}
                      </td>
                      <td className="px-3 py-2 text-center font-mono text-slate-500">
                        {(it.confidence * 100).toFixed(0)}%
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          max={999}
                          value={it.quantity}
                          onChange={(e) =>
                            handleQuantityChange(idx, parseInt(e.target.value) || 0)
                          }
                          className="w-16 text-center text-xs px-2 py-1 border border-slate-300 rounded font-mono font-bold text-[#005f60] focus:ring-1 focus:ring-[#005f60] focus:outline-none"
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(idx)}
                          className="text-slate-400 hover:text-rose-500 p-0.5"
                          title="Exclude item"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                        No detected items in this scan.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Operator and Notes */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Auditor / Operator
              </label>
              <input
                type="text"
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
                className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Audit Notes
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60]"
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Discard
            </button>
            <button
              type="submit"
              disabled={items.length === 0}
              className="px-4 py-1.5 text-xs font-semibold text-white bg-[#005f60] hover:bg-[#004d4e] disabled:opacity-50 rounded-lg shadow-xs transition-colors flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              Confirm Scan & Update Inventory
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

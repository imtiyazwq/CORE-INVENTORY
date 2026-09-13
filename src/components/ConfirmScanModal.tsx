import React, { useState } from 'react';
import { X, Check, AlertCircle, MapPin, PackagePlus, PackageMinus, SlidersHorizontal } from 'lucide-react';
import { InventoryItem } from '../types';
import { storageService, TransactionPayload } from '../services/storageService';

type TxnAction = 'IN' | 'OUT' | 'ADJUSTMENT';

interface ConfirmScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: InventoryItem;
  onSuccess?: (message: string) => void;
}

export const ConfirmScanModal: React.FC<ConfirmScanModalProps> = ({
  isOpen,
  onClose,
  item,
  onSuccess,
}) => {
  if (!isOpen) return null;

  const [action, setAction] = useState<TxnAction>('IN');
  const [magnitude, setMagnitude] = useState<number>(1);
  const [adjustDirection, setAdjustDirection] = useState<'increase' | 'decrease'>('increase');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Backend contract (matches database/inventory_manager.py exactly):
  //  - IN:  qty_changed is a positive magnitude to add.
  //  - OUT: qty_changed is a positive magnitude to remove (server negates it internally).
  //  - ADJUSTMENT: qty_changed is a SIGNED delta — positive to increase, negative to decrease.
  const signedDelta =
    action === 'OUT' ? -magnitude : action === 'ADJUSTMENT' && adjustDirection === 'decrease' ? -magnitude : magnitude;

  const previewQty = action === 'IN' || action === 'ADJUSTMENT' ? Math.max(0, item.quantity + signedDelta) : item.quantity;
  const previewAvail = Math.max(0, item.availableQuantity + signedDelta);

  const handleActionChange = (next: TxnAction) => {
    setAction(next);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!magnitude || magnitude <= 0) {
      setError('Enter a quantity greater than 0.');
      return;
    }
    if (action === 'OUT' && magnitude > item.availableQuantity) {
      setError(`Cannot remove ${magnitude} — only ${item.availableQuantity} available.`);
      return;
    }

    const qty_changed =
      action === 'ADJUSTMENT' ? (adjustDirection === 'increase' ? magnitude : -magnitude) : magnitude;

    const txn: TransactionPayload = {
      sku: item.itemCode,
      store_name: item.location,
      action,
      qty_changed,
    };

    setIsSubmitting(true);
    try {
      const result = await storageService.postTransaction(txn);
      setIsSubmitting(false);

      if (!result.success) {
        setError(result.error || 'Transaction was rejected by the server.');
        return;
      }

      const verb = action === 'IN' ? 'Added' : action === 'OUT' ? 'Removed' : 'Adjusted';
      onSuccess?.(`${verb} ${magnitude} × ${item.name} at ${item.location}`);
      onClose();
    } catch (err) {
      setIsSubmitting(false);
      setError(err instanceof Error ? err.message : 'Unexpected error posting transaction.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#005f60] text-white flex items-center justify-center">
              <SlidersHorizontal className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Adjust Stock</h3>
              <p className="text-[11px] text-slate-500 font-mono">{item.itemCode}</p>
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
          {/* Item Info Box */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-1.5">
            <div className="font-semibold text-slate-800 text-sm">{item.name}</div>
            <div className="flex items-center justify-between text-slate-500">
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3 text-[#005f60]" /> Location:
              </span>
              <span className="font-medium text-slate-700">{item.location}</span>
            </div>
            <div className="flex items-center justify-between text-slate-500">
              <span>Current Quantity:</span>
              <span className="font-mono font-bold text-slate-700">{item.quantity}</span>
            </div>
            <div className="flex items-center justify-between text-slate-500">
              <span>Available Units:</span>
              <span className="font-mono font-bold text-[#005f60]">{item.availableQuantity}</span>
            </div>
          </div>

          {/* Action Type Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Transaction Type <span className="text-rose-500">*</span>
            </label>
            <div role="tablist" className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                role="tab"
                aria-selected={action === 'IN'}
                onClick={() => handleActionChange('IN')}
                className={`px-2 py-2 rounded-lg text-xs font-semibold flex flex-col items-center gap-1 border transition-colors cursor-pointer ${
                  action === 'IN'
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                <PackagePlus className="w-3.5 h-3.5" />
                Stock In
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={action === 'OUT'}
                onClick={() => handleActionChange('OUT')}
                className={`px-2 py-2 rounded-lg text-xs font-semibold flex flex-col items-center gap-1 border transition-colors cursor-pointer ${
                  action === 'OUT'
                    ? 'bg-rose-50 border-rose-300 text-rose-800'
                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                <PackageMinus className="w-3.5 h-3.5" />
                Stock Out
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={action === 'ADJUSTMENT'}
                onClick={() => handleActionChange('ADJUSTMENT')}
                className={`px-2 py-2 rounded-lg text-xs font-semibold flex flex-col items-center gap-1 border transition-colors cursor-pointer ${
                  action === 'ADJUSTMENT'
                    ? 'bg-teal-50 border-teal-300 text-[#005f60]'
                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                Adjustment
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              {action === 'IN' && 'Add newly received or restocked units.'}
              {action === 'OUT' && 'Remove units that were used, consumed, or disposed of.'}
              {action === 'ADJUSTMENT' && 'Correct the recorded count after a physical recount.'}
            </p>
          </div>

          {/* Adjustment Direction (only for ADJUSTMENT) */}
          {action === 'ADJUSTMENT' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Direction</label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setAdjustDirection('increase')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                    adjustDirection === 'increase'
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                      : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  Increase (+)
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustDirection('decrease')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                    adjustDirection === 'decrease'
                      ? 'bg-rose-50 border-rose-300 text-rose-800'
                      : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  Decrease (-)
                </button>
              </div>
            </div>
          )}

          {/* Quantity Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {action === 'IN' && 'Quantity to Add'}
              {action === 'OUT' && `Quantity to Remove (Max ${item.availableQuantity})`}
              {action === 'ADJUSTMENT' && `Quantity to ${adjustDirection === 'increase' ? 'Add' : 'Subtract'}`}
              <span className="text-rose-500"> *</span>
            </label>
            <input
              type="number"
              min={1}
              max={action === 'OUT' ? item.availableQuantity : undefined}
              value={magnitude}
              onChange={(e) => setMagnitude(Math.max(1, parseInt(e.target.value, 10) || 0))}
              className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60] font-mono"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Resulting quantity: <span className="font-mono font-semibold text-slate-700">{previewQty}</span>
              {' · '}
              Resulting available: <span className="font-mono font-semibold text-[#005f60]">{previewAvail}</span>
            </p>
          </div>

          {error && (
            <div className="p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-1.5 text-xs font-semibold text-white bg-[#005f60] hover:bg-[#004d4e] disabled:opacity-50 rounded-lg shadow-xs transition-colors flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              {isSubmitting ? 'Submitting...' : 'Confirm Transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

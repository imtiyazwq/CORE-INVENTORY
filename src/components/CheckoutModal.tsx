import React, { useEffect, useMemo, useState } from 'react';
import { X, CheckCircle, UserCheck } from 'lucide-react';
import { InventoryItem, ValidLocation } from '../types';
import { VALID_LOCATIONS } from '../data/locations';

interface CheckoutModalProps {
  item: InventoryItem;
  mode: 'checkout' | 'checkin';
  isOpen: boolean;
  onClose: () => void;
  onConfirmCheckout: (itemId: string, user: string, team: string, qty: number) => void;
  onConfirmReturn: (itemId: string, returnLocation: ValidLocation, qty: number) => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  item,
  mode,
  isOpen,
  onClose,
  onConfirmCheckout,
  onConfirmReturn,
}) => {
  const isCheckinMode = mode === 'checkin';
  const outstandingQuantity = useMemo(() => {
    const hasCheckoutRecord = Boolean(item.user || item.checkedOutAt);
    return hasCheckoutRecord
      ? Math.max(0, item.quantity - item.availableQuantity)
      : 0;
  }, [item.quantity, item.availableQuantity, item.user, item.checkedOutAt]);

  const [user, setUser] = useState(item.user || '');
  const [team, setTeam] = useState(item.team || '');
  const [quantity, setQuantity] = useState(1);
  const [returnLocation, setReturnLocation] = useState<ValidLocation>(item.location);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setUser(item.user || '');
    setTeam(item.team || '');
    setQuantity(1);
    setReturnLocation(item.location);
    setError(null);
  }, [isOpen, item]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isCheckinMode) {
      const maxReturn = Math.max(1, outstandingQuantity);
      if (quantity <= 0 || quantity > maxReturn) {
        setError(`Return quantity must be between 1 and ${maxReturn}.`);
        return;
      }
      onConfirmReturn(item.id, returnLocation, quantity);
      onClose();
      return;
    }

    if (!user.trim()) {
      setError('Please provide the responsible user name.');
      return;
    }
    if (!team.trim()) {
      setError('Please specify the department or team.');
      return;
    }
    if (quantity <= 0 || quantity > item.availableQuantity) {
      setError(`Quantity must be between 1 and available count (${item.availableQuantity}).`);
      return;
    }

    onConfirmCheckout(item.id, user.trim(), team.trim(), quantity);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#005f60]/10 text-[#005f60] flex items-center justify-center">
              <UserCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {isCheckinMode ? 'Check In Inventory' : 'Check Out Inventory'}
              </h3>
              <p className="text-[11px] text-slate-500 font-mono">{item.itemCode}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-1.5">
            <div className="font-semibold text-slate-800 text-sm">{item.name}</div>
            <div className="flex items-center justify-between text-slate-500">
              <span>Asset Type:</span>
              <span className="font-medium text-slate-700">{item.assetType}</span>
            </div>
            <div className="flex items-center justify-between text-slate-500">
              <span>Current Location:</span>
              <span className="font-medium text-slate-700">{item.location}</span>
            </div>
            <div className="flex items-center justify-between text-slate-500">
              <span>Available Units:</span>
              <span className="font-mono font-bold text-[#005f60]">{item.availableQuantity}</span>
            </div>
            {isCheckinMode && (
              <div className="flex items-center justify-between text-slate-500">
                <span>Currently Out:</span>
                <span className="font-mono font-bold text-amber-700">{outstandingQuantity}</span>
              </div>
            )}
            {item.user && (
              <div className="flex items-center justify-between text-slate-500">
                <span>Responsible User:</span>
                <span className="font-medium text-slate-700">
                  {item.user}{item.team ? ` (${item.team})` : ''}
                </span>
              </div>
            )}
          </div>

          {error && (
            <div className="p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-xs">
              {error}
            </div>
          )}

          {isCheckinMode ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Return To Location <span className="text-rose-500">*</span>
                </label>
                <select
                  value={returnLocation}
                  onChange={(e) => setReturnLocation(e.target.value as ValidLocation)}
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60] bg-white font-medium"
                >
                  {VALID_LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Return Quantity (Max {Math.max(1, outstandingQuantity)})
                </label>
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, outstandingQuantity)}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60] font-mono"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Responsible User / Custodian <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sarah Jenkins"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Department / Team <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Engineering, Logistics, Biology Lab"
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Checkout Quantity (Max {item.availableQuantity})
                </label>
                <input
                  type="number"
                  min={1}
                  max={item.availableQuantity}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60] font-mono"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Available count will change from {item.availableQuantity} to{' '}
                  {Math.max(0, item.availableQuantity - quantity)}.
                </p>
              </div>
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 text-xs font-semibold text-white bg-[#005f60] hover:bg-[#004d4e] rounded-lg shadow-xs transition-colors flex items-center gap-1.5"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              {isCheckinMode ? 'Confirm Return' : 'Authorize Checkout'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  id: string;
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  badgeText?: string;
  badgeType?: 'teal' | 'emerald' | 'amber' | 'slate';
}

export const StatCard: React.FC<StatCardProps> = ({
  id,
  title,
  value,
  subtitle,
  icon: Icon,
  badgeText,
  badgeType = 'teal',
}) => {
  const badgeStyles = {
    teal: 'bg-teal-50 text-[#005f60] border-teal-200/90 font-semibold',
    emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200/90 font-semibold',
    amber: 'bg-amber-50 text-amber-800 border-amber-200/90 font-semibold',
    slate: 'bg-slate-100 text-slate-700 border-slate-200/90 font-semibold',
  }[badgeType];

  return (
    <div
      id={id}
      className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-xs transition-shadow hover:shadow-sm flex flex-col justify-between"
    >
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            {title}
          </span>
          <div className="w-8 h-8 rounded-lg bg-slate-100/90 border border-slate-200/60 flex items-center justify-center text-slate-700">
            <Icon className="w-4 h-4 text-slate-700" />
          </div>
        </div>

        <div className="mt-3 flex items-baseline justify-between">
          <span className="text-2xl font-semibold text-slate-900 font-mono">
            {value}
          </span>
          {badgeText && (
            <span
              className={`text-[10px] px-2 py-0.5 rounded border ${badgeStyles}`}
            >
              {badgeText}
            </span>
          )}
        </div>
      </div>

      {subtitle && (
        <p className="mt-2 text-xs text-slate-500 font-medium truncate pt-1 border-t border-slate-100">
          {subtitle}
        </p>
      )}
    </div>
  );
};

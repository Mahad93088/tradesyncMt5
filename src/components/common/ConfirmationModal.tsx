import React from 'react';
import { AlertTriangle, AlertCircle, CheckCircle2, X } from 'lucide-react';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'primary';
  isLoading?: boolean;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  isLoading = false
}) => {
  if (!isOpen) return null;

  const variantStyles = {
    danger: {
      icon: <AlertTriangle className="h-5 w-5 text-rose-400" />,
      iconBg: 'bg-rose-950/60 border-rose-800/80',
      btn: 'bg-rose-600 hover:bg-rose-500 text-white focus:ring-rose-500'
    },
    warning: {
      icon: <AlertCircle className="h-5 w-5 text-amber-400" />,
      iconBg: 'bg-amber-950/60 border-amber-800/80',
      btn: 'bg-amber-600 hover:bg-amber-500 text-white focus:ring-amber-500'
    },
    primary: {
      icon: <CheckCircle2 className="h-5 w-5 text-sky-400" />,
      iconBg: 'bg-sky-950/60 border-sky-800/80',
      btn: 'bg-sky-600 hover:bg-sky-500 text-white focus:ring-sky-500'
    }
  };

  const style = variantStyles[variant];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg border ${style.iconBg}`}>
              {style.icon}
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">{title}</h3>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{description}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 transition-colors p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800/80">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            disabled={isLoading}
            className={`rounded-lg px-3.5 py-2 text-xs font-semibold shadow-sm transition-colors ${style.btn}`}
          >
            {isLoading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

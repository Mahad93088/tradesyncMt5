import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in TradeSync MT5 application:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-xl border border-rose-500/30 bg-slate-900/90 p-6 shadow-2xl backdrop-blur-md text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <AlertTriangle className="h-7 w-7" />
            </div>
            <h2 className="text-xl font-bold tracking-tight text-white mb-2">Something went wrong</h2>
            <p className="text-xs text-slate-400 mb-6 leading-relaxed">
              An unexpected error occurred while rendering the application. Your demo session data is safe in local storage.
            </p>
            {this.state.error && (
              <div className="mb-6 rounded-lg bg-slate-950/80 border border-slate-800 p-3 text-left font-mono text-[11px] text-rose-300 max-h-32 overflow-y-auto break-all">
                {this.state.error.message || String(this.state.error)}
              </div>
            )}
            <div className="flex justify-center gap-3">
              <button
                type="button"
                onClick={this.handleReset}
                className="inline-flex items-center gap-2 rounded-lg bg-sky-600 hover:bg-sky-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reload Application
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

import React from 'react';
import { AlertTriangle, RefreshCw, Trash2, Terminal, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
      copied: false,
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Uncaught application error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleResetAndReload = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {
      console.warn('Failed to clear storage:', e);
    }
    window.location.reload();
  };

  handleOpenDevTools = () => {
    fetch('/api/system/devtools', { method: 'POST' }).catch(() => {
      // In web browser or fallback, alert shortcut
      alert('請直接按下 F12 或 Ctrl+Shift+I 開啟除錯主控台 (DevTools)。');
    });
  };

  handleCopyError = () => {
    const errorText = `[AniFlix Error Report]
Message: ${this.state.error?.message || 'Unknown error'}
Stack:
${this.state.error?.stack || 'No stack trace'}
Component Stack:
${this.state.errorInfo?.componentStack || 'No component stack'}`;

    navigator.clipboard.writeText(errorText).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2500);
    }).catch((err) => {
      console.error('Failed to copy to clipboard', err);
    });
  };

  render() {
    if (this.state.hasError) {
      const errorMessage = this.state.error?.message || '未知的運行時錯誤 (Unknown Runtime Error)';

      return (
        <div className="min-h-screen w-full bg-zinc-950 text-zinc-100 flex items-center justify-center p-4 sm:p-6 select-none font-sans">
          {/* Background Ambient Glow */}
          <div className="fixed inset-0 pointer-events-none overflow-hidden">
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-red-600/10 rounded-full blur-[120px]" />
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-96 h-96 bg-zinc-800/20 rounded-full blur-[100px]" />
          </div>

          <div className="relative w-full max-w-xl bg-zinc-900/90 border border-zinc-800 backdrop-blur-2xl rounded-2xl shadow-2xl p-6 sm:p-8 space-y-6">
            {/* Header / Brand */}
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-red-950/60 border border-red-600/40 flex items-center justify-center text-red-500 shadow-lg shadow-red-950/30">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                  <span>AniFlix 應用程式發生異常</span>
                </h1>
                <p className="text-xs text-zinc-400 mt-0.5">
                  介面元件已被安全防護層攔截，避免視窗反黑或無預警關閉
                </p>
              </div>
            </div>

            {/* Error Summary Card */}
            <div className="p-3.5 rounded-xl bg-zinc-950/70 border border-zinc-800/80 font-mono text-xs text-red-400 break-all leading-relaxed">
              <div className="text-[11px] text-zinc-500 font-sans font-semibold mb-1">錯誤訊息摘要：</div>
              {errorMessage}
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={this.handleReload}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 active:scale-[0.98] text-white font-medium text-sm transition-all shadow-lg shadow-red-950/40"
              >
                <RefreshCw className="w-4 h-4" />
                <span>重新整理頁面 (Reload)</span>
              </button>

              <button
                type="button"
                onClick={this.handleOpenDevTools}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:scale-[0.98] text-zinc-200 border border-zinc-700 font-medium text-sm transition-all"
              >
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span>開啟主控台 (F12)</span>
              </button>

              <button
                type="button"
                onClick={this.handleResetAndReload}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-800/60 hover:bg-zinc-800 active:scale-[0.98] text-amber-300 border border-amber-900/40 font-medium text-sm transition-all"
              >
                <Trash2 className="w-4 h-4" />
                <span>清除快取並重啟</span>
              </button>

              <button
                type="button"
                onClick={this.handleCopyError}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-800/60 hover:bg-zinc-800 active:scale-[0.98] text-zinc-300 border border-zinc-700/60 font-medium text-sm transition-all"
              >
                {this.state.copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span className="text-emerald-400">已複製錯誤日誌</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>複製錯誤報告</span>
                  </>
                )}
              </button>
            </div>

            {/* Collapsible Details */}
            <div className="pt-2 border-t border-zinc-800/60">
              <button
                type="button"
                onClick={() => this.setState({ showDetails: !this.state.showDetails })}
                className="flex items-center justify-between w-full text-xs text-zinc-400 hover:text-zinc-200 transition-colors py-1"
              >
                <span>技術堆疊詳細資訊 (Technical Stack Trace)</span>
                {this.state.showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {this.state.showDetails && (
                <div className="mt-2.5 p-3 rounded-xl bg-black/60 border border-zinc-800/80 max-h-48 overflow-y-auto font-mono text-[11px] text-zinc-400 space-y-2 select-text">
                  <div>
                    <span className="text-zinc-500 font-bold block mb-1">Stack Trace:</span>
                    <pre className="whitespace-pre-wrap">{this.state.error?.stack || '無堆疊追蹤資訊'}</pre>
                  </div>
                  {this.state.errorInfo?.componentStack && (
                    <div className="pt-2 border-t border-zinc-900">
                      <span className="text-zinc-500 font-bold block mb-1">Component Stack:</span>
                      <pre className="whitespace-pre-wrap">{this.state.errorInfo.componentStack}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

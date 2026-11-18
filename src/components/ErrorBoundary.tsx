import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'Đã xảy ra lỗi không mong muốn.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ErrorBoundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      let friendly = this.state.errorMessage;
      try {
        const parsed = JSON.parse(this.state.errorMessage) as { error?: string; path?: string };
        if (parsed.error) {
          friendly = `Lỗi truy cập dữ liệu (${parsed.path || 'Firestore'}): ${parsed.error}`;
        }
      } catch {
        // Plain error text
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
          <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6">
            <h1 className="text-base font-semibold text-zinc-900">Đã xảy ra lỗi ứng dụng</h1>
            <p className="mt-2 text-xs leading-relaxed text-red-700 break-words">{friendly}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 min-h-[40px] rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800"
            >
              Tải lại trang
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

import React from 'react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'Ocorreu um erro inesperado ao carregar a interface.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Erro capturado na interface:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0A0D0C] flex items-center justify-center p-6">
          <div className="max-w-md w-full btl-card p-6 space-y-4">
            <h1 className="font-display text-lg font-semibold text-[#F1F5F3]">
              Não foi possível exibir esta tela
            </h1>
            <p className="text-sm text-[#A4B3AB] leading-relaxed">
              Ocorreu uma falha ao sincronizar ou renderizar os dados das escalas. Tente recarregar a página.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="btl-btn btl-btn-primary w-full min-h-[44px] text-sm"
            >
              Recarregar sistema
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

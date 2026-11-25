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
        <div className="min-h-screen bg-[#F7F8F7] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-[#DCE1DC] rounded-xl p-6 space-y-4">
            <h1 className="text-lg font-semibold text-[#141A16]">
              Não foi possível exibir esta tela
            </h1>
            <p className="text-sm text-[#4A554E] leading-relaxed">
              Ocorreu uma falha ao sincronizar ou renderizar os dados das escalas. Tente recarregar a página.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full min-h-[44px] px-4 py-2.5 text-sm font-medium text-white bg-[#1B4332] hover:bg-[#143326] rounded-lg transition-colors cursor-pointer"
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

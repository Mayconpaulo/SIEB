import React, { useState } from 'react';
import { Download, Share, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex items-center gap-2 min-h-[40px] px-4 py-2 text-sm font-medium text-[#1B4332] bg-white border border-[#1B4332]/30 hover:bg-[#1B4332]/5 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Download className="w-4 h-4" />
        Instalar aplicativo
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-2 min-h-[40px] px-4 py-2 text-sm font-medium text-[#1B4332] bg-white border border-[#1B4332]/30 hover:bg-[#1B4332]/5 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Share className="w-4 h-4" />
          Instalar no iPhone
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
          >
            <div className="w-full max-w-sm rounded-xl bg-white border border-[#DCE1DC] p-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <h3 id="ios-install-title" className="text-base font-semibold text-[#141A16]">
                  Instalar na tela inicial (iPhone / iPad)
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="min-w-[36px] min-h-[36px] flex items-center justify-center text-[#5A665E] hover:text-[#141A16] rounded-lg cursor-pointer"
                  aria-label="Fechar instruções"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="text-sm text-[#3E4841] space-y-2.5 list-decimal list-inside leading-relaxed">
                <li>
                  Toque no botão <strong>Compartilhar</strong> na barra do Safari.
                </li>
                <li>
                  Role as opções e selecione <strong>Adicionar à Tela de Início</strong>.
                </li>
                <li>
                  Toque em <strong>Adicionar</strong> para abrir as escalas como aplicativo.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full min-h-[44px] rounded-lg bg-[#1B4332] text-white text-sm font-medium hover:bg-[#143326] transition-colors cursor-pointer"
              >
                Entendi
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 md:bottom-4 left-4 right-4 md:right-auto z-50 flex items-center gap-2.5 rounded-lg bg-[#92400E] px-4 py-2.5 text-xs font-medium text-white shadow-md"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>Sem conexão com a internet — as escalas serão atualizadas assim que o sinal voltar.</span>
    </div>
  );
};

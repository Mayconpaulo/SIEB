import React, { useState } from 'react';
import { Download, Share, WifiOff, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { SPRING_MODAL, TRANSITION_MICRO } from '../lib/motion';

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
        className="btl-btn btl-btn-gold min-h-[42px] px-4 py-2 text-sm shrink-0"
      >
        <Download className="w-4 h-4" />
        <span>Instalar aplicativo</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="btl-btn btl-btn-gold min-h-[42px] px-4 py-2 text-sm shrink-0"
        >
          <Share className="w-4 h-4" />
          <span>Instalar no iPhone</span>
        </button>

        <AnimatePresence>
          {showIOSGuide && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={TRANSITION_MICRO}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="ios-install-title"
              onClick={() => setShowIOSGuide(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={SPRING_MODAL}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm btl-modal p-6 space-y-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <h3 id="ios-install-title" className="font-display text-base font-semibold text-[#F4E6C4]">
                    Instalar na tela inicial (iPhone / iPad)
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowIOSGuide(false)}
                    className="min-w-[36px] min-h-[36px] flex items-center justify-center text-[#98A89F] hover:text-[#F4E6C4] rounded-lg cursor-pointer"
                    aria-label="Fechar instruções"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <ol className="text-sm text-[#C6D4CC] space-y-2.5 list-decimal list-inside leading-relaxed">
                  <li>
                    Toque no botão <strong className="text-[#F4E6C4]">Compartilhar</strong> na barra do Safari.
                  </li>
                  <li>
                    Role as opções e selecione <strong className="text-[#F4E6C4]">Adicionar à Tela de Início</strong>.
                  </li>
                  <li>
                    Toque em <strong className="text-[#F4E6C4]">Adicionar</strong> para abrir as escalas como aplicativo.
                  </li>
                </ol>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="btl-btn btl-btn-primary w-full min-h-[44px] text-sm"
                >
                  Entendi
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={TRANSITION_MICRO}
          className="fixed bottom-20 md:bottom-4 left-4 right-4 md:right-auto z-50 flex items-center gap-2.5 rounded-xl bg-[#241E12]/95 border border-[#C9A961]/45 backdrop-blur-md px-4 py-3 text-xs font-medium text-[#F4E6C4] shadow-xl"
        >
          <WifiOff className="w-4 h-4 shrink-0 text-[#E5C17B]" />
          <span>Sem conexão com a internet — as escalas serão atualizadas assim que o sinal voltar.</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

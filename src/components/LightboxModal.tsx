import { ArrowUpRight, Download, X } from 'lucide-react';
import { useEffect } from 'react';
import { formatShortDate, formatTimeTabular } from '../utils/format';

export interface LightboxPayload {
  chatId: string;
  chatTitle?: string;
  tgMessageId: number;
  senderName: string;
  dateIso: string;
  mediaUrl: string;
  mediaName: string | null;
  caption: string;
}

interface LightboxModalProps {
  item: LightboxPayload | null;
  onClose: () => void;
  onOpenInChat: (chatId: string, tgMessageId: number) => void;
}

export function LightboxModal({ item, onClose, onOpenInChat }: LightboxModalProps) {
  useEffect(() => {
    if (!item) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [item, onClose]);

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-xs flex flex-col justify-between p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Mirrored media preview"
      onClick={onClose}
    >
      <div
        className="flex items-center justify-between gap-4 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{item.senderName}</div>
          <div className="text-xs text-slate-300 font-mono tabular-nums">
            {item.chatTitle ? `${item.chatTitle} · ` : ''}
            {formatShortDate(item.dateIso)} {formatTimeTabular(item.dateIso)}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              onOpenInChat(item.chatId, item.tgMessageId);
              onClose();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/20 text-white transition-colors whitespace-nowrap"
          >
            Open in Chat
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
          <a
            href={item.mediaUrl}
            download={item.mediaName || 'telegram_media.jpg'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/20 text-white transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Save
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div
        className="flex-1 flex items-center justify-center my-4 min-h-0"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={item.mediaUrl}
          alt={item.mediaName || 'Mirrored media'}
          referrerPolicy="no-referrer"
          className="max-w-full max-h-[75vh] object-contain rounded-lg shadow-2xl"
        />
      </div>

      {item.caption && (
        <div
          className="max-w-3xl mx-auto text-center text-sm text-slate-200 bg-slate-900/70 px-4 py-2.5 rounded-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {item.caption}
        </div>
      )}
    </div>
  );
}

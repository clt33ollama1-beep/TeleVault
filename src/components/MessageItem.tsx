import {
  Bookmark,
  Download,
  Eye,
  FileText,
  Film,
  Forward,
  Image as ImageIcon,
  MessageSquare,
  Mic,
  Pin,
} from 'lucide-react';
import { useState } from 'react';
import type { ArchivedMessage } from '../types';
import {
  formatBytes,
  formatNumberCompact,
  formatTimeTabular,
  getAvatarTone,
  getInitials,
} from '../utils/format';
import { RichTextRenderer } from './RichTextRenderer';

interface MessageItemProps {
  message: ArchivedMessage;
  isHighlighted?: boolean;
  onJumpToMessage: (tgMessageId: number) => void;
  onOpenThread: (tgMessageId: number) => void;
  onToggleBookmark: (messageId: number) => void;
  onOpenLightbox: (message: ArchivedMessage) => void;
  onHashtagClick?: (tag: string) => void;
}

export function MessageItem({
  message,
  isHighlighted = false,
  onJumpToMessage,
  onOpenThread,
  onToggleBookmark,
  onOpenLightbox,
  onHashtagClick,
}: MessageItemProps) {
  const [imgError, setImgError] = useState(false);

  const renderMediaIcon = () => {
    switch (message.mediaType) {
      case 'video':
        return <Film className="w-5 h-5 text-slate-500 dark:text-slate-400" />;
      case 'audio':
      case 'voice':
        return <Mic className="w-5 h-5 text-slate-500 dark:text-slate-400" />;
      default:
        return <FileText className="w-5 h-5 text-slate-500 dark:text-slate-400" />;
    }
  };

  return (
    <article
      id={`msg-${message.tgMessageId}`}
      className={`group px-4 sm:px-6 py-4 transition-colors duration-200 border-b border-slate-100 dark:border-slate-800/80 ${
        isHighlighted
          ? 'bg-sky-50/90 dark:bg-sky-950/40'
          : 'hover:bg-slate-50/70 dark:hover:bg-slate-900/50'
      }`}
    >
      <div className="flex items-start gap-3.5 max-w-4xl">
        {/* Sender Avatar */}
        <div
          className={`w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-xs font-semibold tracking-tight select-none mt-0.5 ${getAvatarTone(
            message.senderName
          )}`}
          aria-hidden="true"
        >
          {getInitials(message.senderName)}
        </div>

        {/* Message Body */}
        <div className="flex-1 min-w-0">
          {/* Header Row: Unboxed clean metadata with middot separators */}
          <div className="flex items-center justify-between gap-3 mb-1">
            <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 min-w-0">
              <span className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">
                {message.senderName}
              </span>
              {message.senderRole && (
                <>
                  <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{message.senderRole}</span>
                </>
              )}
              <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                ·
              </span>
              <time
                dateTime={message.dateIso}
                className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400"
              >
                {formatTimeTabular(message.dateIso)}
              </time>
              <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className="text-xs font-mono tabular-nums text-slate-400 dark:text-slate-500">
                #{message.tgMessageId}
              </span>
              {message.isPinned && (
                <>
                  <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                    ·
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 dark:text-sky-400">
                    <Pin className="w-3 h-3" />
                    Pinned
                  </span>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => onToggleBookmark(message.id)}
              aria-label={message.isBookmarked ? 'Remove bookmark' : 'Bookmark message'}
              title={message.isBookmarked ? 'Saved to bookmarks' : 'Save bookmark'}
              className={`p-1.5 rounded-md transition-colors shrink-0 ${
                message.isBookmarked
                  ? 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/60'
                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 opacity-0 group-hover:opacity-100 focus:opacity-100'
              }`}
            >
              <Bookmark className={`w-4 h-4 ${message.isBookmarked ? 'fill-current' : ''}`} />
            </button>
          </div>

          {/* Forwarded header */}
          {message.forwardFrom && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mb-1.5">
              <Forward className="w-3.5 h-3.5 shrink-0" />
              <span>Forwarded from {message.forwardFrom}</span>
            </div>
          )}

          {/* Reply quote block (clean hairline border, no thick left bar) */}
          {message.replyToTgId && (
            <button
              type="button"
              onClick={() => onJumpToMessage(message.replyToTgId!)}
              className="w-full text-left mb-2 px-3 py-2 rounded-lg bg-slate-100/80 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 hover:border-sky-300 dark:hover:border-sky-700 transition-colors"
            >
              <div className="text-xs font-medium text-sky-700 dark:text-sky-400">
                Replying to {message.replyPreviewSender || `Message #${message.replyToTgId}`}
              </div>
              {message.replyPreviewText && (
                <p className="text-xs text-slate-600 dark:text-slate-300 truncate mt-0.5">
                  {message.replyPreviewText}
                </p>
              )}
            </button>
          )}

          {/* Rich Message Prose */}
          {message.text && (
            <div className="max-w-[70ch]">
              <RichTextRenderer
                text={message.text}
                entities={message.entities}
                onHashtagClick={onHashtagClick}
              />
            </div>
          )}

          {/* Photo Attachment */}
          {message.mediaType === 'photo' && (
            <div className="mt-3 max-w-lg">
              {message.mediaUrl && !imgError ? (
                <button
                  type="button"
                  onClick={() => onOpenLightbox(message)}
                  className="block w-full text-left rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 hover:border-sky-400 dark:hover:border-sky-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                >
                  <img
                    src={message.mediaUrl}
                    alt={message.mediaName || 'Archived Telegram photo'}
                    referrerPolicy="no-referrer"
                    onError={() => setImgError(true)}
                    className="w-full max-h-80 object-cover"
                  />
                </button>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 text-xs text-slate-600 dark:text-slate-300">
                  <ImageIcon className="w-4 h-4 text-slate-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{message.mediaName || 'Photo attachment'}</div>
                    <div className="text-slate-400 dark:text-slate-500">
                      Referenced in export metadata · {formatBytes(message.mediaSize)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Document / Video / Audio Attachment */}
          {message.mediaType !== 'none' && message.mediaType !== 'photo' && message.mediaType !== 'poll' && (
            <div className="mt-3 max-w-md flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/70">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
                  {renderMediaIcon()}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    {message.mediaName || 'Archived attachment'}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    {message.mediaSize ? formatBytes(message.mediaSize) : message.mediaType}
                    {message.mediaMime ? ` · ${message.mediaMime}` : ''}
                  </div>
                </div>
              </div>
              {message.mediaUrl ? (
                <a
                  href={message.mediaUrl}
                  download={message.mediaName || undefined}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  Save
                </a>
              ) : (
                <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap shrink-0">
                  Indexed
                </span>
              )}
            </div>
          )}

          {/* Footer: Reactions, Views, and Telegram Comments/Thread Button */}
          {(message.reactions.length > 0 || message.views > 0 || message.replyCount > 0) && (
            <div className="mt-2.5 flex items-center flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
              {message.reactions.length > 0 && (
                <div className="flex items-center flex-wrap gap-1.5">
                  {message.reactions.map((r, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 font-mono tabular-nums text-slate-700 dark:text-slate-300"
                    >
                      <span>{r.emoji}</span>
                      <span>{r.count}</span>
                    </span>
                  ))}
                </div>
              )}

              {message.replyCount > 0 && (
                <button
                  type="button"
                  onClick={() => onOpenThread(message.tgMessageId)}
                  className="inline-flex items-center gap-1.5 font-medium text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 transition-colors whitespace-nowrap"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span className="tabular-nums">
                    {message.replyCount} {message.replyCount === 1 ? 'comment' : 'comments'}
                  </span>
                </button>
              )}

              {message.views > 0 && (
                <span className="inline-flex items-center gap-1 ml-auto font-mono tabular-nums">
                  <Eye className="w-3.5 h-3.5" />
                  {formatNumberCompact(message.views)}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

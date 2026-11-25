import {
  Download,
  FileText,
  Film,
  Image as ImageIcon,
  MessageSquare,
  Mic,
  Pin,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { ArchivedMessage, ChatSummary, MediaType, MessageComment } from '../types';
import {
  formatBytes,
  formatNumberCompact,
  formatShortDate,
  formatTimeTabular,
  getAvatarTone,
  getInitials,
} from '../utils/format';
import type { LightboxPayload } from './LightboxModal';
import { RichTextRenderer } from './RichTextRenderer';

interface ThreadDrawerProps {
  mode: 'thread' | 'info' | null;
  chat: ChatSummary | null;
  threadRoot: ArchivedMessage | null;
  threadReplies: ArchivedMessage[];
  threadComments: MessageComment[];
  pinnedMessages: ArchivedMessage[];
  onClose: () => void;
  onJumpToMessage: (tgMessageId: number) => void;
  onDeleteChat: (chatId: string) => void;
  onOpenLightbox: (payload: LightboxPayload) => void;
}

function CommentMediaAttachment({
  mediaType,
  mediaUrl,
  mediaName,
  mediaSize,
  mediaMime,
  onPhotoClick,
}: {
  mediaType: MediaType;
  mediaUrl: string | null;
  mediaName: string | null;
  mediaSize: number | null;
  mediaMime: string | null;
  onPhotoClick?: () => void;
}) {
  const [imgError, setImgError] = useState(false);

  if (mediaType === 'none' || mediaType === 'poll') return null;

  if (mediaType === 'photo') {
    if (mediaUrl && !imgError) {
      return (
        <button
          type="button"
          onClick={onPhotoClick}
          className="mt-2.5 block w-full text-left rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:border-sky-400 dark:hover:border-sky-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          <img
            src={mediaUrl}
            alt={mediaName || 'Mirrored comment photo'}
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="w-full max-h-56 object-cover"
          />
        </button>
      );
    }
    return (
      <div className="mt-2.5 flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-xs text-slate-600 dark:text-slate-300">
        <ImageIcon className="w-4 h-4 text-slate-400 shrink-0" />
        <div className="min-w-0">
          <div className="font-medium truncate">{mediaName || 'Photo attachment'}</div>
          {mediaSize ? (
            <div className="text-[11px] font-mono tabular-nums text-slate-400">
              {formatBytes(mediaSize)}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (mediaType === 'video' && mediaUrl) {
    return (
      <div className="mt-2.5 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-black">
        <video src={mediaUrl} controls preload="metadata" className="w-full max-h-56" />
      </div>
    );
  }

  if ((mediaType === 'audio' || mediaType === 'voice') && mediaUrl) {
    return (
      <div className="mt-2.5 p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
        <audio src={mediaUrl} controls preload="metadata" className="w-full h-8" />
        {mediaName && (
          <div className="mt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
            {mediaName}
          </div>
        )}
      </div>
    );
  }

  const icon =
    mediaType === 'video' ? (
      <Film className="w-4 h-4 text-slate-500 dark:text-slate-400" />
    ) : mediaType === 'audio' || mediaType === 'voice' ? (
      <Mic className="w-4 h-4 text-slate-500 dark:text-slate-400" />
    ) : (
      <FileText className="w-4 h-4 text-slate-500 dark:text-slate-400" />
    );

  return (
    <div className="mt-2.5 flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-7 h-7 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
            {mediaName || 'Archived attachment'}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
            {mediaSize ? formatBytes(mediaSize) : mediaType}
            {mediaMime ? ` · ${mediaMime}` : ''}
          </div>
        </div>
      </div>

      {mediaUrl ? (
        <a
          href={mediaUrl}
          download={mediaName || undefined}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0 whitespace-nowrap"
        >
          <Download className="w-3 h-3" />
          Save
        </a>
      ) : (
        <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0">Indexed</span>
      )}
    </div>
  );
}

export function ThreadDrawer({
  mode,
  chat,
  threadRoot,
  threadReplies,
  threadComments,
  pinnedMessages,
  onClose,
  onJumpToMessage,
  onDeleteChat,
  onOpenLightbox,
}: ThreadDrawerProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!mode || !chat) return null;

  const totalDiscussionCount = threadReplies.length + threadComments.length;

  return (
    <aside className="w-full lg:w-[360px] xl:w-[380px] shrink-0 border-l border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {mode === 'thread' ? (
            <>
              <MessageSquare className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                Telegram Comments
              </h2>
            </>
          ) : (
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
              Archive Details
            </h2>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {mode === 'thread' && threadRoot && (
          <>
            <div className="p-3.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {threadRoot.senderName}
                </span>
                <span className="text-xs font-mono tabular-nums text-slate-400">
                  {formatTimeTabular(threadRoot.dateIso)}
                </span>
              </div>
              <RichTextRenderer text={threadRoot.text} entities={threadRoot.entities} />
              <CommentMediaAttachment
                mediaType={threadRoot.mediaType}
                mediaUrl={threadRoot.mediaUrl}
                mediaName={threadRoot.mediaName}
                mediaSize={threadRoot.mediaSize}
                mediaMime={threadRoot.mediaMime}
                onPhotoClick={
                  threadRoot.mediaUrl
                    ? () =>
                        onOpenLightbox({
                          chatId: threadRoot.chatId,
                          chatTitle: chat.title,
                          tgMessageId: threadRoot.tgMessageId,
                          senderName: threadRoot.senderName,
                          dateIso: threadRoot.dateIso,
                          mediaUrl: threadRoot.mediaUrl!,
                          mediaName: threadRoot.mediaName,
                          caption: threadRoot.text,
                        })
                    : undefined
                }
              />
              <button
                type="button"
                onClick={() => onJumpToMessage(threadRoot.tgMessageId)}
                className="mt-3 text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline"
              >
                Jump to original message #{threadRoot.tgMessageId}
              </button>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400 mb-2.5 tabular-nums">
                <span>
                  {totalDiscussionCount} Mirrored {totalDiscussionCount === 1 ? 'Comment' : 'Comments'}
                </span>
                <span>Read-only archive</span>
              </div>

              {totalDiscussionCount === 0 ? (
                <div className="p-4 rounded-lg border border-dashed border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
                  No mirrored Telegram comments on this post.
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Mirrored Telegram group thread replies */}
                  {threadReplies.map((reply) => (
                    <div
                      key={`reply-${reply.id}`}
                      className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {reply.senderName}
                        </span>
                        <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                          {formatShortDate(reply.dateIso)} · {formatTimeTabular(reply.dateIso)}
                        </span>
                      </div>
                      {reply.text && (
                        <RichTextRenderer text={reply.text} entities={reply.entities} />
                      )}
                      <CommentMediaAttachment
                        mediaType={reply.mediaType}
                        mediaUrl={reply.mediaUrl}
                        mediaName={reply.mediaName}
                        mediaSize={reply.mediaSize}
                        mediaMime={reply.mediaMime}
                        onPhotoClick={
                          reply.mediaUrl
                            ? () =>
                                onOpenLightbox({
                                  chatId: reply.chatId,
                                  chatTitle: chat.title,
                                  tgMessageId: reply.tgMessageId,
                                  senderName: reply.senderName,
                                  dateIso: reply.dateIso,
                                  mediaUrl: reply.mediaUrl!,
                                  mediaName: reply.mediaName,
                                  caption: reply.text,
                                })
                            : undefined
                        }
                      />
                    </div>
                  ))}

                  {/* Mirrored Telegram channel comments */}
                  {threadComments.map((comment) => (
                    <div
                      key={`comment-${comment.id}`}
                      className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {comment.authorName}
                        </span>
                        <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                          {formatShortDate(comment.createdAt)} · {formatTimeTabular(comment.createdAt)}
                        </span>
                      </div>
                      {comment.body && (
                        <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words leading-relaxed">
                          {comment.body}
                        </p>
                      )}
                      <CommentMediaAttachment
                        mediaType={comment.mediaType}
                        mediaUrl={comment.mediaUrl}
                        mediaName={comment.mediaName}
                        mediaSize={comment.mediaSize}
                        mediaMime={comment.mediaMime}
                        onPhotoClick={
                          comment.mediaUrl
                            ? () =>
                                onOpenLightbox({
                                  chatId: comment.chatId,
                                  chatTitle: chat.title,
                                  tgMessageId: comment.targetTgMessageId,
                                  senderName: comment.authorName,
                                  dateIso: comment.createdAt,
                                  mediaUrl: comment.mediaUrl!,
                                  mediaName: comment.mediaName,
                                  caption: comment.body,
                                })
                            : undefined
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {mode === 'info' && (
          <>
            <div className="flex items-center gap-3.5">
              {chat.avatarUrl ? (
                <img
                  src={chat.avatarUrl}
                  alt={chat.title}
                  referrerPolicy="no-referrer"
                  className="w-14 h-14 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                />
              ) : (
                <div
                  className={`w-14 h-14 rounded-full flex items-center justify-center text-base font-semibold shrink-0 ${getAvatarTone(
                    chat.title
                  )}`}
                >
                  {getInitials(chat.title)}
                </div>
              )}
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {chat.title}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {chat.username ? `@${chat.username} · ` : ''}
                  <span className="capitalize">{chat.chatType}</span>
                </p>
              </div>
            </div>

            {chat.description && (
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {chat.description}
              </p>
            )}

            <dl className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs">
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Archived Messages</dt>
                <dd className="text-sm font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                  {formatNumberCompact(chat.messageCount)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Media Items</dt>
                <dd className="text-sm font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                  {formatNumberCompact(chat.mediaCount)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Members</dt>
                <dd className="text-sm font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                  {chat.memberCount > 0 ? formatNumberCompact(chat.memberCount) : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Last Synced</dt>
                <dd className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                  {formatShortDate(chat.lastSyncedAt)}
                </dd>
              </div>
            </dl>

            {pinnedMessages.length > 0 && (
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2.5">
                  <Pin className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                  <span>Pinned Messages ({pinnedMessages.length})</span>
                </div>
                <div className="space-y-2">
                  {pinnedMessages.map((pm) => (
                    <button
                      key={pm.id}
                      type="button"
                      onClick={() => onJumpToMessage(pm.tgMessageId)}
                      className="w-full text-left p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-sky-300 dark:hover:border-sky-700 transition-colors"
                    >
                      <div className="text-xs font-medium text-slate-900 dark:text-slate-100">
                        {pm.senderName} · #{pm.tgMessageId}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">
                        {pm.text}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
              <a
                href={`/api/chats/${encodeURIComponent(chat.id)}/export`}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Download Portable JSON Archive
              </a>

              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 border border-transparent hover:border-red-200 dark:hover:border-red-900 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove Mirrored Archive
                </button>
              ) : (
                <div className="p-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50/70 dark:bg-red-950/30 space-y-2">
                  <p className="text-xs text-red-800 dark:text-red-200">
                    Delete this local mirror and its downloaded media files?
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmDelete(false);
                        onDeleteChat(chat.id);
                      }}
                      className="flex-1 px-3 py-1.5 rounded-md text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
                    >
                      Confirm Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="flex-1 px-3 py-1.5 rounded-md text-xs font-medium bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

import { ArrowUpRight, Download, ExternalLink, FileText, Image as ImageIcon, Link2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ChatSummary, MediaVaultItem } from '../types';
import { formatBytes, formatShortDate, isSafeHttpUrl } from '../utils/format';

interface MediaVaultViewProps {
  chats: ChatSummary[];
  onNavigateToMessage: (chatId: string, tgMessageId: number) => void;
  onOpenLightbox: (item: MediaVaultItem) => void;
}

export function MediaVaultView({ chats, onNavigateToMessage, onOpenLightbox }: MediaVaultViewProps) {
  const [kind, setKind] = useState<'all' | 'photo' | 'document' | 'links'>('all');
  const [chatId, setChatId] = useState<string>('all');
  const [items, setItems] = useState<MediaVaultItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/media?chatId=${encodeURIComponent(chatId)}&kind=${encodeURIComponent(kind)}`)
      .then((r) => r.json())
      .then((data) => {
        if (active) {
          setItems(Array.isArray(data.items) ? data.items : []);
        }
      })
      .catch(() => {
        if (active) setItems([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [chatId, kind]);

  const photoItems = items.filter((i) => i.mediaType === 'photo' || i.mediaType === 'video');
  const docItems = items.filter(
    (i) => i.mediaType === 'document' || i.mediaType === 'audio' || i.mediaType === 'voice'
  );
  const linkItems = items.filter((i) => i.extractedUrls.length > 0);

  return (
    <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-950">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Offline Media Vault
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Browse locally mirrored images, attached files, and extracted URLs across all archived chats.
            </p>
          </div>

          <div className="flex items-center flex-wrap gap-3">
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
              {(
                [
                  { id: 'all', label: 'All Items' },
                  { id: 'photo', label: 'Photos' },
                  { id: 'document', label: 'Documents' },
                  { id: 'links', label: 'Shared Links' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setKind(tab.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    kind === tab.id
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <select
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              aria-label="Filter by mirrored chat"
              className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="all">All Mirrored Chats</option>
              {chats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-56 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 animate-pulse"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
            <ImageIcon className="w-8 h-8 text-slate-400 mx-auto mb-3" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              No archived media matches this filter
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Import a Telegram export or sync updates from a connected bot to populate the vault.
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {/* Photos Grid */}
            {(kind === 'all' || kind === 'photo') && photoItems.length > 0 && (
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                    Mirrored Photos
                  </h2>
                  <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {photoItems.length} {photoItems.length === 1 ? 'item' : 'items'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {photoItems.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden flex flex-col"
                    >
                      {item.mediaUrl ? (
                        <button
                          type="button"
                          onClick={() => onOpenLightbox(item)}
                          className="relative aspect-[4/3] w-full bg-slate-100 dark:bg-slate-800 overflow-hidden group"
                        >
                          <img
                            src={item.mediaUrl}
                            alt={item.mediaName || 'Archived photo'}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                          />
                        </button>
                      ) : (
                        <div className="aspect-[4/3] w-full bg-slate-100 dark:bg-slate-800/70 flex flex-col items-center justify-center p-4 text-center">
                          <ImageIcon className="w-7 h-7 text-slate-400 mb-2" />
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {item.mediaName || 'Indexed photo'}
                          </span>
                        </div>
                      )}
                      <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                        <div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                            {item.chatTitle} · {formatShortDate(item.dateIso)}
                          </div>
                          <p className="text-sm text-slate-800 dark:text-slate-200 line-clamp-2 mt-1">
                            {item.text || item.mediaName || 'Photo attachment'}
                          </p>
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                          <span className="text-xs font-mono tabular-nums text-slate-400">
                            {formatBytes(item.mediaSize)}
                          </span>
                          <button
                            type="button"
                            onClick={() => onNavigateToMessage(item.chatId, item.tgMessageId)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline whitespace-nowrap"
                          >
                            Open in Chat
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Documents Table */}
            {(kind === 'all' || kind === 'document') && docItems.length > 0 && (
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                    Documents &amp; Attachments
                  </h2>
                  <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {docItems.length} {docItems.length === 1 ? 'file' : 'files'}
                  </span>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 text-xs font-medium text-slate-500 dark:text-slate-400">
                        <th className="py-2.5 px-4">Filename</th>
                        <th className="py-2.5 px-4">Mirrored Chat</th>
                        <th className="py-2.5 px-4">Sender</th>
                        <th className="py-2.5 px-4 text-right">Size</th>
                        <th className="py-2.5 px-4 text-right">Archived</th>
                        <th className="py-2.5 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                      {docItems.map((doc) => (
                        <tr
                          key={doc.id}
                          className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors"
                        >
                          <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100">
                            <div className="flex items-center gap-2.5">
                              <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                              <span className="truncate max-w-xs">{doc.mediaName || 'Untitled file'}</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300 truncate max-w-[180px]">
                            {doc.chatTitle}
                          </td>
                          <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400 truncate max-w-[140px]">
                            {doc.senderName}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400">
                            {formatBytes(doc.mediaSize)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {formatShortDate(doc.dateIso)}
                          </td>
                          <td className="py-2.5 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-3">
                              {doc.mediaUrl && (
                                <a
                                  href={doc.mediaUrl}
                                  download={doc.mediaName || undefined}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:text-sky-600 dark:hover:text-sky-400"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  Save
                                </a>
                              )}
                              <button
                                type="button"
                                onClick={() => onNavigateToMessage(doc.chatId, doc.tgMessageId)}
                                className="text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline"
                              >
                                Context
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Shared Links */}
            {(kind === 'all' || kind === 'links') && linkItems.length > 0 && (
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                    Extracted Links
                  </h2>
                  <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {linkItems.length} {linkItems.length === 1 ? 'post' : 'posts'}
                  </span>
                </div>

                <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  {linkItems.map((item) => (
                    <div
                      key={item.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {item.chatTitle} · {item.senderName} · {formatShortDate(item.dateIso)}
                        </div>
                        <div className="flex flex-col gap-1">
                          {item.extractedUrls
                            .filter((u) => isSafeHttpUrl(u))
                            .map((url, idx) => (
                              <a
                                key={idx}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-600 dark:text-sky-400 hover:underline truncate"
                              >
                                <Link2 className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">{url}</span>
                                <ExternalLink className="w-3 h-3 shrink-0" />
                              </a>
                            ))}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => onNavigateToMessage(item.chatId, item.tgMessageId)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shrink-0 whitespace-nowrap"
                      >
                        Open Post
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

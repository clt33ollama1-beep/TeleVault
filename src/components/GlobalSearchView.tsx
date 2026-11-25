import { ArrowUpRight, FileText, Image as ImageIcon, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ChatSummary, SearchHit } from '../types';
import { formatShortDate, formatTimeTabular } from '../utils/format';

interface GlobalSearchViewProps {
  chats: ChatSummary[];
  initialQuery?: string;
  onNavigateToMessage: (chatId: string, tgMessageId: number) => void;
}

export function GlobalSearchView({
  chats,
  initialQuery = '',
  onNavigateToMessage,
}: GlobalSearchViewProps) {
  const [query, setQuery] = useState(initialQuery);
  const [chatId, setChatId] = useState('all');
  const [mediaType, setMediaType] = useState('all');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialQuery) setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setHits([]);
      return;
    }

    const timer = setTimeout(() => {
      setLoading(true);
      fetch(
        `/api/search?q=${encodeURIComponent(trimmed)}&chatId=${encodeURIComponent(
          chatId
        )}&mediaType=${encodeURIComponent(mediaType)}`
      )
        .then((r) => r.json())
        .then((data) => {
          setHits(Array.isArray(data.hits) ? data.hits : []);
        })
        .catch(() => setHits([]))
        .finally(() => setLoading(false));
    }, 180);

    return () => clearTimeout(timer);
  }, [query, chatId, mediaType]);

  return (
    <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-950">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Full-Text Archive Search
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Instant offline SQLite FTS5 search across message bodies, senders, and attached filenames.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search keywords, commands, senders, or filenames..."
              autoFocus
              className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <select
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            aria-label="Filter search by chat"
            className="px-3 py-2.5 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
          >
            <option value="all">All Chats</option>
            {chats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>

          <select
            value={mediaType}
            onChange={(e) => setMediaType(e.target.value)}
            aria-label="Filter search by media type"
            className="px-3 py-2.5 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
          >
            <option value="all">Any Content</option>
            <option value="photo">Photos Only</option>
            <option value="document">Documents Only</option>
          </select>
        </div>

        {!query.trim() ? (
          <div className="py-16 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
            <Search className="w-7 h-7 text-slate-400 mx-auto mb-2.5" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Enter a search term to query your local Telegram mirror
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Try terms like <button type="button" onClick={() => setQuery('WAL')} className="text-sky-600 dark:text-sky-400 hover:underline font-mono">WAL</button>,{' '}
              <button type="button" onClick={() => setQuery('concourse')} className="text-sky-600 dark:text-sky-400 hover:underline font-mono">concourse</button>, or{' '}
              <button type="button" onClick={() => setQuery('SQLite')} className="text-sky-600 dark:text-sky-400 hover:underline font-mono">SQLite</button>
            </p>
          </div>
        ) : loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-24 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 animate-pulse"
              />
            ))}
          </div>
        ) : hits.length === 0 ? (
          <div className="py-14 text-center border border-slate-200 dark:border-slate-800 rounded-xl">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              No archived messages matched "{query}"
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {hits.length} matching {hits.length === 1 ? 'message' : 'messages'}
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              {hits.map((hit) => (
                <div
                  key={hit.id}
                  className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors flex items-start justify-between gap-4"
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex items-center flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {hit.chatTitle}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{hit.senderName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {formatShortDate(hit.dateIso)} {formatTimeTabular(hit.dateIso)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">#{hit.tgMessageId}</span>
                    </div>

                    <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                      {hit.text}
                    </p>

                    {hit.mediaName && (
                      <div className="inline-flex items-center gap-1.5 text-xs font-mono text-slate-500 dark:text-slate-400">
                        {hit.mediaType === 'photo' ? (
                          <ImageIcon className="w-3.5 h-3.5" />
                        ) : (
                          <FileText className="w-3.5 h-3.5" />
                        )}
                        <span>{hit.mediaName}</span>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => onNavigateToMessage(hit.chatId, hit.tgMessageId)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-sky-600 dark:text-sky-400 border border-slate-200 dark:border-slate-700 hover:bg-sky-50 dark:hover:bg-sky-950/50 shrink-0 whitespace-nowrap transition-colors"
                  >
                    Jump
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

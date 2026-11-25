import {
  ArrowDown,
  Download,
  Info,
  Menu,
  Moon,
  Pin,
  Search,
  Sun,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GlobalSearchView } from './components/GlobalSearchView';
import { LightboxModal, type LightboxPayload } from './components/LightboxModal';
import { MediaVaultView } from './components/MediaVaultView';
import { MessageItem } from './components/MessageItem';
import { SyncSourcesView } from './components/SyncSourcesView';
import { ThreadDrawer } from './components/ThreadDrawer';
import type {
  ArchivedMessage,
  ArchiveStats,
  ChatSummary,
  MediaVaultItem,
  MessageComment,
} from './types';
import {
  formatBytes,
  formatDayLabel,
  formatNumberCompact,
  formatShortDate,
  getAvatarTone,
  getInitials,
} from './utils/format';

type AppTab = 'archive' | 'media' | 'sources' | 'search';
type SidebarFilter = 'all' | 'channel' | 'group' | 'bookmarked';
type StreamFilter = 'all' | 'media' | 'files' | 'links' | 'pinned' | 'bookmarked';

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('archive');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [stats, setStats] = useState<ArchiveStats | null>(null);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [chatsLoading, setChatsLoading] = useState(true);

  const [sidebarFilter, setSidebarFilter] = useState<SidebarFilter>('all');
  const [sidebarSearch, setSidebarSearch] = useState('');

  const [messages, setMessages] = useState<ArchivedMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [streamFilter, setStreamFilter] = useState<StreamFilter>('all');
  const [streamSearch, setStreamSearch] = useState('');

  const [drawerMode, setDrawerMode] = useState<'thread' | 'info' | null>(null);
  const [threadRoot, setThreadRoot] = useState<ArchivedMessage | null>(null);
  const [threadReplies, setThreadReplies] = useState<ArchivedMessage[]>([]);
  const [threadComments, setThreadComments] = useState<MessageComment[]>([]);

  const [highlightedTgId, setHighlightedTgId] = useState<number | null>(null);
  const [pendingJumpTgId, setPendingJumpTgId] = useState<number | null>(null);
  const [showJumpBottom, setShowJumpBottom] = useState(false);

  const [lightboxItem, setLightboxItem] = useState<LightboxPayload | null>(null);
  const [searchSeedQuery, setSearchSeedQuery] = useState('');

  const streamRef = useRef<HTMLDivElement | null>(null);

  // Sync Tailwind .dark class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const loadChats = useCallback(async (preferChatId?: string) => {
    setChatsLoading(true);
    try {
      const res = await fetch('/api/chats');
      const data = await res.json();
      const loadedChats: ChatSummary[] = Array.isArray(data.chats) ? data.chats : [];
      setChats(loadedChats);
      if (data.stats) setStats(data.stats);

      setSelectedChatId((prev) => {
        if (preferChatId && loadedChats.some((c) => c.id === preferChatId)) {
          return preferChatId;
        }
        if (prev && loadedChats.some((c) => c.id === prev)) {
          return prev;
        }
        return loadedChats[0]?.id ?? null;
      });
    } catch {
      setChats([]);
    } finally {
      setChatsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  const loadMessages = useCallback(async (chatId: string, filter: StreamFilter, query: string) => {
    setMessagesLoading(true);
    try {
      const params = new URLSearchParams({
        filter,
        q: query,
        limit: '300',
      });
      const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/messages?${params.toString()}`);
      const data = await res.json();
      setMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch {
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedChatId) {
      setMessages([]);
      return;
    }
    const timer = setTimeout(() => {
      loadMessages(selectedChatId, streamFilter, streamSearch);
    }, streamSearch ? 180 : 0);
    return () => clearTimeout(timer);
  }, [selectedChatId, streamFilter, streamSearch, loadMessages]);

  // Execute pending scroll-to-message after chat switches or loads
  useEffect(() => {
    if (pendingJumpTgId === null || messagesLoading) return;
    const el = document.getElementById(`msg-${pendingJumpTgId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedTgId(pendingJumpTgId);
      setPendingJumpTgId(null);
      const t = setTimeout(() => setHighlightedTgId(null), 2400);
      return () => clearTimeout(t);
    }
  }, [pendingJumpTgId, messagesLoading, messages]);

  const selectedChat = useMemo(
    () => chats.find((c) => c.id === selectedChatId) ?? null,
    [chats, selectedChatId]
  );

  const filteredChats = useMemo(() => {
    return chats.filter((c) => {
      if (sidebarFilter === 'channel' && c.chatType !== 'channel') return false;
      if (sidebarFilter === 'group' && c.chatType === 'channel') return false;
      if (sidebarFilter === 'bookmarked' && c.bookmarkedCount === 0) return false;
      if (sidebarSearch.trim()) {
        const q = sidebarSearch.trim().toLowerCase();
        const matchTitle = c.title.toLowerCase().includes(q);
        const matchUser = (c.username || '').toLowerCase().includes(q);
        if (!matchTitle && !matchUser) return false;
      }
      return true;
    });
  }, [chats, sidebarFilter, sidebarSearch]);

  const groupedByDay = useMemo(() => {
    const groups: Array<{ day: string; items: ArchivedMessage[] }> = [];
    for (const msg of messages) {
      const day = formatDayLabel(msg.dateIso);
      const lastGroup = groups[groups.length - 1];
      if (!lastGroup || lastGroup.day !== day) {
        groups.push({ day, items: [msg] });
      } else {
        lastGroup.items.push(msg);
      }
    }
    return groups;
  }, [messages]);

  const pinnedMessages = useMemo(() => messages.filter((m) => m.isPinned), [messages]);
  const primaryPinned = pinnedMessages[pinnedMessages.length - 1] ?? null;

  const handleJumpToMessage = (tgMessageId: number) => {
    const el = document.getElementById(`msg-${tgMessageId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedTgId(tgMessageId);
      setTimeout(() => setHighlightedTgId(null), 2400);
    } else {
      setStreamFilter('all');
      setStreamSearch('');
      setPendingJumpTgId(tgMessageId);
    }
  };

  const handleNavigateToChatAndMessage = (chatId: string, tgMessageId: number) => {
    setActiveTab('archive');
    setStreamFilter('all');
    setStreamSearch('');
    setDrawerMode(null);
    if (selectedChatId !== chatId) {
      setSelectedChatId(chatId);
    }
    setPendingJumpTgId(tgMessageId);
  };

  const handleOpenThread = async (tgMessageId: number) => {
    if (!selectedChatId) return;
    try {
      const res = await fetch(
        `/api/chats/${encodeURIComponent(selectedChatId)}/threads/${tgMessageId}`
      );
      const data = await res.json();
      if (data.root) {
        setThreadRoot(data.root);
        setThreadReplies(Array.isArray(data.replies) ? data.replies : []);
        setThreadComments(Array.isArray(data.comments) ? data.comments : []);
        setDrawerMode('thread');
      }
    } catch {
      // Ignore error
    }
  };

  const handleToggleBookmark = async (messageId: number) => {
    try {
      const res = await fetch(`/api/messages/${messageId}/bookmark`, { method: 'POST' });
      if (!res.ok) return;
      const updated = (await res.json()) as { id: number; isBookmarked: boolean };
      setMessages((prev) =>
        prev.map((m) => (m.id === updated.id ? { ...m, isBookmarked: updated.isBookmarked } : m))
      );
      loadChats(selectedChatId ?? undefined);
    } catch {
      // Ignore
    }
  };

  const handleDeleteChat = async (chatId: string) => {
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' });
      if (!res.ok) return;
      setDrawerMode(null);
      await loadChats();
    } catch {
      // Ignore
    }
  };

  const handleOpenMessageLightbox = (msg: ArchivedMessage) => {
    if (!msg.mediaUrl) return;
    setLightboxItem({
      chatId: msg.chatId,
      chatTitle: selectedChat?.title,
      tgMessageId: msg.tgMessageId,
      senderName: msg.senderName,
      dateIso: msg.dateIso,
      mediaUrl: msg.mediaUrl,
      mediaName: msg.mediaName,
      caption: msg.text,
    });
  };

  const handleOpenVaultLightbox = (item: MediaVaultItem) => {
    if (!item.mediaUrl) return;
    setLightboxItem({
      chatId: item.chatId,
      chatTitle: item.chatTitle,
      tgMessageId: item.tgMessageId,
      senderName: item.senderName,
      dateIso: item.dateIso,
      mediaUrl: item.mediaUrl,
      mediaName: item.mediaName,
      caption: item.text,
    });
  };

  const handleHashtagSearch = (tag: string) => {
    setSearchSeedQuery(tag);
    setActiveTab('search');
  };

  const handleStreamScroll = () => {
    const el = streamRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowJumpBottom(distanceFromBottom > 280);
  };

  return (
    <div className="h-screen w-full flex flex-col bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden">
      {/* Top Navigation Bar — Strict 3-Zone Contract */}
      <header className="h-14 shrink-0 px-4 sm:px-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center justify-between gap-8">
        {/* Zone 1: Brand Wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          {activeTab === 'archive' && (
            <button
              type="button"
              onClick={() => setMobileSidebarOpen((v) => !v)}
              aria-label="Toggle mirrored chats drawer"
              className="lg:hidden p-1.5 -ml-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}
          <a
            href="#archive"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('archive');
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
          >
            TeleVault
          </a>
        </div>

        {/* Zone 2: 4 Clean Single-Line Nav Links */}
        <nav className="hidden md:flex items-center gap-7 h-full">
          {(
            [
              { id: 'archive', label: 'Archive' },
              { id: 'media', label: 'Media Vault' },
              { id: 'sources', label: 'Sync Sources' },
              { id: 'search', label: 'Global Search' },
            ] as const
          ).map((nav) => {
            const isActive = activeTab === nav.id;
            return (
              <button
                key={nav.id}
                type="button"
                onClick={() => setActiveTab(nav.id)}
                className={`h-full inline-flex items-center text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'border-sky-600 text-slate-950 dark:text-white'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {nav.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('sources')}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-sky-600 text-white hover:bg-sky-700 transition-colors whitespace-nowrap shrink-0"
          >
            Add Source
          </button>
        </div>
      </header>

      {/* Mobile Nav Bar (below top bar on small screens) */}
      <div className="md:hidden flex items-center justify-around border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-2 py-1.5 shrink-0">
        {(
          [
            { id: 'archive', label: 'Archive' },
            { id: 'media', label: 'Media' },
            { id: 'sources', label: 'Sources' },
            { id: 'search', label: 'Search' },
          ] as const
        ).map((nav) => (
          <button
            key={nav.id}
            type="button"
            onClick={() => setActiveTab(nav.id)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${
              activeTab === nav.id
                ? 'bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {nav.label}
          </button>
        ))}
      </div>

      {/* Main Viewport */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {activeTab === 'archive' && (
          <>
            {/* Left Sidebar: Mirrored Groups & Channels */}
            <aside
              className={`${
                mobileSidebarOpen ? 'fixed inset-y-14 left-0 z-40 flex' : 'hidden'
              } lg:static lg:flex w-[272px] shrink-0 flex-col border-r border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70`}
            >
              <div className="p-3 space-y-2.5 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between lg:hidden pb-1">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Mirrored Chats
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobileSidebarOpen(false)}
                    className="p-1 text-slate-400 hover:text-slate-700"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Segmented Chat Filter */}
                <div className="grid grid-cols-4 gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg">
                  {(
                    [
                      { id: 'all', label: 'All' },
                      { id: 'channel', label: 'Chan' },
                      { id: 'group', label: 'Grp' },
                      { id: 'bookmarked', label: 'Saved' },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setSidebarFilter(f.id)}
                      className={`py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        sidebarFilter === f.id
                          ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* Filter Chats Input */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={sidebarSearch}
                    onChange={(e) => setSidebarSearch(e.target.value)}
                    placeholder="Filter mirrored chats..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              {/* Chat List */}
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70">
                {chatsLoading ? (
                  <div className="p-3 space-y-2.5">
                    {[1, 2, 3].map((n) => (
                      <div
                        key={n}
                        className="h-16 rounded-lg bg-slate-200/60 dark:bg-slate-800 animate-pulse"
                      />
                    ))}
                  </div>
                ) : filteredChats.length === 0 ? (
                  <div className="p-6 text-center space-y-2">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      No mirrored groups or channels match this filter.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('sources')}
                      className="text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline"
                    >
                      Import or Sync a Chat
                    </button>
                  </div>
                ) : (
                  filteredChats.map((chat) => {
                    const isSelected = chat.id === selectedChatId;
                    return (
                      <button
                        key={chat.id}
                        type="button"
                        onClick={() => {
                          setSelectedChatId(chat.id);
                          setDrawerMode(null);
                          setMobileSidebarOpen(false);
                        }}
                        className={`w-full text-left px-3.5 py-3 flex items-start gap-3 transition-colors ${
                          isSelected
                            ? 'bg-sky-50/90 dark:bg-sky-950/50'
                            : 'hover:bg-slate-100/80 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        {chat.avatarUrl ? (
                          <img
                            src={chat.avatarUrl}
                            alt={chat.title}
                            referrerPolicy="no-referrer"
                            className="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0 mt-0.5"
                          />
                        ) : (
                          <div
                            className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 mt-0.5 ${getAvatarTone(
                              chat.title
                            )}`}
                          >
                            {getInitials(chat.title)}
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`text-sm font-semibold truncate ${
                                isSelected
                                  ? 'text-sky-900 dark:text-sky-100'
                                  : 'text-slate-900 dark:text-slate-100'
                              }`}
                            >
                              {chat.title}
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate tabular-nums">
                            <span className="capitalize">{chat.chatType}</span>
                            <span aria-hidden="true"> · </span>
                            <span>{formatNumberCompact(chat.messageCount)} msgs</span>
                          </div>

                          {chat.lastMessageText && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-1">
                              {chat.lastMessageText}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Sidebar Footer: Theme Switch & Local Vault Stats */}
              <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center justify-between gap-2">
                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
                  {stats
                    ? `${stats.totalChats} chats · ${formatNumberCompact(stats.totalMessages)} msgs · ${formatBytes(
                        stats.storageBytes
                      )}`
                    : 'Local SQLite Vault'}
                </div>

                <button
                  type="button"
                  onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
                  aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
                  className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
                >
                  {theme === 'light' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
                </button>
              </div>
            </aside>

            {/* Main Archive Reader Viewport */}
            <main className="flex-1 min-w-0 flex flex-col bg-white dark:bg-slate-950 relative">
              {!selectedChat ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    No Mirrored Channel Selected
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mt-1.5">
                    Select a group or channel from the sidebar, or import a Telegram Desktop JSON export to begin browsing offline.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('sources')}
                    className="mt-4 px-4 py-2 rounded-lg text-xs font-medium bg-sky-600 text-white hover:bg-sky-700 transition-colors"
                  >
                    Import or Connect Bot
                  </button>
                </div>
              ) : (
                <>
                  {/* Chat Header & Toolbar */}
                  <div className="px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 space-y-3 shrink-0">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white truncate">
                          {selectedChat.title}
                        </h1>
                        <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                          <span className="capitalize">{selectedChat.chatType}</span>
                          {selectedChat.memberCount > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{formatNumberCompact(selectedChat.memberCount)} members</span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span>{formatNumberCompact(selectedChat.messageCount)} archived</span>
                          <span aria-hidden="true">·</span>
                          <span>Synced {formatShortDate(selectedChat.lastSyncedAt)}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <a
                          href={`/api/chats/${encodeURIComponent(selectedChat.id)}/export`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Export JSON
                        </a>

                        <button
                          type="button"
                          onClick={() =>
                            setDrawerMode((m) => (m === 'info' ? null : 'info'))
                          }
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                            drawerMode === 'info'
                              ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300'
                              : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          <Info className="w-3.5 h-3.5" />
                          Details
                        </button>
                      </div>
                    </div>

                    {/* Inline Message Stream Filters & Search */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-x-auto">
                        {(
                          [
                            { id: 'all', label: 'All' },
                            { id: 'media', label: 'Photos' },
                            { id: 'files', label: 'Files' },
                            { id: 'links', label: 'Links' },
                            { id: 'pinned', label: 'Pinned' },
                            { id: 'bookmarked', label: 'Saved' },
                          ] as const
                        ).map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setStreamFilter(tab.id)}
                            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                              streamFilter === tab.id
                                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>

                      <div className="relative w-full sm:w-64">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="search"
                          value={streamSearch}
                          onChange={(e) => setStreamSearch(e.target.value)}
                          placeholder="Search in this chat..."
                          className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Pinned Message Banner */}
                  {primaryPinned && streamFilter === 'all' && !streamSearch && (
                    <button
                      type="button"
                      onClick={() => handleJumpToMessage(primaryPinned.tgMessageId)}
                      className="w-full text-left px-4 sm:px-6 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-colors flex items-center justify-between gap-3 shrink-0"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Pin className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                        <div className="min-w-0">
                          <span className="text-xs font-semibold text-sky-700 dark:text-sky-400 mr-2">
                            Pinned Message
                          </span>
                          <span className="text-xs text-slate-600 dark:text-slate-300 truncate">
                            {primaryPinned.text.replace(/\s+/g, ' ').slice(0, 120)}
                          </span>
                        </div>
                      </div>
                      <span className="text-xs font-mono text-slate-400 shrink-0">
                        #{primaryPinned.tgMessageId}
                      </span>
                    </button>
                  )}

                  {/* Chronological Message Stream */}
                  <div
                    ref={streamRef}
                    onScroll={handleStreamScroll}
                    className="flex-1 overflow-y-auto"
                  >
                    {messagesLoading ? (
                      <div className="p-6 space-y-4">
                        {[1, 2, 3, 4].map((n) => (
                          <div
                            key={n}
                            className="h-20 rounded-xl bg-slate-100 dark:bg-slate-900 animate-pulse"
                          />
                        ))}
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="py-20 px-6 text-center">
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          No archived messages match this filter
                        </p>
                        {(streamFilter !== 'all' || streamSearch) && (
                          <button
                            type="button"
                            onClick={() => {
                              setStreamFilter('all');
                              setStreamSearch('');
                            }}
                            className="mt-3 text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline"
                          >
                            Reset Filters
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="pb-12">
                        {groupedByDay.map((group) => (
                          <section key={group.day}>
                            <div className="sticky top-0 z-10 flex justify-center py-2.5 bg-white/90 dark:bg-slate-950/90 backdrop-blur-xs border-b border-slate-100 dark:border-slate-900">
                              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                                {group.day}
                              </span>
                            </div>
                            <div>
                              {group.items.map((msg) => (
                                <MessageItem
                                  key={msg.id}
                                  message={msg}
                                  isHighlighted={highlightedTgId === msg.tgMessageId}
                                  onJumpToMessage={handleJumpToMessage}
                                  onOpenThread={handleOpenThread}
                                  onToggleBookmark={handleToggleBookmark}
                                  onOpenLightbox={handleOpenMessageLightbox}
                                  onHashtagClick={handleHashtagSearch}
                                />
                              ))}
                            </div>
                          </section>
                        ))}
                      </div>
                    )}
                  </div>

                  {showJumpBottom && (
                    <button
                      type="button"
                      onClick={() =>
                        streamRef.current?.scrollTo({
                          top: streamRef.current.scrollHeight,
                          behavior: 'smooth',
                        })
                      }
                      aria-label="Scroll to latest messages"
                      className="absolute bottom-5 right-6 z-20 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-lg hover:opacity-90 transition-opacity"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                      Latest
                    </button>
                  )}
                </>
              )}
            </main>

            {/* Right Context Inspector / Thread & Comments Drawer */}
            <ThreadDrawer
              mode={drawerMode}
              chat={selectedChat}
              threadRoot={threadRoot}
              threadReplies={threadReplies}
              threadComments={threadComments}
              pinnedMessages={pinnedMessages}
              onClose={() => setDrawerMode(null)}
              onJumpToMessage={handleJumpToMessage}
              onDeleteChat={handleDeleteChat}
              onOpenLightbox={setLightboxItem}
            />
          </>
        )}

        {activeTab === 'media' && (
          <MediaVaultView
            chats={chats}
            onNavigateToMessage={handleNavigateToChatAndMessage}
            onOpenLightbox={handleOpenVaultLightbox}
          />
        )}

        {activeTab === 'sources' && (
          <SyncSourcesView
            onArchiveUpdated={(focusChatId) => {
              loadChats(focusChatId);
              if (focusChatId) {
                setSelectedChatId(focusChatId);
                setActiveTab('archive');
              }
            }}
          />
        )}

        {activeTab === 'search' && (
          <GlobalSearchView
            chats={chats}
            initialQuery={searchSeedQuery}
            onNavigateToMessage={handleNavigateToChatAndMessage}
          />
        )}
      </div>

      {/* Photo Lightbox */}
      <LightboxModal
        item={lightboxItem}
        onClose={() => setLightboxItem(null)}
        onOpenInChat={handleNavigateToChatAndMessage}
      />
    </div>
  );
}

import {
  Bot,
  CheckCircle2,
  FileJson,
  Globe,
  Plus,
  RefreshCw,
  ShieldCheck,
  Unplug,
  Upload,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { BotConnectionStatus, SyncLogEntry } from '../types';
import { formatShortDate, formatTimeTabular } from '../utils/format';

interface SyncSourcesViewProps {
  onArchiveUpdated: (focusChatId?: string) => void;
}

interface ParsedImportPreview {
  name: string;
  type: string;
  messageCount: number;
  rawPayload: unknown;
}

export function SyncSourcesView({ onArchiveUpdated }: SyncSourcesViewProps) {
  const [botStatus, setBotStatus] = useState<BotConnectionStatus | null>(null);
  const [logs, setLogs] = useState<SyncLogEntry[]>([]);
  const [tokenInput, setTokenInput] = useState('');
  const [autoDownload, setAutoDownload] = useState(true);
  const [chatIdentifier, setChatIdentifier] = useState('');

  const [publicChannelInput, setPublicChannelInput] = useState('');
  const [publicDownloadMedia, setPublicDownloadMedia] = useState(true);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const [importPreview, setImportPreview] = useState<ParsedImportPreview | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadBotStatus = async () => {
    try {
      const res = await fetch('/api/bot/status');
      const data = await res.json();
      setBotStatus(data.bot);
      setLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch {
      // Ignore transient network errors
    }
  };

  useEffect(() => {
    loadBotStatus();
  }, []);

  const handleMirrorPublicChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicChannelInput.trim()) return;
    setBusyAction('public');
    setFeedback(null);
    try {
      const res = await fetch('/api/public/mirror', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: publicChannelInput.trim(),
          downloadMedia: publicDownloadMedia,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Public channel mirror failed');
      setPublicChannelInput('');
      setLogs(data.logs || []);
      setFeedback({
        kind: 'success',
        text: `Mirrored ${data.messagesAdded} posts (${data.mediaDownloaded} images) from "${data.title}".`,
      });
      onArchiveUpdated(data.chatId);
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Unable to mirror public channel.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleFileSelect = async (file: File | undefined) => {
    if (!file) return;
    setFeedback(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { name?: string; type?: string; messages?: unknown[] };
      if (!parsed || !Array.isArray(parsed.messages)) {
        throw new Error('Selected JSON does not contain a Telegram Desktop "messages" array.');
      }
      setImportPreview({
        name: parsed.name || file.name.replace(/\.json$/i, ''),
        type: parsed.type || 'group',
        messageCount: parsed.messages.length,
        rawPayload: parsed,
      });
    } catch (err) {
      setImportPreview(null);
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Unable to parse JSON export file.',
      });
    }
  };

  const handleCommitImport = async () => {
    if (!importPreview) return;
    setBusyAction('import');
    setFeedback(null);
    try {
      const res = await fetch('/api/import/telegram-json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(importPreview.rawPayload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setImportPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setFeedback({
        kind: 'success',
        text: `Imported ${data.importedCount} messages into "${data.title}".`,
      });
      await loadBotStatus();
      onArchiveUpdated(data.chatId);
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Failed to import archive.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleConnectBot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    setBusyAction('connect');
    setFeedback(null);
    try {
      const res = await fetch('/api/bot/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput.trim(), autoDownloadMedia: autoDownload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to verify bot token');
      setTokenInput('');
      setBotStatus(data.bot);
      setLogs(data.logs || []);
      setFeedback({
        kind: 'success',
        text: `Verified Bot @${data.bot.botUsername || data.bot.botName} on server.`,
      });
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Failed to connect bot.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSyncUpdates = async () => {
    setBusyAction('sync');
    setFeedback(null);
    try {
      const res = await fetch('/api/bot/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      setBotStatus(data.bot);
      setLogs(data.logs || []);
      setFeedback({
        kind: 'success',
        text: `Synced ${data.messagesAdded} message(s) and downloaded ${data.mediaDownloaded} media file(s).`,
      });
      onArchiveUpdated();
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Failed to sync updates.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleAddChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatIdentifier.trim()) return;
    setBusyAction('add-chat');
    setFeedback(null);
    try {
      const res = await fetch('/api/bot/add-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatIdentifier: chatIdentifier.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not resolve channel or group');
      setChatIdentifier('');
      setLogs(data.logs || []);
      setFeedback({
        kind: 'success',
        text: 'Registered channel/group in offline mirror.',
      });
      onArchiveUpdated(data.chatId);
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Failed to register chat.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDisconnectBot = async () => {
    setBusyAction('disconnect');
    try {
      const res = await fetch('/api/bot/disconnect', { method: 'DELETE' });
      const data = await res.json();
      setBotStatus(data.bot);
      setFeedback({ kind: 'success', text: 'Disconnected bot token from server session.' });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-950">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <div className="pb-6 border-b border-slate-200 dark:border-slate-800">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Mirror Sources &amp; Importers
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Mirror public channels owned by others, import full history from Telegram Desktop exports, or sync owned chats via Bot API.
          </p>
        </div>

        {feedback && (
          <div
            role="status"
            className={`px-4 py-3 rounded-xl border text-sm flex items-center justify-between gap-4 ${
              feedback.kind === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200'
                : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-800 dark:text-red-200'
            }`}
          >
            <span>{feedback.text}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-xs font-medium underline shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Panel 0: Public Channel Mirror (Channels Owned by Others) */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
                <Globe className="w-5 h-5 text-sky-600 dark:text-sky-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  Public Channel Mirror (Owned by Others)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Archive any public Telegram channel by <code className="font-mono">@username</code> or{' '}
                  <code className="font-mono">t.me/channel</code> link without needing admin access or a bot token
                </p>
              </div>
            </div>
          </div>

          <form
            onSubmit={handleMirrorPublicChannel}
            className="flex flex-col sm:flex-row sm:items-center gap-3 bg-white dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800"
          >
            <input
              type="text"
              value={publicChannelInput}
              onChange={(e) => setPublicChannelInput(e.target.value)}
              placeholder="@telegram or https://t.me/telegram"
              className="flex-1 px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={publicDownloadMedia}
                onChange={(e) => setPublicDownloadMedia(e.target.checked)}
                className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              <span>Save photos locally</span>
            </label>
            <button
              type="submit"
              disabled={busyAction === 'public' || !publicChannelInput.trim()}
              className="px-4 py-2 rounded-lg text-xs font-medium bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              {busyAction === 'public' ? 'Mirroring Channel...' : 'Mirror Public Channel'}
            </button>
          </form>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            For private groups or private channels owned by others where you are a member, export the chat in Telegram Desktop (<code className="font-mono">Export Chat History → JSON</code>) and upload <code className="font-mono">result.json</code> below.
          </p>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          {/* Panel 1: Telegram Desktop JSON Export Importer */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-6 flex flex-col justify-between gap-6">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
                    <FileJson className="w-5 h-5 text-sky-600 dark:text-sky-400" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                      Import Telegram Desktop Export
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Best for groups &amp; private channels you joined · Supports <code className="font-mono">result.json</code>
                    </p>
                  </div>
                </div>
              </div>

              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleFileSelect(e.dataTransfer.files?.[0]);
                }}
                className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-6 text-center space-y-3"
              >
                <Upload className="w-6 h-6 text-slate-400 mx-auto" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    Drop <code className="font-mono">result.json</code> here or browse your disk
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    In Telegram Desktop: Group/Channel Menu → Export Chat History → Format: JSON
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => handleFileSelect(e.target.files?.[0])}
                  className="hidden"
                  id="tg-json-upload"
                />
                <label
                  htmlFor="tg-json-upload"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 cursor-pointer transition-colors"
                >
                  Choose JSON File
                </label>
              </div>

              {importPreview && (
                <div className="p-4 rounded-xl bg-white dark:bg-slate-950 border border-sky-200 dark:border-sky-800 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {importPreview.name}
                    </span>
                    <span className="text-xs font-mono tabular-nums text-sky-700 dark:text-sky-400">
                      {importPreview.messageCount.toLocaleString()} records
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busyAction === 'import'}
                      onClick={handleCommitImport}
                      className="flex-1 px-4 py-2 rounded-lg text-xs font-medium bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 transition-colors"
                    >
                      {busyAction === 'import' ? 'Indexing into SQLite...' : 'Import Into Offline Vault'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportPreview(null)}
                      className="px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="text-xs text-slate-500 dark:text-slate-400 pt-3 border-t border-slate-200 dark:border-slate-800">
              All imported messages are indexed locally in SQLite FTS5 for instant offline full-text search.
            </div>
          </section>

          {/* Panel 2: Telegram Bot API Live Sync */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-6 flex flex-col justify-between gap-6">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
                    <Bot className="w-5 h-5 text-sky-600 dark:text-sky-400" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                      Telegram Bot API Mirror
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      For channels &amp; groups where your Bot is added as member or admin
                    </p>
                  </div>
                </div>
              </div>

              {!botStatus?.connected ? (
                <form onSubmit={handleConnectBot} className="space-y-3 bg-white dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div>
                    <label htmlFor="bot-token" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Bot Token (from @BotFather)
                    </label>
                    <input
                      id="bot-token"
                      type="password"
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      placeholder="123456789:AAH..."
                      autoComplete="off"
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>

                  <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoDownload}
                      onChange={(e) => setAutoDownload(e.target.checked)}
                      className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    <span>Automatically download photos &amp; documents to local disk</span>
                  </label>

                  <button
                    type="submit"
                    disabled={busyAction === 'connect' || !tokenInput.trim()}
                    className="w-full px-4 py-2 rounded-lg text-xs font-medium bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 transition-colors"
                  >
                    {busyAction === 'connect' ? 'Verifying with Telegram...' : 'Connect Bot Token'}
                  </button>
                </form>
              ) : (
                <div className="space-y-4 bg-white dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          @{botStatus.botUsername || botStatus.botName || 'Connected Bot'}
                        </div>
                        <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                          Token {botStatus.maskedToken} · Offset {botStatus.lastOffset}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleDisconnectBot}
                      disabled={busyAction === 'disconnect'}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                    >
                      <Unplug className="w-3.5 h-3.5" />
                      Disconnect
                    </button>
                  </div>

                  <form onSubmit={handleAddChat} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={chatIdentifier}
                      onChange={(e) => setChatIdentifier(e.target.value)}
                      placeholder="@channel_username or -1001234567890"
                      className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                    <button
                      type="submit"
                      disabled={busyAction === 'add-chat' || !chatIdentifier.trim()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Track Chat
                    </button>
                  </form>

                  <button
                    type="button"
                    onClick={handleSyncUpdates}
                    disabled={busyAction === 'sync'}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-medium bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'sync' ? 'animate-spin' : ''}`} />
                    {busyAction === 'sync' ? 'Polling Telegram Updates...' : 'Sync New Messages & Media Now'}
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 pt-3 border-t border-slate-200 dark:border-slate-800">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Bot tokens stay strictly in server memory and are never exposed to the browser.</span>
            </div>
          </section>
        </div>

        {/* Sync Activity Log */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Sync &amp; Import History
            </h2>
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {logs.length} {logs.length === 1 ? 'event' : 'events'}
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4">Time</th>
                  <th className="py-2.5 px-4">Source</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Detail</th>
                  <th className="py-2.5 px-4 text-right">Messages</th>
                  <th className="py-2.5 px-4 text-right">Media</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-xs text-slate-500">
                      No sync activity recorded yet.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                      <td className="py-2.5 px-4 font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatShortDate(log.createdAt)} · {formatTimeTabular(log.createdAt)}
                      </td>
                      <td className="py-2.5 px-4 text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {log.source === 'bot_api'
                          ? 'Bot API'
                          : log.source === 'json_import'
                            ? 'Mirror / Import'
                            : 'Archive Export'}
                      </td>
                      <td className="py-2.5 px-4 text-xs whitespace-nowrap">
                        <span
                          className={
                            log.status === 'success'
                              ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                              : log.status === 'warning'
                                ? 'text-amber-700 dark:text-amber-400 font-medium'
                                : 'text-red-700 dark:text-red-400 font-medium'
                          }
                        >
                          {log.status === 'success' ? 'Completed' : log.status === 'warning' ? 'Partial' : 'Failed'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-700 dark:text-slate-300">
                        {log.detail}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300">
                        {log.messagesAdded}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400">
                        {log.mediaDownloaded}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

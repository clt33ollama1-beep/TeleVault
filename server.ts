import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import {
  addSyncLog,
  deleteChatAndMedia,
  getArchiveStats,
  getChatById,
  getThreadMessages,
  initDatabase,
  listChats,
  listCommentsForChat,
  listMediaVault,
  listSyncLogs,
  MEDIA_ROOT_DIR,
  queryChatMessages,
  searchMessagesFts,
  toggleMessageBookmark,
} from './src/server/db.ts';
import {
  connectBotToken,
  disconnectBot,
  getBotStatus,
  ingestTelegramDesktopJson,
  mirrorPublicChannel,
  registerChatViaBot,
  syncBotUpdates,
  verifyEnvBotIfNeeded,
} from './src/server/telegram.ts';

async function startServer() {
  initDatabase();
  await verifyEnvBotIfNeeded();

  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // Lightweight healthcheck endpoint for Docker & container orchestrators
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'televault' });
  });

  // List all mirrored chats & channels
  app.get('/api/chats', (_req, res) => {
    try {
      res.json({
        chats: listChats(),
        stats: getArchiveStats(),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load chats' });
    }
  });

  // Get messages for a chat with filtering
  app.get('/api/chats/:chatId/messages', (req, res) => {
    try {
      const { chatId } = req.params;
      const chat = getChatById(chatId);
      if (!chat) {
        res.status(404).json({ error: 'Mirrored chat not found' });
        return;
      }

      const rawFilter = typeof req.query.filter === 'string' ? req.query.filter : 'all';
      const allowedFilters = ['all', 'media', 'files', 'links', 'pinned', 'bookmarked'] as const;
      const filter = allowedFilters.includes(rawFilter as (typeof allowedFilters)[number])
        ? (rawFilter as (typeof allowedFilters)[number])
        : 'all';

      const query = typeof req.query.q === 'string' ? req.query.q : '';
      const limit = Number(req.query.limit) || 250;
      const offset = Number(req.query.offset) || 0;

      const result = queryChatMessages({ chatId, filter, query, limit, offset });
      res.json({ chat, ...result });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to query messages' });
    }
  });

  // Thread replies for a message
  app.get('/api/chats/:chatId/threads/:tgMessageId', (req, res) => {
    try {
      const tgMessageId = Number(req.params.tgMessageId);
      if (!Number.isInteger(tgMessageId)) {
        res.status(400).json({ error: 'Invalid message ID' });
        return;
      }
      const thread = getThreadMessages(req.params.chatId, tgMessageId);
      if (!thread.root) {
        res.status(404).json({ error: 'Thread root message not found' });
        return;
      }
      res.json(thread);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load thread' });
    }
  });

  // Export portable offline JSON archive
  app.get('/api/chats/:chatId/export', (req, res) => {
    try {
      const chat = getChatById(req.params.chatId);
      if (!chat) {
        res.status(404).json({ error: 'Chat not found' });
        return;
      }
      const { messages } = queryChatMessages({ chatId: chat.id, limit: 500 });
      const comments = listCommentsForChat(chat.id);
      const commentsByMsg = new Map<number, typeof comments>();
      for (const c of comments) {
        const list = commentsByMsg.get(c.targetTgMessageId) ?? [];
        list.push(c);
        commentsByMsg.set(c.targetTgMessageId, list);
      }

      addSyncLog({
        chatId: chat.id,
        source: 'archive_export',
        status: 'success',
        messagesAdded: messages.length,
        detail: `Exported ${messages.length} offline messages for "${chat.title}"`,
      });
      const safeName = chat.title.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'telegram_archive';
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}_mirror.json"`);
      res.send(
        JSON.stringify(
          {
            exportedBy: 'TeleVault Offline Mirror',
            exportedAt: new Date().toISOString(),
            name: chat.title,
            type: chat.chatType,
            id: chat.id,
            username: chat.username,
            messages: messages.map((m) => ({
              id: m.tgMessageId,
              type: 'message',
              date: m.dateIso,
              from: m.senderName,
              from_id: m.senderUsername,
              reply_to_message_id: m.replyToTgId,
              forwarded_from: m.forwardFrom,
              text: m.entities.length > 0 ? m.entities : m.text,
              media_type: m.mediaType,
              file: m.mediaName,
              reactions: m.reactions,
              comments: (commentsByMsg.get(m.tgMessageId) ?? []).map((c) => ({
                author: c.authorName,
                body: c.body,
                source: c.source,
                created_at: c.createdAt,
                media_type: c.mediaType,
                media_url: c.mediaUrl,
                file: c.mediaName,
                media_size: c.mediaSize,
                mime_type: c.mediaMime,
              })),
            })),
          },
          null,
          2
        )
      );
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Export failed' });
    }
  });

  // Delete mirrored chat
  app.delete('/api/chats/:chatId', (req, res) => {
    try {
      const deleted = deleteChatAndMedia(req.params.chatId);
      if (!deleted) {
        res.status(404).json({ error: 'Chat not found' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete chat' });
    }
  });

  // Toggle offline bookmark
  app.post('/api/messages/:id/bookmark', (req, res) => {
    try {
      const messageId = Number(req.params.id);
      if (!Number.isInteger(messageId)) {
        res.status(400).json({ error: 'Invalid message ID' });
        return;
      }
      const updated = toggleMessageBookmark(messageId);
      if (!updated) {
        res.status(404).json({ error: 'Message not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to toggle bookmark' });
    }
  });

  // Global FTS5 full-text search
  app.get('/api/search', (req, res) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      const chatId = typeof req.query.chatId === 'string' ? req.query.chatId : 'all';
      const mediaType = typeof req.query.mediaType === 'string' ? req.query.mediaType : 'all';
      if (!query.trim()) {
        res.json({ hits: [] });
        return;
      }
      const hits = searchMessagesFts({ query, chatId, mediaType });
      res.json({ hits });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Search failed' });
    }
  });

  // Media Vault listing
  app.get('/api/media', (req, res) => {
    try {
      const chatId = typeof req.query.chatId === 'string' ? req.query.chatId : 'all';
      const rawKind = typeof req.query.kind === 'string' ? req.query.kind : 'all';
      const kind = ['all', 'photo', 'document', 'links'].includes(rawKind)
        ? (rawKind as 'all' | 'photo' | 'document' | 'links')
        : 'all';
      res.json({ items: listMediaVault({ chatId, kind }) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load media vault' });
    }
  });

  // Securely serve locally mirrored media files with path confinement
  app.get('/api/media-files/:chatDir/:filename', (req, res) => {
    const safeChatDir = req.params.chatDir.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeFilename = path.basename(req.params.filename);
    const resolved = path.resolve(MEDIA_ROOT_DIR, safeChatDir, safeFilename);

    if (!resolved.startsWith(MEDIA_ROOT_DIR + path.sep) || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Media file not found' });
      return;
    }
    res.sendFile(resolved);
  });

  // Mirror any third-party public Telegram channel by @username or t.me URL
  app.post('/api/public/mirror', async (req, res) => {
    try {
      const channel = typeof req.body?.channel === 'string' ? req.body.channel : '';
      const downloadMedia = req.body?.downloadMedia !== false;
      const result = await mirrorPublicChannel(channel, downloadMedia);
      res.json({ ...result, logs: listSyncLogs(30) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Public channel mirror failed' });
    }
  });

  // Import Telegram Desktop JSON export
  app.post('/api/import/telegram-json', (req, res) => {
    try {
      const result = ingestTelegramDesktopJson(req.body);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Import failed' });
    }
  });

  // Telegram Bot API endpoints
  app.get('/api/bot/status', (_req, res) => {
    res.json({
      bot: getBotStatus(),
      logs: listSyncLogs(30),
    });
  });

  app.post('/api/bot/connect', async (req, res) => {
    try {
      const token = typeof req.body?.token === 'string' ? req.body.token : '';
      const autoDownloadMedia = req.body?.autoDownloadMedia !== false;
      const status = await connectBotToken(token, autoDownloadMedia);
      res.json({ bot: status, logs: listSyncLogs(30) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Bot connection failed' });
    }
  });

  app.post('/api/bot/sync', async (_req, res) => {
    try {
      const result = await syncBotUpdates();
      res.json({ ...result, bot: getBotStatus(), logs: listSyncLogs(30) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Sync failed' });
    }
  });

  app.post('/api/bot/add-chat', async (req, res) => {
    try {
      const chatIdentifier = typeof req.body?.chatIdentifier === 'string' ? req.body.chatIdentifier : '';
      const chatId = await registerChatViaBot(chatIdentifier);
      res.json({ chatId, logs: listSyncLogs(30) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to register chat' });
    }
  });

  app.delete('/api/bot/disconnect', (_req, res) => {
    disconnectBot();
    res.json({ bot: getBotStatus() });
  });

  const httpServer = http.createServer(app);

  // Vite dev middleware or static production build
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const PORT = Number(process.env.PORT) || (process.env.NODE_ENV === 'production' ? 3080 : 3000);
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`TeleVault mirror server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

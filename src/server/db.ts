import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type {
  ArchivedMessage,
  ArchiveStats,
  ChatSummary,
  ChatType,
  MediaType,
  MediaVaultItem,
  MessageComment,
  MessageReaction,
  SearchHit,
  SyncLogEntry,
  SyncMode,
  SyncStatus,
  TextEntity,
} from '../types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const MEDIA_ROOT_DIR = path.join(DATA_DIR, 'media');
const DB_PATH = path.join(DATA_DIR, 'mirror.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(MEDIA_ROOT_DIR)) {
  fs.mkdirSync(MEDIA_ROOT_DIR, { recursive: true });
}

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      username TEXT,
      chat_type TEXT NOT NULL CHECK(chat_type IN ('channel', 'supergroup', 'group')),
      description TEXT,
      avatar_url TEXT,
      member_count INTEGER NOT NULL DEFAULT 0,
      pinned_message_id INTEGER,
      sync_mode TEXT NOT NULL DEFAULT 'export' CHECK(sync_mode IN ('bot_api', 'export', 'sample')),
      sync_status TEXT NOT NULL DEFAULT 'idle' CHECK(sync_status IN ('synced', 'syncing', 'paused', 'error', 'idle')),
      last_synced_at TEXT,
      last_update_id INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      tg_message_id INTEGER NOT NULL,
      sender_name TEXT NOT NULL,
      sender_username TEXT,
      sender_role TEXT,
      date_iso TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      entities_json TEXT NOT NULL DEFAULT '[]',
      reply_to_tg_id INTEGER,
      reply_preview_sender TEXT,
      reply_preview_text TEXT,
      forward_from TEXT,
      media_type TEXT NOT NULL DEFAULT 'none' CHECK(media_type IN ('photo', 'document', 'video', 'audio', 'voice', 'poll', 'none')),
      media_url TEXT,
      media_name TEXT,
      media_size INTEGER,
      media_mime TEXT,
      media_width INTEGER,
      media_height INTEGER,
      views INTEGER NOT NULL DEFAULT 0,
      reactions_json TEXT NOT NULL DEFAULT '[]',
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_bookmarked INTEGER NOT NULL DEFAULT 0,
      UNIQUE(chat_id, tg_message_id),
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_date ON messages(chat_id, date_iso ASC, tg_message_id ASC);
    CREATE INDEX IF NOT EXISTS idx_messages_reply ON messages(chat_id, reply_to_tg_id);
    CREATE INDEX IF NOT EXISTS idx_messages_media ON messages(chat_id, media_type);

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      text,
      sender_name,
      media_name,
      content='messages',
      content_rowid='id',
      tokenize='unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, text, sender_name, media_name)
      VALUES (new.id, new.text, new.sender_name, COALESCE(new.media_name, ''));
    END;

    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, text, sender_name, media_name)
      VALUES ('delete', old.id, old.text, old.sender_name, COALESCE(old.media_name, ''));
    END;

    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, text, sender_name, media_name)
      VALUES ('delete', old.id, old.text, old.sender_name, COALESCE(old.media_name, ''));
      INSERT INTO messages_fts(rowid, text, sender_name, media_name)
      VALUES (new.id, new.text, new.sender_name, COALESCE(new.media_name, ''));
    END;

    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT,
      source TEXT NOT NULL CHECK(source IN ('bot_api', 'json_import', 'archive_export')),
      status TEXT NOT NULL CHECK(status IN ('success', 'warning', 'error')),
      messages_added INTEGER NOT NULL DEFAULT 0,
      media_downloaded INTEGER NOT NULL DEFAULT 0,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      target_tg_message_id INTEGER NOT NULL,
      author_name TEXT NOT NULL,
      body TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'mirrored' CHECK(source IN ('mirrored', 'local')),
      created_at TEXT NOT NULL,
      media_type TEXT NOT NULL DEFAULT 'none' CHECK(media_type IN ('photo', 'document', 'video', 'audio', 'voice', 'poll', 'none')),
      media_url TEXT,
      media_name TEXT,
      media_size INTEGER,
      media_mime TEXT,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(chat_id, target_tg_message_id, created_at ASC);
  `);

  // Safe migration for existing databases created prior to comment media columns
  const commentCols = db.prepare(`PRAGMA table_info(comments)`).all() as Array<{ name: string }>;
  const existingColNames = new Set(commentCols.map((c) => c.name));
  if (!existingColNames.has('media_type')) {
    db.exec(`ALTER TABLE comments ADD COLUMN media_type TEXT NOT NULL DEFAULT 'none'`);
  }
  if (!existingColNames.has('media_url')) {
    db.exec(`ALTER TABLE comments ADD COLUMN media_url TEXT`);
  }
  if (!existingColNames.has('media_name')) {
    db.exec(`ALTER TABLE comments ADD COLUMN media_name TEXT`);
  }
  if (!existingColNames.has('media_size')) {
    db.exec(`ALTER TABLE comments ADD COLUMN media_size INTEGER`);
  }
  if (!existingColNames.has('media_mime')) {
    db.exec(`ALTER TABLE comments ADD COLUMN media_mime TEXT`);
  }

  const chatCountRow = db.prepare('SELECT COUNT(*) AS count FROM chats').get() as { count: number };
  if (chatCountRow.count === 0) {
    seedInitialOfflineArchives();
  }
  db.prepare(`DELETE FROM comments WHERE source != 'mirrored'`).run();
  seedSampleCommentsIfEmpty();
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

interface RawMessageRow {
  id: number;
  chat_id: string;
  tg_message_id: number;
  sender_name: string;
  sender_username: string | null;
  sender_role: string | null;
  date_iso: string;
  text: string;
  entities_json: string;
  reply_to_tg_id: number | null;
  reply_preview_sender: string | null;
  reply_preview_text: string | null;
  forward_from: string | null;
  media_type: MediaType;
  media_url: string | null;
  media_name: string | null;
  media_size: number | null;
  media_mime: string | null;
  media_width: number | null;
  media_height: number | null;
  views: number;
  reactions_json: string;
  is_pinned: number;
  is_bookmarked: number;
  reply_count?: number;
}

function mapMessageRow(row: RawMessageRow): ArchivedMessage {
  return {
    id: row.id,
    chatId: row.chat_id,
    tgMessageId: row.tg_message_id,
    senderName: row.sender_name,
    senderUsername: row.sender_username,
    senderRole: row.sender_role,
    dateIso: row.date_iso,
    text: row.text,
    entities: safeJsonParse<TextEntity[]>(row.entities_json, []),
    replyToTgId: row.reply_to_tg_id,
    replyPreviewSender: row.reply_preview_sender,
    replyPreviewText: row.reply_preview_text,
    forwardFrom: row.forward_from,
    mediaType: row.media_type,
    mediaUrl: row.media_url,
    mediaName: row.media_name,
    mediaSize: row.media_size,
    mediaMime: row.media_mime,
    mediaWidth: row.media_width,
    mediaHeight: row.media_height,
    views: row.views,
    reactions: safeJsonParse<MessageReaction[]>(row.reactions_json, []),
    isPinned: Boolean(row.is_pinned),
    isBookmarked: Boolean(row.is_bookmarked),
    replyCount: row.reply_count ?? 0,
  };
}

export function listChats(): ChatSummary[] {
  const rows = db.prepare(`
    SELECT
      c.*,
      (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS message_count,
      (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id AND m.media_type != 'none') AS media_count,
      (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id AND m.is_bookmarked = 1) AS bookmarked_count,
      (SELECT m.text FROM messages m WHERE m.chat_id = c.id ORDER BY m.date_iso DESC, m.tg_message_id DESC LIMIT 1) AS last_message_text,
      (SELECT m.date_iso FROM messages m WHERE m.chat_id = c.id ORDER BY m.date_iso DESC, m.tg_message_id DESC LIMIT 1) AS last_message_date,
      (SELECT m.sender_name FROM messages m WHERE m.chat_id = c.id ORDER BY m.date_iso DESC, m.tg_message_id DESC LIMIT 1) AS last_message_sender
    FROM chats c
    ORDER BY COALESCE(last_message_date, c.created_at) DESC
  `).all() as Array<{
    id: string;
    title: string;
    username: string | null;
    chat_type: ChatType;
    description: string | null;
    avatar_url: string | null;
    member_count: number;
    pinned_message_id: number | null;
    sync_mode: SyncMode;
    sync_status: SyncStatus;
    last_synced_at: string | null;
    last_update_id: number;
    created_at: string;
    message_count: number;
    media_count: number;
    bookmarked_count: number;
    last_message_text: string | null;
    last_message_date: string | null;
    last_message_sender: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    username: r.username,
    chatType: r.chat_type,
    description: r.description,
    avatarUrl: r.avatar_url,
    memberCount: r.member_count,
    pinnedMessageId: r.pinned_message_id,
    syncMode: r.sync_mode,
    syncStatus: r.sync_status,
    lastSyncedAt: r.last_synced_at,
    lastUpdateId: r.last_update_id,
    createdAt: r.created_at,
    messageCount: r.message_count,
    mediaCount: r.media_count,
    bookmarkedCount: r.bookmarked_count,
    lastMessageText: r.last_message_text,
    lastMessageDate: r.last_message_date,
    lastMessageSender: r.last_message_sender,
  }));
}

export function getChatById(chatId: string): ChatSummary | null {
  const all = listChats();
  return all.find((c) => c.id === chatId) ?? null;
}

export interface MessageQueryOptions {
  chatId: string;
  filter?: 'all' | 'media' | 'files' | 'links' | 'pinned' | 'bookmarked';
  query?: string;
  limit?: number;
  offset?: number;
}

export function queryChatMessages(opts: MessageQueryOptions): { messages: ArchivedMessage[]; total: number } {
  const conditions: string[] = ['m.chat_id = ?'];
  const params: Array<string | number> = [opts.chatId];

  if (opts.filter === 'media') {
    conditions.push(`m.media_type IN ('photo', 'video')`);
  } else if (opts.filter === 'files') {
    conditions.push(`m.media_type IN ('document', 'audio', 'voice')`);
  } else if (opts.filter === 'links') {
    conditions.push(`(m.text LIKE '%http://%' OR m.text LIKE '%https://%' OR m.entities_json LIKE '%text_link%')`);
  } else if (opts.filter === 'pinned') {
    conditions.push(`m.is_pinned = 1`);
  } else if (opts.filter === 'bookmarked') {
    conditions.push(`m.is_bookmarked = 1`);
  }

  if (opts.query && opts.query.trim().length > 0) {
    const q = `%${opts.query.trim()}%`;
    conditions.push(`(m.text LIKE ? OR m.sender_name LIKE ? OR COALESCE(m.media_name, '') LIKE ?)`);
    params.push(q, q, q);
  }

  const whereClause = conditions.join(' AND ');
  const countRow = db
    .prepare(`SELECT COUNT(*) AS total FROM messages m WHERE ${whereClause}`)
    .get(...params) as { total: number };

  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);

  const rows = db
    .prepare(
      `
      SELECT
        m.*,
        (
          (SELECT COUNT(*) FROM messages r WHERE r.chat_id = m.chat_id AND r.reply_to_tg_id = m.tg_message_id) +
          (SELECT COUNT(*) FROM comments cm WHERE cm.chat_id = m.chat_id AND cm.target_tg_message_id = m.tg_message_id)
        ) AS reply_count
      FROM messages m
      WHERE ${whereClause}
      ORDER BY m.date_iso ASC, m.tg_message_id ASC
      LIMIT ? OFFSET ?
    `
    )
    .all(...params, limit, offset) as RawMessageRow[];

  return {
    messages: rows.map(mapMessageRow),
    total: countRow.total,
  };
}

export function getThreadMessages(
  chatId: string,
  tgMessageId: number
): { root: ArchivedMessage | null; replies: ArchivedMessage[]; comments: MessageComment[] } {
  const rootRow = db
    .prepare(
      `
      SELECT
        m.*,
        (
          (SELECT COUNT(*) FROM messages r WHERE r.chat_id = m.chat_id AND r.reply_to_tg_id = m.tg_message_id) +
          (SELECT COUNT(*) FROM comments cm WHERE cm.chat_id = m.chat_id AND cm.target_tg_message_id = m.tg_message_id)
        ) AS reply_count
      FROM messages m
      WHERE m.chat_id = ? AND m.tg_message_id = ?
    `
    )
    .get(chatId, tgMessageId) as RawMessageRow | undefined;

  if (!rootRow) {
    return { root: null, replies: [], comments: [] };
  }

  const replyRows = db
    .prepare(
      `
      SELECT
        m.*,
        (
          (SELECT COUNT(*) FROM messages r WHERE r.chat_id = m.chat_id AND r.reply_to_tg_id = m.tg_message_id) +
          (SELECT COUNT(*) FROM comments cm WHERE cm.chat_id = m.chat_id AND cm.target_tg_message_id = m.tg_message_id)
        ) AS reply_count
      FROM messages m
      WHERE m.chat_id = ? AND m.reply_to_tg_id = ?
      ORDER BY m.date_iso ASC, m.tg_message_id ASC
    `
    )
    .all(chatId, tgMessageId) as RawMessageRow[];

  const commentRows = db
    .prepare(
      `
      SELECT id, chat_id, target_tg_message_id, author_name, body, source, created_at,
             media_type, media_url, media_name, media_size, media_mime
      FROM comments
      WHERE chat_id = ? AND target_tg_message_id = ?
      ORDER BY created_at ASC, id ASC
    `
    )
    .all(chatId, tgMessageId) as Array<{
    id: number;
    chat_id: string;
    target_tg_message_id: number;
    author_name: string;
    body: string;
    source: 'mirrored' | 'local';
    created_at: string;
    media_type: MediaType;
    media_url: string | null;
    media_name: string | null;
    media_size: number | null;
    media_mime: string | null;
  }>;

  return {
    root: mapMessageRow(rootRow),
    replies: replyRows.map(mapMessageRow),
    comments: commentRows.map((c) => ({
      id: c.id,
      chatId: c.chat_id,
      targetTgMessageId: c.target_tg_message_id,
      authorName: c.author_name,
      body: c.body,
      source: c.source,
      createdAt: c.created_at,
      mediaType: c.media_type ?? 'none',
      mediaUrl: c.media_url ?? null,
      mediaName: c.media_name ?? null,
      mediaSize: c.media_size ?? null,
      mediaMime: c.media_mime ?? null,
    })),
  };
}

export function upsertMirroredCommentsBatch(
  items: Array<{
    chatId: string;
    targetTgMessageId: number;
    authorName: string;
    body: string;
    createdAt: string;
    mediaType?: MediaType;
    mediaUrl?: string | null;
    mediaName?: string | null;
    mediaSize?: number | null;
    mediaMime?: string | null;
  }>
): void {
  if (items.length === 0) return;
  const checkStmt = db.prepare(
    `SELECT id FROM comments WHERE chat_id = ? AND target_tg_message_id = ? AND author_name = ? AND body = ? AND created_at = ?`
  );
  const insertStmt = db.prepare(
    `INSERT INTO comments (
      chat_id, target_tg_message_id, author_name, body, source, created_at,
      media_type, media_url, media_name, media_size, media_mime
    ) VALUES (?, ?, ?, ?, 'mirrored', ?, ?, ?, ?, ?, ?)`
  );
  const runTx = db.transaction((batch: typeof items) => {
    for (const c of batch) {
      const exists = checkStmt.get(c.chatId, c.targetTgMessageId, c.authorName, c.body, c.createdAt);
      if (!exists) {
        insertStmt.run(
          c.chatId,
          c.targetTgMessageId,
          c.authorName,
          c.body,
          c.createdAt,
          c.mediaType ?? 'none',
          c.mediaUrl ?? null,
          c.mediaName ?? null,
          c.mediaSize ?? null,
          c.mediaMime ?? null
        );
      }
    }
  });
  runTx(items);
}

export function listCommentsForChat(chatId: string): MessageComment[] {
  const rows = db
    .prepare(
      `
      SELECT id, chat_id, target_tg_message_id, author_name, body, source, created_at,
             media_type, media_url, media_name, media_size, media_mime
      FROM comments
      WHERE chat_id = ?
      ORDER BY created_at ASC, id ASC
    `
    )
    .all(chatId) as Array<{
    id: number;
    chat_id: string;
    target_tg_message_id: number;
    author_name: string;
    body: string;
    source: 'mirrored' | 'local';
    created_at: string;
    media_type: MediaType;
    media_url: string | null;
    media_name: string | null;
    media_size: number | null;
    media_mime: string | null;
  }>;

  return rows.map((c) => ({
    id: c.id,
    chatId: c.chat_id,
    targetTgMessageId: c.target_tg_message_id,
    authorName: c.author_name,
    body: c.body,
    source: c.source,
    createdAt: c.created_at,
    mediaType: c.media_type ?? 'none',
    mediaUrl: c.media_url ?? null,
    mediaName: c.media_name ?? null,
    mediaSize: c.media_size ?? null,
    mediaMime: c.media_mime ?? null,
  }));
}

function seedSampleCommentsIfEmpty(): void {
  const countRow = db.prepare('SELECT COUNT(*) AS count FROM comments').get() as { count: number };
  const hasFieldNotes = db.prepare('SELECT id FROM chats WHERE id = ?').get('archive_urban_fieldnotes');
  const hasLocalFirst = db.prepare('SELECT id FROM chats WHERE id = ?').get('archive_local_first');
  const stmt = db.prepare(
    `INSERT INTO comments (
      chat_id, target_tg_message_id, author_name, body, source, created_at,
      media_type, media_url, media_name, media_size, media_mime
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  if (countRow.count === 0) {
    if (hasFieldNotes) {
      stmt.run(
        'archive_urban_fieldnotes',
        2002,
        'Henrik Lindqvist',
        'The daylighting across platforms 1–8 looks remarkably even here. Was this captured before the 07:30 commuter peak?',
        'mirrored',
        '2026-11-22T08:12:00Z',
        'none',
        null,
        null,
        null,
        null
      );
      stmt.run(
        'archive_urban_fieldnotes',
        2002,
        'Sora Takahashi',
        'Love how the departure board remains legible without glare against the clerestory glass. Attached the lux meter readings from the west mezzanine.',
        'mirrored',
        '2026-11-22T09:04:00Z',
        'document',
        null,
        'concourse_lux_readings.csv',
        42810,
        'text/csv'
      );
    }

    if (hasLocalFirst) {
      stmt.run(
        'archive_local_first',
        3001,
        'Devon Park',
        'Paired this setup with nightly rsync snapshots to a home NAS—here is our node storage topology diagram for reference.',
        'mirrored',
        '2026-11-19T15:22:00Z',
        'photo',
        '/src/assets/images/media_server_topology_1795584897820.jpg',
        'nas_mirror_topology.jpg',
        482310,
        'image/jpeg'
      );
    }
  } else if (hasLocalFirst) {
    // Ensure existing seeded DBs also show a mirrored media comment example on post #3001
    const mediaCommentExists = db
      .prepare(`SELECT id FROM comments WHERE chat_id = ? AND target_tg_message_id = ? AND media_type != 'none'`)
      .get('archive_local_first', 3001);
    if (!mediaCommentExists) {
      stmt.run(
        'archive_local_first',
        3001,
        'Nadia Morales',
        'Attached our local-first mirror storage topology diagram used for offline backups.',
        'mirrored',
        '2026-11-19T16:40:00Z',
        'photo',
        '/src/assets/images/media_server_topology_1795584897820.jpg',
        'nas_mirror_topology.jpg',
        482310,
        'image/jpeg'
      );
    }
  }
}

function buildSafeFtsQuery(rawQuery: string): string | null {
  const tokens = rawQuery
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_@.#-]/gu, ''))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '')}"*`).join(' ');
}

export function searchMessagesFts(opts: { query: string; chatId?: string; mediaType?: string; limit?: number }): SearchHit[] {
  const ftsQuery = buildSafeFtsQuery(opts.query);
  if (!ftsQuery) return [];

  const conditions: string[] = ['messages_fts MATCH ?'];
  const params: Array<string | number> = [ftsQuery];

  if (opts.chatId && opts.chatId !== 'all') {
    conditions.push('m.chat_id = ?');
    params.push(opts.chatId);
  }
  if (opts.mediaType && opts.mediaType !== 'all') {
    conditions.push('m.media_type = ?');
    params.push(opts.mediaType);
  }

  const limit = Math.min(Math.max(opts.limit ?? 80, 1), 200);
  const rows = db
    .prepare(
      `
      SELECT
        m.id,
        m.chat_id,
        c.title AS chat_title,
        c.chat_type,
        m.tg_message_id,
        m.sender_name,
        m.date_iso,
        m.text,
        m.media_type,
        m.media_name,
        snippet(messages_fts, 0, '[', ']', '...', 24) AS snippet
      FROM messages_fts
      JOIN messages m ON m.id = messages_fts.rowid
      JOIN chats c ON c.id = m.chat_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY rank, m.date_iso DESC
      LIMIT ?
    `
    )
    .all(...params, limit) as Array<{
    id: number;
    chat_id: string;
    chat_title: string;
    chat_type: ChatType;
    tg_message_id: number;
    sender_name: string;
    date_iso: string;
    text: string;
    media_type: MediaType;
    media_name: string | null;
    snippet: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    chatId: r.chat_id,
    chatTitle: r.chat_title,
    chatType: r.chat_type,
    tgMessageId: r.tg_message_id,
    senderName: r.sender_name,
    dateIso: r.date_iso,
    text: r.text,
    mediaType: r.media_type,
    mediaName: r.media_name,
    snippet: r.snippet || r.text.slice(0, 140),
  }));
}

export function listMediaVault(opts: { chatId?: string; kind?: 'all' | 'photo' | 'document' | 'links' }): MediaVaultItem[] {
  const conditions: string[] = [];
  const params: Array<string> = [];

  if (opts.chatId && opts.chatId !== 'all') {
    conditions.push('m.chat_id = ?');
    params.push(opts.chatId);
  }

  if (opts.kind === 'photo') {
    conditions.push(`m.media_type IN ('photo', 'video')`);
  } else if (opts.kind === 'document') {
    conditions.push(`m.media_type IN ('document', 'audio', 'voice')`);
  } else if (opts.kind === 'links') {
    conditions.push(`(m.text LIKE '%http://%' OR m.text LIKE '%https://%' OR m.entities_json LIKE '%text_link%')`);
  } else {
    conditions.push(`(m.media_type != 'none' OR m.text LIKE '%http://%' OR m.text LIKE '%https://%' OR m.entities_json LIKE '%text_link%')`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `
      SELECT
        m.id,
        m.chat_id,
        c.title AS chat_title,
        m.tg_message_id,
        m.sender_name,
        m.date_iso,
        m.text,
        m.entities_json,
        m.media_type,
        m.media_url,
        m.media_name,
        m.media_size,
        m.media_mime
      FROM messages m
      JOIN chats c ON c.id = m.chat_id
      ${whereClause}
      ORDER BY m.date_iso DESC
      LIMIT 300
    `
    )
    .all(...params) as Array<{
    id: number;
    chat_id: string;
    chat_title: string;
    tg_message_id: number;
    sender_name: string;
    date_iso: string;
    text: string;
    entities_json: string;
    media_type: MediaType;
    media_url: string | null;
    media_name: string | null;
    media_size: number | null;
    media_mime: string | null;
  }>;

  const urlRegex = /https?:\/\/[^\s<>"')\]]+/gi;

  return rows.map((r) => {
    const entities = safeJsonParse<TextEntity[]>(r.entities_json, []);
    const found = new Set<string>();
    for (const match of r.text.match(urlRegex) ?? []) {
      found.add(match);
    }
    for (const ent of entities) {
      if (ent.href && /^https?:\/\//i.test(ent.href)) {
        found.add(ent.href);
      }
    }
    return {
      id: r.id,
      chatId: r.chat_id,
      chatTitle: r.chat_title,
      tgMessageId: r.tg_message_id,
      senderName: r.sender_name,
      dateIso: r.date_iso,
      text: r.text,
      mediaType: r.media_type,
      mediaUrl: r.media_url,
      mediaName: r.media_name,
      mediaSize: r.media_size,
      mediaMime: r.media_mime,
      extractedUrls: Array.from(found),
    };
  });
}

export function toggleMessageBookmark(messageId: number): { id: number; isBookmarked: boolean } | null {
  const existing = db.prepare('SELECT id, is_bookmarked FROM messages WHERE id = ?').get(messageId) as
    | { id: number; is_bookmarked: number }
    | undefined;
  if (!existing) return null;
  const next = existing.is_bookmarked ? 0 : 1;
  db.prepare('UPDATE messages SET is_bookmarked = ? WHERE id = ?').run(next, messageId);
  return { id: messageId, isBookmarked: Boolean(next) };
}

export function deleteChatAndMedia(chatId: string): boolean {
  const result = db.prepare('DELETE FROM chats WHERE id = ?').run(chatId);
  if (result.changes > 0) {
    const safeFolderName = chatId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const targetDir = path.resolve(MEDIA_ROOT_DIR, safeFolderName);
    if (targetDir.startsWith(MEDIA_ROOT_DIR + path.sep) && fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    return true;
  }
  return false;
}

export function upsertChat(input: {
  id: string;
  title: string;
  username?: string | null;
  chatType: ChatType;
  description?: string | null;
  avatarUrl?: string | null;
  memberCount?: number;
  pinnedMessageId?: number | null;
  syncMode: SyncMode;
  syncStatus: SyncStatus;
  lastSyncedAt?: string | null;
  lastUpdateId?: number;
}): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO chats (
      id, title, username, chat_type, description, avatar_url,
      member_count, pinned_message_id, sync_mode, sync_status,
      last_synced_at, last_update_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      username = COALESCE(excluded.username, chats.username),
      chat_type = excluded.chat_type,
      description = COALESCE(excluded.description, chats.description),
      avatar_url = COALESCE(excluded.avatar_url, chats.avatar_url),
      member_count = CASE WHEN excluded.member_count > 0 THEN excluded.member_count ELSE chats.member_count END,
      pinned_message_id = COALESCE(excluded.pinned_message_id, chats.pinned_message_id),
      sync_mode = excluded.sync_mode,
      sync_status = excluded.sync_status,
      last_synced_at = COALESCE(excluded.last_synced_at, chats.last_synced_at),
      last_update_id = MAX(chats.last_update_id, excluded.last_update_id)
  `).run(
    input.id,
    input.title,
    input.username ?? null,
    input.chatType,
    input.description ?? null,
    input.avatarUrl ?? null,
    input.memberCount ?? 0,
    input.pinnedMessageId ?? null,
    input.syncMode,
    input.syncStatus,
    input.lastSyncedAt ?? now,
    input.lastUpdateId ?? 0,
    now
  );
}

export interface InsertMessageInput {
  chatId: string;
  tgMessageId: number;
  senderName: string;
  senderUsername?: string | null;
  senderRole?: string | null;
  dateIso: string;
  text: string;
  entities?: TextEntity[];
  replyToTgId?: number | null;
  replyPreviewSender?: string | null;
  replyPreviewText?: string | null;
  forwardFrom?: string | null;
  mediaType?: MediaType;
  mediaUrl?: string | null;
  mediaName?: string | null;
  mediaSize?: number | null;
  mediaMime?: string | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  views?: number;
  reactions?: MessageReaction[];
  isPinned?: boolean;
  isBookmarked?: boolean;
}

export function upsertMessagesBatch(items: InsertMessageInput[]): number {
  const stmt = db.prepare(`
    INSERT INTO messages (
      chat_id, tg_message_id, sender_name, sender_username, sender_role,
      date_iso, text, entities_json, reply_to_tg_id, reply_preview_sender,
      reply_preview_text, forward_from, media_type, media_url, media_name,
      media_size, media_mime, media_width, media_height, views,
      reactions_json, is_pinned, is_bookmarked
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id, tg_message_id) DO UPDATE SET
      text = excluded.text,
      entities_json = excluded.entities_json,
      media_type = CASE WHEN excluded.media_type != 'none' THEN excluded.media_type ELSE messages.media_type END,
      media_url = COALESCE(excluded.media_url, messages.media_url),
      media_name = COALESCE(excluded.media_name, messages.media_name),
      media_size = COALESCE(excluded.media_size, messages.media_size),
      media_mime = COALESCE(excluded.media_mime, messages.media_mime),
      views = MAX(messages.views, excluded.views),
      reactions_json = CASE WHEN excluded.reactions_json != '[]' THEN excluded.reactions_json ELSE messages.reactions_json END,
      is_pinned = MAX(messages.is_pinned, excluded.is_pinned)
  `);

  let insertedOrUpdated = 0;
  const runTx = db.transaction((batch: InsertMessageInput[]) => {
    for (const msg of batch) {
      stmt.run(
        msg.chatId,
        msg.tgMessageId,
        msg.senderName,
        msg.senderUsername ?? null,
        msg.senderRole ?? null,
        msg.dateIso,
        msg.text,
        JSON.stringify(msg.entities ?? []),
        msg.replyToTgId ?? null,
        msg.replyPreviewSender ?? null,
        msg.replyPreviewText ?? null,
        msg.forwardFrom ?? null,
        msg.mediaType ?? 'none',
        msg.mediaUrl ?? null,
        msg.mediaName ?? null,
        msg.mediaSize ?? null,
        msg.mediaMime ?? null,
        msg.mediaWidth ?? null,
        msg.mediaHeight ?? null,
        msg.views ?? 0,
        JSON.stringify(msg.reactions ?? []),
        msg.isPinned ? 1 : 0,
        msg.isBookmarked ? 1 : 0
      );
      insertedOrUpdated += 1;
    }
  });

  runTx(items);
  return insertedOrUpdated;
}

export function addSyncLog(entry: {
  chatId?: string | null;
  source: 'bot_api' | 'json_import' | 'archive_export';
  status: 'success' | 'warning' | 'error';
  messagesAdded?: number;
  mediaDownloaded?: number;
  detail: string;
}): void {
  db.prepare(`
    INSERT INTO sync_logs (chat_id, source, status, messages_added, media_downloaded, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.chatId ?? null,
    entry.source,
    entry.status,
    entry.messagesAdded ?? 0,
    entry.mediaDownloaded ?? 0,
    entry.detail,
    new Date().toISOString()
  );
}

export function listSyncLogs(limit = 30): SyncLogEntry[] {
  const rows = db
    .prepare(
      `
      SELECT l.*, c.title AS chat_title
      FROM sync_logs l
      LEFT JOIN chats c ON c.id = l.chat_id
      ORDER BY l.id DESC
      LIMIT ?
    `
    )
    .all(limit) as Array<{
    id: number;
    chat_id: string | null;
    chat_title: string | null;
    source: 'bot_api' | 'json_import' | 'archive_export';
    status: 'success' | 'warning' | 'error';
    messages_added: number;
    media_downloaded: number;
    detail: string;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    chatId: r.chat_id,
    chatTitle: r.chat_title,
    source: r.source,
    status: r.status,
    messagesAdded: r.messages_added,
    mediaDownloaded: r.media_downloaded,
    detail: r.detail,
    createdAt: r.created_at,
  }));
}

export function getArchiveStats(): ArchiveStats {
  const counts = db
    .prepare(
      `
      SELECT
        (SELECT COUNT(*) FROM chats) AS total_chats,
        (SELECT COUNT(*) FROM messages) AS total_messages,
        (SELECT COUNT(*) FROM messages WHERE media_type != 'none') AS total_media,
        (SELECT COUNT(*) FROM messages WHERE is_bookmarked = 1) AS total_bookmarks
    `
    )
    .get() as {
    total_chats: number;
    total_messages: number;
    total_media: number;
    total_bookmarks: number;
  };

  let dbSize = 0;
  try {
    dbSize = fs.statSync(DB_PATH).size;
  } catch {
    dbSize = 0;
  }

  return {
    totalChats: counts.total_chats,
    totalMessages: counts.total_messages,
    totalMediaFiles: counts.total_media,
    totalBookmarks: counts.total_bookmarks,
    storageBytes: dbSize,
  };
}

export function seedInitialOfflineArchives(): void {
  const systemsChatId = 'archive_systems_eng';
  const fieldNotesChatId = 'archive_urban_fieldnotes';
  const localFirstChatId = 'archive_local_first';

  upsertChat({
    id: systemsChatId,
    title: 'Distributed Systems Engineering',
    username: 'dist_sys_arch',
    chatType: 'supergroup',
    description:
      'Technical archive of storage engine benchmarks, Raft consensus postmortems, and zero-downtime replication patterns.',
    avatarUrl: '/src/assets/images/channel_avatar_systems_1795584895651.jpg',
    memberCount: 1428,
    pinnedMessageId: 1002,
    syncMode: 'export',
    syncStatus: 'synced',
    lastSyncedAt: '2026-11-24T19:40:00Z',
  });

  upsertChat({
    id: fieldNotesChatId,
    title: 'Urban Transit & Field Notes',
    username: 'transit_fieldnotes',
    chatType: 'channel',
    description:
      'Long-form architectural dispatches, station concourse photography, and timetable topology studies archived for offline reading.',
    avatarUrl: '/src/assets/images/channel_avatar_fieldnotes_1795584896865.jpg',
    memberCount: 8940,
    pinnedMessageId: 2001,
    syncMode: 'export',
    syncStatus: 'synced',
    lastSyncedAt: '2026-11-24T18:15:00Z',
  });

  upsertChat({
    id: localFirstChatId,
    title: 'Local-First Software Digest',
    username: 'localfirst_digest',
    chatType: 'channel',
    description:
      'Curated notes on SQLite WAL durability, CRDT sync engines, and offline-capable web clients.',
    avatarUrl: null,
    memberCount: 4120,
    pinnedMessageId: 3001,
    syncMode: 'export',
    syncStatus: 'synced',
    lastSyncedAt: '2026-11-23T22:10:00Z',
  });

  upsertMessagesBatch([
    // Group 1: Distributed Systems Engineering
    {
      chatId: systemsChatId,
      tgMessageId: 1001,
      senderName: 'Elena Vance',
      senderUsername: 'evance',
      senderRole: 'Admin',
      dateIso: '2026-11-21T09:14:00Z',
      text: 'Morning everyone. I finished mirroring the storage rack topology diagram from our cold-standby testbed. Notice how the management switch sits on an isolated VLAN away from the 40GbE replication fabric.',
      entities: [
        {
          type: 'plain',
          text: 'Morning everyone. I finished mirroring the storage rack topology diagram from our cold-standby testbed. Notice how the management switch sits on an isolated VLAN away from the 40GbE replication fabric.',
        },
      ],
      mediaType: 'photo',
      mediaUrl: '/src/assets/images/media_server_topology_1795584897820.jpg',
      mediaName: 'node_topology_rev4.jpg',
      mediaSize: 482310,
      mediaMime: 'image/jpeg',
      reactions: [
        { emoji: '👍', count: 14 },
        { emoji: '🔥', count: 5 },
      ],
      isBookmarked: true,
    },
    {
      chatId: systemsChatId,
      tgMessageId: 1002,
      senderName: 'Marcus Chen',
      senderUsername: 'mchen_io',
      senderRole: 'Admin',
      dateIso: '2026-11-21T09:28:00Z',
      text: 'Pinned benchmark checklist for WAL checkpoint tuning under sustained write load:\n\nPRAGMA journal_mode = WAL;\nPRAGMA synchronous = NORMAL;\nPRAGMA wal_autocheckpoint = 2000;\n\nFull runbook is attached as a PDF for offline reference.',
      entities: [
        { type: 'bold', text: 'Pinned benchmark checklist' },
        { type: 'plain', text: ' for WAL checkpoint tuning under sustained write load:\n\n' },
        {
          type: 'pre',
          text: 'PRAGMA journal_mode = WAL;\nPRAGMA synchronous = NORMAL;\nPRAGMA wal_autocheckpoint = 2000;',
          language: 'sql',
        },
        { type: 'plain', text: '\n\nFull runbook is attached as a PDF for offline reference.' },
      ],
      mediaType: 'document',
      mediaName: 'sqlite_wal_checkpoint_runbook_v3.pdf',
      mediaSize: 1842900,
      mediaMime: 'application/pdf',
      reactions: [
        { emoji: '📌', count: 9 },
        { emoji: '🙏', count: 12 },
      ],
      isPinned: true,
      isBookmarked: true,
    },
    {
      chatId: systemsChatId,
      tgMessageId: 1003,
      senderName: 'Priya Nair',
      senderUsername: 'pnair',
      senderRole: 'Member',
      dateIso: '2026-11-21T10:05:00Z',
      text: 'Quick question on the secondary node layout in that schematic — are you terminating TLS at the core switch or per storage rack?',
      entities: [
        {
          type: 'plain',
          text: 'Quick question on the secondary node layout in that schematic — are you terminating TLS at the core switch or per storage rack?',
        },
      ],
      replyToTgId: 1001,
      replyPreviewSender: 'Elena Vance',
      replyPreviewText: 'Morning everyone. I finished mirroring the storage rack topology diagram from our cold-standby testbed...',
      reactions: [{ emoji: '👀', count: 3 }],
    },
    {
      chatId: systemsChatId,
      tgMessageId: 1004,
      senderName: 'Elena Vance',
      senderUsername: 'evance',
      senderRole: 'Admin',
      dateIso: '2026-11-21T10:19:00Z',
      text: 'Per storage rack via WireGuard kernel interfaces. Keeps MTU overhead predictable at 1420 bytes and avoids a single TLS termination bottleneck during snapshot resyncs.',
      entities: [
        {
          type: 'plain',
          text: 'Per storage rack via WireGuard kernel interfaces. Keeps MTU overhead predictable at 1420 bytes and avoids a single TLS termination bottleneck during snapshot resyncs.',
        },
      ],
      replyToTgId: 1001,
      replyPreviewSender: 'Elena Vance',
      replyPreviewText: 'Morning everyone. I finished mirroring the storage rack topology diagram...',
      reactions: [{ emoji: '💯', count: 7 }],
    },
    {
      chatId: systemsChatId,
      tgMessageId: 1005,
      senderName: 'Jonas Weber',
      senderUsername: 'jweber',
      senderRole: 'Member',
      dateIso: '2026-11-22T14:42:00Z',
      text: 'Shared our Raft log compaction trace from yesterday. Compressing snapshots with zstd level 3 reduced WAN replication traffic by 68% with negligible CPU overhead. Notes here: https://raft.github.io',
      entities: [
        {
          type: 'plain',
          text: 'Shared our Raft log compaction trace from yesterday. Compressing snapshots with zstd level 3 reduced WAN replication traffic by 68% with negligible CPU overhead. Notes here: ',
        },
        { type: 'url', text: 'https://raft.github.io', href: 'https://raft.github.io' },
      ],
      mediaType: 'document',
      mediaName: 'raft_compaction_trace_nov22.csv',
      mediaSize: 648120,
      mediaMime: 'text/csv',
      reactions: [{ emoji: '⚡', count: 11 }],
    },
    {
      chatId: systemsChatId,
      tgMessageId: 1006,
      senderName: 'Tomasz Kowalski',
      senderUsername: 'tkowalski',
      senderRole: 'Member',
      dateIso: '2026-11-23T16:11:00Z',
      text: 'Does anyone have the exact fts5 unicode61 tokenizer flags we used to support hyphenated identifiers without breaking prefix search?',
      entities: [
        {
          type: 'plain',
          text: 'Does anyone have the exact ',
        },
        { type: 'code', text: 'fts5 unicode61' },
        {
          type: 'plain',
          text: ' tokenizer flags we used to support hyphenated identifiers without breaking prefix search?',
        },
      ],
    },
    {
      chatId: systemsChatId,
      tgMessageId: 1007,
      senderName: 'Marcus Chen',
      senderUsername: 'mchen_io',
      senderRole: 'Admin',
      dateIso: '2026-11-23T16:24:00Z',
      text: "Use tokenchars '-_' inside the tokenizer definition, or sanitize punctuation to spaces before wrapping each query token in double quotes with a trailing asterisk.",
      entities: [
        { type: 'plain', text: 'Use ' },
        { type: 'code', text: "tokenchars '-_'" },
        {
          type: 'plain',
          text: ' inside the tokenizer definition, or sanitize punctuation to spaces before wrapping each query token in double quotes with a trailing asterisk.',
        },
      ],
      replyToTgId: 1006,
      replyPreviewSender: 'Tomasz Kowalski',
      replyPreviewText: 'Does anyone have the exact fts5 unicode61 tokenizer flags...',
      reactions: [{ emoji: '👍', count: 6 }],
    },
    {
      chatId: systemsChatId,
      tgMessageId: 1008,
      senderName: 'Elena Vance',
      senderUsername: 'evance',
      senderRole: 'Admin',
      dateIso: '2026-11-24T11:05:00Z',
      text: 'Weekly archive verified: 100% checksum match across primary and backup object buckets. #storage #postmortem',
      entities: [
        {
          type: 'plain',
          text: 'Weekly archive verified: 100% checksum match across primary and backup object buckets. ',
        },
        { type: 'hashtag', text: '#storage' },
        { type: 'plain', text: ' ' },
        { type: 'hashtag', text: '#postmortem' },
      ],
      reactions: [{ emoji: '✅', count: 16 }],
    },

    // Channel 2: Urban Transit & Field Notes
    {
      chatId: fieldNotesChatId,
      tgMessageId: 2001,
      senderName: 'Urban Transit & Field Notes',
      senderUsername: 'transit_fieldnotes',
      senderRole: 'Channel',
      dateIso: '2026-11-20T08:00:00Z',
      text: 'Pinned Index — Autumn Rail Architecture Series\n\nThis channel archives high-resolution concourse studies, signaling diagrams, and European regional timetable maps. Every dispatch is formatted for offline tablet & desktop reading.',
      entities: [
        { type: 'bold', text: 'Pinned Index — Autumn Rail Architecture Series' },
        {
          type: 'plain',
          text: '\n\nThis channel archives high-resolution concourse studies, signaling diagrams, and European regional timetable maps. Every dispatch is formatted for offline tablet & desktop reading.',
        },
      ],
      views: 6420,
      reactions: [{ emoji: '🚆', count: 128 }],
      isPinned: true,
    },
    {
      chatId: fieldNotesChatId,
      tgMessageId: 2002,
      senderName: 'Urban Transit & Field Notes',
      senderUsername: 'transit_fieldnotes',
      senderRole: 'Channel',
      dateIso: '2026-11-22T07:45:00Z',
      text: 'Morning departure concourse at 07:18. Notice how the cantilevered steel truss spans Platforms 1–8 without intermediate columns, preserving clear sightlines from the west mezzanine to the departure board.',
      entities: [
        {
          type: 'plain',
          text: 'Morning departure concourse at 07:18. Notice how the cantilevered steel truss spans Platforms 1–8 without intermediate columns, preserving clear sightlines from the west mezzanine to the departure board.',
        },
      ],
      mediaType: 'photo',
      mediaUrl: '/src/assets/images/media_transit_concourse_1795584897775.jpg',
      mediaName: 'concourse_morning_35mm.jpg',
      mediaSize: 1294000,
      mediaMime: 'image/jpeg',
      views: 7810,
      reactions: [
        { emoji: '📸', count: 214 },
        { emoji: '❤️', count: 92 },
      ],
      isBookmarked: true,
    },
    {
      chatId: fieldNotesChatId,
      tgMessageId: 2003,
      senderName: 'Urban Transit & Field Notes',
      senderUsername: 'transit_fieldnotes',
      senderRole: 'Channel',
      dateIso: '2026-11-24T17:30:00Z',
      text: 'Attached is the open-data GTFS-RT station headway workbook we used to measure peak-hour platform dwell times across 14 regional hubs. Reference specification: https://gtfs.org/realtime/',
      entities: [
        {
          type: 'plain',
          text: 'Attached is the open-data GTFS-RT station headway workbook we used to measure peak-hour platform dwell times across 14 regional hubs. Reference specification: ',
        },
        { type: 'url', text: 'https://gtfs.org/realtime/', href: 'https://gtfs.org/realtime/' },
      ],
      mediaType: 'document',
      mediaName: 'regional_headway_study_2026.xlsx',
      mediaSize: 912450,
      mediaMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      views: 5390,
      reactions: [{ emoji: '📊', count: 74 }],
    },

    // Channel 3: Local-First Software Digest
    {
      chatId: localFirstChatId,
      tgMessageId: 3001,
      senderName: 'Local-First Software Digest',
      senderUsername: 'localfirst_digest',
      senderRole: 'Channel',
      dateIso: '2026-11-19T13:00:00Z',
      text: 'Why Local Mirroring Matters\n\nCloud-only messaging platforms lock years of community knowledge behind ephemeral scrollbars and online-only search. Exporting your Telegram groups into a structured local SQLite + FTS5 vault guarantees permanent, instant access even on an air-gapped flight.',
      entities: [
        { type: 'bold', text: 'Why Local Mirroring Matters' },
        {
          type: 'plain',
          text: '\n\nCloud-only messaging platforms lock years of community knowledge behind ephemeral scrollbars and online-only search. Exporting your Telegram groups into a structured local SQLite + FTS5 vault guarantees permanent, instant access even on an air-gapped flight.',
        },
      ],
      views: 3120,
      reactions: [{ emoji: '💾', count: 84 }],
      isPinned: true,
      isBookmarked: true,
    },
    {
      chatId: localFirstChatId,
      tgMessageId: 3002,
      senderName: 'Local-First Software Digest',
      senderUsername: 'localfirst_digest',
      senderRole: 'Channel',
      dateIso: '2026-11-23T21:40:00Z',
      text: 'Tip: In Telegram Desktop, open any group or channel menu -> Export Chat History -> select JSON format (result.json) to generate a complete portable archive you can ingest directly into TeleVault. #telegram #archiving',
      entities: [
        { type: 'plain', text: 'Tip: In Telegram Desktop, open any group or channel menu -> ' },
        { type: 'bold', text: 'Export Chat History' },
        { type: 'plain', text: ' -> select ' },
        { type: 'code', text: 'JSON' },
        { type: 'plain', text: ' format (' },
        { type: 'code', text: 'result.json' },
        { type: 'plain', text: ') to generate a complete portable archive you can ingest directly into TeleVault. ' },
        { type: 'hashtag', text: '#telegram' },
        { type: 'plain', text: ' ' },
        { type: 'hashtag', text: '#archiving' },
      ],
      views: 2890,
      reactions: [{ emoji: '🔥', count: 61 }],
    },
  ]);

  addSyncLog({
    chatId: systemsChatId,
    source: 'json_import',
    status: 'success',
    messagesAdded: 8,
    mediaDownloaded: 3,
    detail: 'Initialized offline mirror from bundled Distributed Systems archive',
  });
  addSyncLog({
    chatId: fieldNotesChatId,
    source: 'json_import',
    status: 'success',
    messagesAdded: 3,
    mediaDownloaded: 2,
    detail: 'Initialized offline mirror from bundled Urban Transit dispatch archive',
  });
}

import fs from 'fs';
import path from 'path';
import type { ChatType, MediaType, MessageReaction, TextEntity } from '../types.ts';
import {
  addSyncLog,
  type InsertMessageInput,
  MEDIA_ROOT_DIR,
  upsertChat,
  upsertMessagesBatch,
  upsertMirroredCommentsBatch,
} from './db.ts';

// Server-side in-memory bot token store (initialized from process.env if set).
// Never serialized to disk in plaintext and never returned unmasked to clients.
let activeBotToken: string | null = process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
let activeBotMeta: {
  source: 'env' | 'session' | 'none';
  username: string | null;
  name: string | null;
  lastOffset: number;
  autoDownloadMedia: boolean;
  lastSyncAt: string | null;
} = {
  source: activeBotToken ? 'env' : 'none',
  username: null,
  name: null,
  lastOffset: 0,
  autoDownloadMedia: true,
  lastSyncAt: null,
};

function maskToken(token: string | null): string | null {
  if (!token) return null;
  if (token.length <= 12) return '••••••••';
  return `${token.slice(0, 6)}••••••${token.slice(-4)}`;
}

export function getBotStatus() {
  return {
    connected: Boolean(activeBotToken),
    source: activeBotToken ? activeBotMeta.source : ('none' as const),
    botUsername: activeBotMeta.username,
    botName: activeBotMeta.name,
    maskedToken: maskToken(activeBotToken),
    autoDownloadMedia: activeBotMeta.autoDownloadMedia,
    lastOffset: activeBotMeta.lastOffset,
    lastSyncAt: activeBotMeta.lastSyncAt,
  };
}

export function disconnectBot(): void {
  activeBotToken = null;
  activeBotMeta = {
    source: 'none',
    username: null,
    name: null,
    lastOffset: 0,
    autoDownloadMedia: true,
    lastSyncAt: null,
  };
}

async function telegramApiCall<T>(token: string, method: string, params?: Record<string, string | number>): Promise<T> {
  const url = new URL(`https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), { method: 'GET' });
  const payload = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!res.ok || !payload.ok || payload.result === undefined) {
    throw new Error(payload.description || `Telegram API error (${res.status})`);
  }
  return payload.result;
}

export async function connectBotToken(tokenInput: string, autoDownloadMedia = true) {
  const cleaned = tokenInput.trim();
  if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(cleaned)) {
    throw new Error('Invalid Telegram Bot token format. Expected format like 123456789:AAH...');
  }

  const me = await telegramApiCall<{ id: number; is_bot: boolean; first_name: string; username?: string }>(
    cleaned,
    'getMe'
  );

  activeBotToken = cleaned;
  activeBotMeta = {
    source: 'session',
    username: me.username ?? null,
    name: me.first_name,
    lastOffset: 0,
    autoDownloadMedia,
    lastSyncAt: null,
  };

  addSyncLog({
    source: 'bot_api',
    status: 'success',
    detail: `Connected Telegram Bot @${me.username || me.first_name}`,
  });

  return getBotStatus();
}

export async function verifyEnvBotIfNeeded() {
  if (activeBotToken && !activeBotMeta.username) {
    try {
      const me = await telegramApiCall<{ first_name: string; username?: string }>(activeBotToken, 'getMe');
      activeBotMeta.username = me.username ?? null;
      activeBotMeta.name = me.first_name;
    } catch {
      // Leave unverified until user triggers sync or reconnects
    }
  }
}

interface TgPhotoSize {
  file_id: string;
  file_size?: number;
  width?: number;
  height?: number;
}

interface TgDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TgMessageEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
  language?: string;
}

interface TgMessage {
  message_id: number;
  date: number;
  chat: {
    id: number;
    type: string;
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  from?: {
    id: number;
    is_bot?: boolean;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  sender_chat?: {
    id: number;
    title?: string;
    username?: string;
  };
  text?: string;
  caption?: string;
  entities?: TgMessageEntity[];
  caption_entities?: TgMessageEntity[];
  reply_to_message?: TgMessage;
  forward_from_chat?: { title?: string };
  forward_sender_name?: string;
  photo?: TgPhotoSize[];
  document?: TgDocument;
  video?: TgDocument;
  audio?: TgDocument;
  voice?: TgDocument;
  poll?: { question: string; options: Array<{ text: string; voter_count: number }> };
  views?: number;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  channel_post?: TgMessage;
  edited_channel_post?: TgMessage;
}

function mapTgEntities(rawText: string, entities?: TgMessageEntity[]): TextEntity[] {
  if (!rawText) return [];
  if (!entities || entities.length === 0) {
    return [{ type: 'plain', text: rawText }];
  }

  const sorted = [...entities].sort((a, b) => a.offset - b.offset);
  const out: TextEntity[] = [];
  let cursor = 0;

  for (const ent of sorted) {
    if (ent.offset < cursor) continue;
    if (ent.offset > cursor) {
      out.push({ type: 'plain', text: rawText.slice(cursor, ent.offset) });
    }
    const slice = rawText.slice(ent.offset, ent.offset + ent.length);
    let mappedType: TextEntity['type'] = 'plain';
    let href: string | undefined;

    switch (ent.type) {
      case 'bold':
        mappedType = 'bold';
        break;
      case 'italic':
        mappedType = 'italic';
        break;
      case 'code':
        mappedType = 'code';
        break;
      case 'pre':
        mappedType = 'pre';
        break;
      case 'text_link':
        mappedType = 'text_link';
        href = ent.url;
        break;
      case 'url':
        mappedType = 'url';
        href = slice.startsWith('http') ? slice : `https://${slice}`;
        break;
      case 'mention':
        mappedType = 'mention';
        break;
      case 'hashtag':
        mappedType = 'hashtag';
        break;
      case 'strikethrough':
        mappedType = 'strikethrough';
        break;
      case 'underline':
        mappedType = 'underline';
        break;
      default:
        mappedType = 'plain';
    }

    out.push({ type: mappedType, text: slice, href, language: ent.language });
    cursor = ent.offset + ent.length;
  }

  if (cursor < rawText.length) {
    out.push({ type: 'plain', text: rawText.slice(cursor) });
  }

  return out;
}

async function downloadTelegramFile(token: string, chatId: string, fileId: string, preferredName: string): Promise<string | null> {
  try {
    const fileInfo = await telegramApiCall<{ file_path?: string; file_size?: number }>(token, 'getFile', {
      file_id: fileId,
    });
    if (!fileInfo.file_path) return null;
    if (fileInfo.file_size && fileInfo.file_size > 20 * 1024 * 1024) {
      return null; // Skip oversized binary files > 20MB
    }

    const downloadUrl = `https://api.telegram.org/file/bot${encodeURIComponent(token)}/${fileInfo.file_path}`;
    const response = await fetch(downloadUrl);
    if (!response.ok) return null;

    const arrayBuffer = await response.arrayBuffer();
    const safeChatDir = chatId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const chatMediaDir = path.resolve(MEDIA_ROOT_DIR, safeChatDir);
    if (!chatMediaDir.startsWith(MEDIA_ROOT_DIR + path.sep)) return null;
    if (!fs.existsSync(chatMediaDir)) {
      fs.mkdirSync(chatMediaDir, { recursive: true });
    }

    const ext = path.extname(fileInfo.file_path) || path.extname(preferredName) || '.bin';
    const base = path.basename(preferredName, path.extname(preferredName)).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'media';
    const filename = `${Date.now()}_${base}${ext}`;
    const destPath = path.resolve(chatMediaDir, filename);
    if (!destPath.startsWith(chatMediaDir + path.sep)) return null;

    fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
    return `/api/media-files/${encodeURIComponent(safeChatDir)}/${encodeURIComponent(filename)}`;
  } catch {
    return null;
  }
}

export async function syncBotUpdates(): Promise<{
  messagesAdded: number;
  mediaDownloaded: number;
  chatsUpdated: number;
}> {
  if (!activeBotToken) {
    throw new Error('No Telegram Bot token connected. Connect a bot token first.');
  }

  const updates = await telegramApiCall<TgUpdate[]>(activeBotToken, 'getUpdates', {
    offset: activeBotMeta.lastOffset,
    limit: 100,
    timeout: 0,
  });

  if (updates.length === 0) {
    activeBotMeta.lastSyncAt = new Date().toISOString();
    return { messagesAdded: 0, mediaDownloaded: 0, chatsUpdated: 0 };
  }

  let maxUpdateId = activeBotMeta.lastOffset;
  let mediaDownloaded = 0;
  const touchedChats = new Set<string>();
  const batchMessages: InsertMessageInput[] = [];

  for (const upd of updates) {
    if (upd.update_id >= maxUpdateId) {
      maxUpdateId = upd.update_id + 1;
    }

    const msg = upd.message || upd.edited_message || upd.channel_post || upd.edited_channel_post;
    if (!msg) continue;

    const chatId = String(msg.chat.id);
    const chatType: ChatType =
      msg.chat.type === 'channel'
        ? 'channel'
        : msg.chat.type === 'supergroup'
          ? 'supergroup'
          : 'group';

    const chatTitle =
      msg.chat.title ||
      [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(' ') ||
      `Chat ${chatId}`;

    if (!touchedChats.has(chatId)) {
      let memberCount = 0;
      try {
        memberCount = await telegramApiCall<number>(activeBotToken, 'getChatMemberCount', { chat_id: chatId });
      } catch {
        memberCount = 0;
      }

      upsertChat({
        id: chatId,
        title: chatTitle,
        username: msg.chat.username ?? null,
        chatType,
        memberCount,
        syncMode: 'bot_api',
        syncStatus: 'synced',
        lastSyncedAt: new Date().toISOString(),
        lastUpdateId: upd.update_id,
      });
      touchedChats.add(chatId);
    }

    const rawText = msg.text || msg.caption || (msg.poll ? `Poll: ${msg.poll.question}\n${msg.poll.options.map((o) => `• ${o.text} (${o.voter_count})`).join('\n')}` : '');
    const entities = mapTgEntities(rawText, msg.entities || msg.caption_entities);

    const senderName =
      msg.sender_chat?.title ||
      [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') ||
      msg.from?.username ||
      chatTitle;

    let mediaType: MediaType = 'none';
    let mediaUrl: string | null = null;
    let mediaName: string | null = null;
    let mediaSize: number | null = null;
    let mediaMime: string | null = null;
    let mediaWidth: number | null = null;
    let mediaHeight: number | null = null;

    if (msg.photo && msg.photo.length > 0) {
      const largest = msg.photo[msg.photo.length - 1];
      mediaType = 'photo';
      mediaName = `photo_${msg.message_id}.jpg`;
      mediaSize = largest.file_size ?? null;
      mediaMime = 'image/jpeg';
      mediaWidth = largest.width ?? null;
      mediaHeight = largest.height ?? null;
      if (activeBotMeta.autoDownloadMedia) {
        mediaUrl = await downloadTelegramFile(activeBotToken, chatId, largest.file_id, mediaName);
        if (mediaUrl) mediaDownloaded += 1;
      }
    } else if (msg.document) {
      mediaType = 'document';
      mediaName = msg.document.file_name || `document_${msg.message_id}`;
      mediaSize = msg.document.file_size ?? null;
      mediaMime = msg.document.mime_type ?? null;
      if (activeBotMeta.autoDownloadMedia) {
        mediaUrl = await downloadTelegramFile(activeBotToken, chatId, msg.document.file_id, mediaName);
        if (mediaUrl) mediaDownloaded += 1;
      }
    } else if (msg.video) {
      mediaType = 'video';
      mediaName = msg.video.file_name || `video_${msg.message_id}.mp4`;
      mediaSize = msg.video.file_size ?? null;
      mediaMime = msg.video.mime_type ?? 'video/mp4';
    } else if (msg.audio || msg.voice) {
      const audioObj = msg.audio || msg.voice!;
      mediaType = msg.voice ? 'voice' : 'audio';
      mediaName = audioObj.file_name || `${mediaType}_${msg.message_id}.ogg`;
      mediaSize = audioObj.file_size ?? null;
      mediaMime = audioObj.mime_type ?? 'audio/ogg';
    } else if (msg.poll) {
      mediaType = 'poll';
      mediaName = msg.poll.question;
    }

    batchMessages.push({
      chatId,
      tgMessageId: msg.message_id,
      senderName,
      senderUsername: msg.from?.username ?? msg.sender_chat?.username ?? null,
      senderRole: msg.sender_chat ? 'Channel' : msg.from?.is_bot ? 'Bot' : 'Member',
      dateIso: new Date(msg.date * 1000).toISOString(),
      text: rawText,
      entities,
      replyToTgId: msg.reply_to_message?.message_id ?? null,
      replyPreviewSender: msg.reply_to_message
        ? [msg.reply_to_message.from?.first_name, msg.reply_to_message.from?.last_name].filter(Boolean).join(' ') ||
          msg.reply_to_message.sender_chat?.title ||
          'Message'
        : null,
      replyPreviewText: msg.reply_to_message?.text || msg.reply_to_message?.caption || null,
      forwardFrom: msg.forward_from_chat?.title || msg.forward_sender_name || null,
      mediaType,
      mediaUrl,
      mediaName,
      mediaSize,
      mediaMime,
      mediaWidth,
      mediaHeight,
      views: msg.views ?? 0,
    });
  }

  const messagesAdded = upsertMessagesBatch(batchMessages);
  activeBotMeta.lastOffset = maxUpdateId;
  activeBotMeta.lastSyncAt = new Date().toISOString();

  addSyncLog({
    source: 'bot_api',
    status: 'success',
    messagesAdded,
    mediaDownloaded,
    detail: `Polled ${updates.length} Telegram updates across ${touchedChats.size} chat(s)`,
  });

  return {
    messagesAdded,
    mediaDownloaded,
    chatsUpdated: touchedChats.size,
  };
}

export async function registerChatViaBot(chatIdentifier: string) {
  if (!activeBotToken) {
    throw new Error('Connect a Telegram Bot token first.');
  }
  const cleaned = chatIdentifier.trim();
  if (!cleaned) {
    throw new Error('Provide a channel @username or numeric chat ID (e.g. -1001234567890).');
  }

  const chat = await telegramApiCall<{
    id: number;
    type: string;
    title?: string;
    username?: string;
    description?: string;
    pinned_message?: TgMessage;
  }>(activeBotToken, 'getChat', { chat_id: cleaned });

  let memberCount = 0;
  try {
    memberCount = await telegramApiCall<number>(activeBotToken, 'getChatMemberCount', { chat_id: chat.id });
  } catch {
    memberCount = 0;
  }

  const chatId = String(chat.id);
  const chatType: ChatType =
    chat.type === 'channel' ? 'channel' : chat.type === 'supergroup' ? 'supergroup' : 'group';

  upsertChat({
    id: chatId,
    title: chat.title || chat.username || `Chat ${chatId}`,
    username: chat.username ?? null,
    chatType,
    description: chat.description ?? null,
    memberCount,
    pinnedMessageId: chat.pinned_message?.message_id ?? null,
    syncMode: 'bot_api',
    syncStatus: 'synced',
    lastSyncedAt: new Date().toISOString(),
  });

  if (chat.pinned_message) {
    const pm = chat.pinned_message;
    const rawText = pm.text || pm.caption || '';
    upsertMessagesBatch([
      {
        chatId,
        tgMessageId: pm.message_id,
        senderName: pm.sender_chat?.title || chat.title || 'Admin',
        senderRole: chatType === 'channel' ? 'Channel' : 'Admin',
        dateIso: new Date(pm.date * 1000).toISOString(),
        text: rawText,
        entities: mapTgEntities(rawText, pm.entities || pm.caption_entities),
        isPinned: true,
      },
    ]);
  }

  addSyncLog({
    chatId,
    source: 'bot_api',
    status: 'success',
    messagesAdded: chat.pinned_message ? 1 : 0,
    detail: `Registered ${chat.title || cleaned} for Bot API mirroring`,
  });

  return chatId;
}

// Telegram Desktop `result.json` Importer
interface DesktopExportTextSegment {
  type?: string;
  text?: string;
  href?: string;
}

interface DesktopExportMessage {
  id: number;
  type?: string;
  date?: string;
  date_unixtime?: string;
  from?: string;
  from_id?: string;
  reply_to_message_id?: number;
  forwarded_from?: string;
  photo?: string;
  file?: string;
  media_type?: string;
  mime_type?: string;
  width?: number;
  height?: number;
  text?: string | Array<string | DesktopExportTextSegment>;
  reactions?: Array<{ emoji?: string; count?: number }>;
  comments?: Array<{
    author?: string;
    body?: string;
    created_at?: string;
    media_type?: MediaType;
    media_url?: string | null;
    file?: string | null;
    photo?: string | null;
    media_size?: number | null;
    mime_type?: string | null;
  }>;
}

interface DesktopExportPayload {
  name?: string;
  type?: string;
  id?: number | string;
  messages?: DesktopExportMessage[];
}

function parseDesktopText(raw: DesktopExportMessage['text']): { plain: string; entities: TextEntity[] } {
  if (!raw) return { plain: '', entities: [] };
  if (typeof raw === 'string') {
    return { plain: raw, entities: raw ? [{ type: 'plain', text: raw }] : [] };
  }
  if (!Array.isArray(raw)) {
    return { plain: '', entities: [] };
  }

  const entities: TextEntity[] = [];
  let plain = '';

  for (const part of raw) {
    if (typeof part === 'string') {
      plain += part;
      entities.push({ type: 'plain', text: part });
    } else if (part && typeof part === 'object' && typeof part.text === 'string') {
      plain += part.text;
      let mappedType: TextEntity['type'] = 'plain';
      let href: string | undefined;

      switch (part.type) {
        case 'bold':
          mappedType = 'bold';
          break;
        case 'italic':
          mappedType = 'italic';
          break;
        case 'code':
          mappedType = 'code';
          break;
        case 'pre':
          mappedType = 'pre';
          break;
        case 'text_link':
          mappedType = 'text_link';
          href = part.href;
          break;
        case 'link':
          mappedType = 'url';
          href = part.text.startsWith('http') ? part.text : `https://${part.text}`;
          break;
        case 'mention':
          mappedType = 'mention';
          break;
        case 'hashtag':
          mappedType = 'hashtag';
          break;
        case 'strikethrough':
          mappedType = 'strikethrough';
          break;
        case 'underline':
          mappedType = 'underline';
          break;
        default:
          mappedType = 'plain';
      }

      entities.push({ type: mappedType, text: part.text, href });
    }
  }

  return { plain, entities };
}

export function ingestTelegramDesktopJson(payload: DesktopExportPayload): {
  chatId: string;
  title: string;
  importedCount: number;
} {
  if (!payload || !Array.isArray(payload.messages)) {
    throw new Error('Invalid Telegram export JSON: missing "messages" array.');
  }

  const chatId = payload.id ? `tg_${String(payload.id).replace(/[^a-zA-Z0-9_-]/g, '')}` : `tg_import_${Date.now()}`;
  const title = (payload.name || 'Imported Telegram Archive').trim().slice(0, 140);

  const rawType = (payload.type || '').toLowerCase();
  const chatType: ChatType = rawType.includes('channel')
    ? 'channel'
    : rawType.includes('supergroup')
      ? 'supergroup'
      : 'group';

  upsertChat({
    id: chatId,
    title,
    chatType,
    description: `Offline mirror imported from Telegram Desktop JSON export (${payload.messages.length} records).`,
    syncMode: 'export',
    syncStatus: 'synced',
    lastSyncedAt: new Date().toISOString(),
  });

  // Build quick lookup for reply previews
  const messageLookup = new Map<number, { sender: string; text: string }>();
  for (const m of payload.messages) {
    if (typeof m.id === 'number') {
      const { plain } = parseDesktopText(m.text);
      messageLookup.set(m.id, {
        sender: m.from || title,
        text: plain.slice(0, 120),
      });
    }
  }

  const batch: InsertMessageInput[] = [];
  for (const m of payload.messages) {
    if (m.type && m.type !== 'message') continue;
    if (typeof m.id !== 'number') continue;

    const { plain, entities } = parseDesktopText(m.text);
    const dateIso = m.date_unixtime
      ? new Date(Number(m.date_unixtime) * 1000).toISOString()
      : m.date
        ? new Date(m.date).toISOString()
        : new Date().toISOString();

    let mediaType: MediaType = 'none';
    let mediaName: string | null = null;
    if (m.photo) {
      mediaType = 'photo';
      mediaName = path.basename(m.photo);
    } else if (m.file) {
      if (m.media_type === 'video_file') mediaType = 'video';
      else if (m.media_type === 'voice_message') mediaType = 'voice';
      else if (m.media_type === 'audio_file') mediaType = 'audio';
      else mediaType = 'document';
      mediaName = path.basename(m.file);
    }

    const reactions: MessageReaction[] = Array.isArray(m.reactions)
      ? m.reactions
          .filter((r) => typeof r.emoji === 'string' && typeof r.count === 'number')
          .map((r) => ({ emoji: r.emoji!, count: r.count! }))
      : [];

    const replyTarget = m.reply_to_message_id ? messageLookup.get(m.reply_to_message_id) : undefined;

    batch.push({
      chatId,
      tgMessageId: m.id,
      senderName: m.from || title,
      senderUsername: m.from_id ?? null,
      senderRole: chatType === 'channel' ? 'Channel' : 'Member',
      dateIso,
      text: plain,
      entities,
      replyToTgId: m.reply_to_message_id ?? null,
      replyPreviewSender: replyTarget?.sender ?? null,
      replyPreviewText: replyTarget?.text ?? null,
      forwardFrom: m.forwarded_from ?? null,
      mediaType,
      mediaName,
      mediaMime: m.mime_type ?? null,
      mediaWidth: m.width ?? null,
      mediaHeight: m.height ?? null,
      reactions,
    });
  }

  const importedCount = upsertMessagesBatch(batch);

  const importedComments: Array<{
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
  }> = [];
  for (const m of payload.messages) {
    if (typeof m.id === 'number' && Array.isArray(m.comments)) {
      for (const c of m.comments) {
        const hasBody = typeof c?.body === 'string' && c.body.trim().length > 0;
        const hasMedia = Boolean(c?.photo || c?.file || (c?.media_type && c.media_type !== 'none'));
        if (hasBody || hasMedia) {
          let cMediaType: MediaType = c.media_type ?? 'none';
          let cMediaName: string | null = null;
          if (c.photo) {
            cMediaType = 'photo';
            cMediaName = path.basename(c.photo);
          } else if (c.file) {
            if (cMediaType === 'none') cMediaType = 'document';
            cMediaName = path.basename(c.file);
          }
          importedComments.push({
            chatId,
            targetTgMessageId: m.id,
            authorName: (c.author || 'Telegram User').trim(),
            body: (c.body || '').trim(),
            createdAt: c.created_at || new Date().toISOString(),
            mediaType: cMediaType,
            mediaUrl: typeof c.media_url === 'string' && c.media_url.startsWith('/api/media-files/') ? c.media_url : null,
            mediaName: cMediaName,
            mediaSize: typeof c.media_size === 'number' ? c.media_size : null,
            mediaMime: typeof c.mime_type === 'string' ? c.mime_type : null,
          });
        }
      }
    }
  }
  upsertMirroredCommentsBatch(importedComments);

  addSyncLog({
    chatId,
    source: 'json_import',
    status: 'success',
    messagesAdded: importedCount,
    detail: `Imported "${title}" (${importedCount} messages) from Telegram Desktop JSON`,
  });

  return { chatId, title, importedCount };
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, '')).trim();
}

function parseCompactCount(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, '');
  const match = cleaned.match(/^([\d.]+)([KM]?)$/);
  if (!match) return parseInt(cleaned.replace(/[^\d]/g, ''), 10) || 0;
  const num = parseFloat(match[1]);
  if (match[2] === 'M') return Math.round(num * 1_000_000);
  if (match[2] === 'K') return Math.round(num * 1_000);
  return Math.round(num);
}

function extractTelegramUsername(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error('Enter a public Telegram channel @username or t.me link.');
  }
  let candidate = trimmed;
  if (/^https?:\/\//i.test(candidate)) {
    const parsed = new URL(candidate);
    if (!/^(t\.me|telegram\.me)$/i.test(parsed.hostname)) {
      throw new Error('Only t.me or telegram.me channel links are supported.');
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    candidate = parts[0] === 's' ? (parts[1] ?? '') : (parts[0] ?? '');
  }
  candidate = candidate.replace(/^@/, '').trim();
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(candidate)) {
    throw new Error('Invalid Telegram channel username. Expected 3–32 letters, numbers, or underscores.');
  }
  return candidate;
}

function isAllowedTelegramCdnUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:') return false;
    return /^([a-z0-9-]+\.)?(telegram-cdn\.org|telesco\.pe|telegram\.org|t\.me)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

async function downloadPublicCdnAsset(
  rawUrl: string,
  chatId: string,
  preferredName: string
): Promise<string | null> {
  if (!isAllowedTelegramCdnUrl(rawUrl)) return null;
  try {
    const res = await fetch(rawUrl, {
      headers: { 'User-Agent': 'TeleVault-Archive/1.0' },
    });
    if (!res.ok) return null;
    const contentLength = Number(res.headers.get('content-length') || '0');
    if (contentLength > 15 * 1024 * 1024) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 15 * 1024 * 1024) return null;

    const safeChatDir = chatId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const chatMediaDir = path.resolve(MEDIA_ROOT_DIR, safeChatDir);
    if (!chatMediaDir.startsWith(MEDIA_ROOT_DIR + path.sep)) return null;
    if (!fs.existsSync(chatMediaDir)) {
      fs.mkdirSync(chatMediaDir, { recursive: true });
    }

    const base = preferredName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || `asset_${Date.now()}.jpg`;
    const destPath = path.resolve(chatMediaDir, base);
    if (!destPath.startsWith(chatMediaDir + path.sep)) return null;

    fs.writeFileSync(destPath, buf);
    return `/api/media-files/${encodeURIComponent(safeChatDir)}/${encodeURIComponent(base)}`;
  } catch {
    return null;
  }
}

function parsePublicHtmlEntities(htmlFragment: string): { plain: string; entities: TextEntity[] } {
  const entities: TextEntity[] = [];
  let plain = '';

  // Tokenize <a href="...">text</a> links while keeping surrounding text clean
  const linkRegex = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(htmlFragment)) !== null) {
    if (match.index > lastIdx) {
      const before = stripTags(htmlFragment.slice(lastIdx, match.index));
      if (before) {
        plain += before;
        entities.push({ type: 'plain', text: before });
      }
    }
    const href = decodeHtmlEntities(match[1]);
    const label = stripTags(match[2]);
    if (label) {
      plain += label;
      if (label.startsWith('#')) {
        entities.push({ type: 'hashtag', text: label });
      } else if (label.startsWith('@')) {
        entities.push({ type: 'mention', text: label });
      } else if (/^https?:\/\//i.test(href)) {
        entities.push({ type: 'text_link', text: label, href });
      } else {
        entities.push({ type: 'plain', text: label });
      }
    }
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < htmlFragment.length) {
    const tail = stripTags(htmlFragment.slice(lastIdx));
    if (tail) {
      plain += tail;
      entities.push({ type: 'plain', text: tail });
    }
  }

  return { plain: plain.trim(), entities };
}

export async function mirrorPublicChannel(channelInput: string, downloadMedia = true): Promise<{
  chatId: string;
  title: string;
  messagesAdded: number;
  mediaDownloaded: number;
}> {
  const username = extractTelegramUsername(channelInput);
  const previewUrl = `https://t.me/s/${encodeURIComponent(username)}`;

  const res = await fetch(previewUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TeleVaultArchive/1.0)',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!res.ok) {
    throw new Error(`Telegram returned HTTP ${res.status} for @${username}.`);
  }

  const html = await res.text();
  const titleMatch = html.match(/<div class="tgme_channel_info_header_title[^"]*">([\s\S]*?)<\/div>/i);
  if (!titleMatch) {
    throw new Error(
      `Public preview is unavailable for @${username}. Private groups/channels or invite-only chats require Telegram Desktop JSON export or a User MTProto session.`
    );
  }

  const title = stripTags(titleMatch[1]) || `@${username}`;
  const descMatch = html.match(/<div class="tgme_channel_info_description[^"]*">([\s\S]*?)<\/div>/i);
  const description = descMatch ? stripTags(descMatch[1]) : `Public Telegram channel mirrored from t.me/s/${username}.`;

  const subMatch = html.match(/<span class="counter_value">([^<]+)<\/span>\s*<span class="counter_type">subscribers?<\/span>/i);
  const memberCount = parseCompactCount(subMatch?.[1]);

  const chatId = `pub_${username.toLowerCase()}`;
  let avatarUrl: string | null = null;
  const avatarMatch = html.match(/<i class="tgme_page_photo_image"[^>]*>\s*<img[^>]*src="([^"]+)"/i) ||
    html.match(/<img class="tgme_page_photo_image"[^>]*src="([^"]+)"/i);
  if (avatarMatch?.[1] && downloadMedia) {
    avatarUrl = await downloadPublicCdnAsset(decodeHtmlEntities(avatarMatch[1]), chatId, `avatar_${username}.jpg`);
  }

  upsertChat({
    id: chatId,
    title,
    username,
    chatType: 'channel',
    description,
    avatarUrl,
    memberCount,
    syncMode: 'export',
    syncStatus: 'synced',
    lastSyncedAt: new Date().toISOString(),
  });

  // Split message widget blocks
  const blocks = html.split(/<div class="tgme_widget_message\b/i).slice(1);
  const batch: InsertMessageInput[] = [];
  let mediaDownloaded = 0;

  for (const rawBlock of blocks) {
    const postMatch = rawBlock.match(/data-post="[^/"]+\/(\d+)"/i);
    if (!postMatch) continue;
    const tgMessageId = Number(postMatch[1]);
    if (!Number.isInteger(tgMessageId)) continue;

    const dateMatch = rawBlock.match(/<time[^>]*datetime="([^"]+)"/i);
    const dateIso = dateMatch ? new Date(dateMatch[1]).toISOString() : new Date().toISOString();

    const textMatch = rawBlock.match(
      /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div class="tgme_widget_message_footer|<\/div>)/i
    ) || rawBlock.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

    const { plain, entities } = textMatch ? parsePublicHtmlEntities(textMatch[1]) : { plain: '', entities: [] };

    const viewsMatch = rawBlock.match(/<span class="tgme_widget_message_views">([^<]+)<\/span>/i);
    const views = parseCompactCount(viewsMatch?.[1]);

    const fwdMatch = rawBlock.match(/<a class="tgme_widget_message_forwarded_from_name"[^>]*>([\s\S]*?)<\/a>/i);
    const forwardFrom = fwdMatch ? stripTags(fwdMatch[1]) : null;

    const replyHrefMatch = rawBlock.match(/<a class="tgme_widget_message_reply"[^>]*href="[^"]*\/(\d+)"/i);
    const replyAuthorMatch = rawBlock.match(/<div class="tgme_widget_message_author[^"]*">([\s\S]*?)<\/div>/i);
    const replyTextMatch = rawBlock.match(/<div class="tgme_widget_message_metatext[^"]*">([\s\S]*?)<\/div>/i);

    let mediaType: MediaType = 'none';
    let mediaUrl: string | null = null;
    let mediaName: string | null = null;

    const photoMatch = rawBlock.match(/tgme_widget_message_photo_wrap[^>]*style="[^"]*background-image:url\('([^']+)'\)/i);
    const docMatch = rawBlock.match(/<div class="tgme_widget_message_document_title[^"]*">([\s\S]*?)<\/div>/i);

    if (photoMatch?.[1]) {
      mediaType = 'photo';
      mediaName = `post_${tgMessageId}.jpg`;
      if (downloadMedia) {
        mediaUrl = await downloadPublicCdnAsset(decodeHtmlEntities(photoMatch[1]), chatId, mediaName);
        if (mediaUrl) mediaDownloaded += 1;
      }
    } else if (docMatch?.[1]) {
      mediaType = 'document';
      mediaName = stripTags(docMatch[1]);
    }

    if (!plain && mediaType === 'none') continue;

    batch.push({
      chatId,
      tgMessageId,
      senderName: title,
      senderUsername: username,
      senderRole: 'Channel',
      dateIso,
      text: plain,
      entities,
      replyToTgId: replyHrefMatch ? Number(replyHrefMatch[1]) : null,
      replyPreviewSender: replyAuthorMatch ? stripTags(replyAuthorMatch[1]) : null,
      replyPreviewText: replyTextMatch ? stripTags(replyTextMatch[1]) : null,
      forwardFrom,
      mediaType,
      mediaUrl,
      mediaName,
      views,
    });
  }

  const messagesAdded = upsertMessagesBatch(batch);

  addSyncLog({
    chatId,
    source: 'json_import',
    status: messagesAdded > 0 ? 'success' : 'warning',
    messagesAdded,
    mediaDownloaded,
    detail: `Mirrored ${messagesAdded} public posts (${mediaDownloaded} images) from @${username} via t.me/s/${username}`,
  });

  return { chatId, title, messagesAdded, mediaDownloaded };
}

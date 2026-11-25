export type ChatType = 'channel' | 'supergroup' | 'group';

export type SyncMode = 'bot_api' | 'export' | 'sample';

export type SyncStatus = 'synced' | 'syncing' | 'paused' | 'error' | 'idle';

export type MediaType = 'photo' | 'document' | 'video' | 'audio' | 'voice' | 'poll' | 'none';

export interface TextEntity {
  type: 'plain' | 'bold' | 'italic' | 'code' | 'pre' | 'text_link' | 'url' | 'mention' | 'hashtag' | 'strikethrough' | 'underline';
  text: string;
  href?: string;
  language?: string;
}

export interface MessageReaction {
  emoji: string;
  count: number;
}

export interface ChatSummary {
  id: string;
  title: string;
  username: string | null;
  chatType: ChatType;
  description: string | null;
  avatarUrl: string | null;
  memberCount: number;
  pinnedMessageId: number | null;
  syncMode: SyncMode;
  syncStatus: SyncStatus;
  lastSyncedAt: string | null;
  lastUpdateId: number;
  createdAt: string;
  messageCount: number;
  mediaCount: number;
  bookmarkedCount: number;
  lastMessageText: string | null;
  lastMessageDate: string | null;
  lastMessageSender: string | null;
}

export interface ArchivedMessage {
  id: number;
  chatId: string;
  tgMessageId: number;
  senderName: string;
  senderUsername: string | null;
  senderRole: string | null;
  dateIso: string;
  text: string;
  entities: TextEntity[];
  replyToTgId: number | null;
  replyPreviewSender: string | null;
  replyPreviewText: string | null;
  forwardFrom: string | null;
  mediaType: MediaType;
  mediaUrl: string | null;
  mediaName: string | null;
  mediaSize: number | null;
  mediaMime: string | null;
  mediaWidth: number | null;
  mediaHeight: number | null;
  views: number;
  reactions: MessageReaction[];
  isPinned: boolean;
  isBookmarked: boolean;
  replyCount: number;
}

export interface MessageComment {
  id: number;
  chatId: string;
  targetTgMessageId: number;
  authorName: string;
  body: string;
  source: 'mirrored' | 'local';
  createdAt: string;
  mediaType: MediaType;
  mediaUrl: string | null;
  mediaName: string | null;
  mediaSize: number | null;
  mediaMime: string | null;
}

export interface SearchHit {
  id: number;
  chatId: string;
  chatTitle: string;
  chatType: ChatType;
  tgMessageId: number;
  senderName: string;
  dateIso: string;
  text: string;
  mediaType: MediaType;
  mediaName: string | null;
  snippet: string;
}

export interface MediaVaultItem {
  id: number;
  chatId: string;
  chatTitle: string;
  tgMessageId: number;
  senderName: string;
  dateIso: string;
  text: string;
  mediaType: MediaType;
  mediaUrl: string | null;
  mediaName: string | null;
  mediaSize: number | null;
  mediaMime: string | null;
  extractedUrls: string[];
}

export interface SyncLogEntry {
  id: number;
  chatId: string | null;
  chatTitle: string | null;
  source: 'bot_api' | 'json_import' | 'archive_export';
  status: 'success' | 'warning' | 'error';
  messagesAdded: number;
  mediaDownloaded: number;
  detail: string;
  createdAt: string;
}

export interface BotConnectionStatus {
  connected: boolean;
  source: 'env' | 'session' | 'none';
  botUsername: string | null;
  botName: string | null;
  maskedToken: string | null;
  autoDownloadMedia: boolean;
  lastOffset: number;
  lastSyncAt: string | null;
}

export interface ArchiveStats {
  totalChats: number;
  totalMessages: number;
  totalMediaFiles: number;
  totalBookmarks: number;
  storageBytes: number;
}

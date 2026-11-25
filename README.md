# TeleVault — Offline Telegram Mirror & Archive

**TeleVault** is a full-stack Telegram group and channel mirror system built for local archiving, offline browsing, discussion comments, media preservation, and instant full-text search.

## Features

- **Offline Archive Reader**: Chronological, date-grouped message stream for mirrored Telegram channels, supergroups, and groups with rich text entity rendering (bold, italic, inline code, syntax code blocks, safe links, hashtags, mentions), reply jump links, reactions, pinned post banners, and offline bookmarks.
- **Read-Only Telegram Comments & Threads**: Inspect mirrored Telegram thread replies and channel post comments—including inline photos, audio/video, and file attachments—in a dedicated read-only drawer without modifying the archived history.
- **SQLite + FTS5 Full-Text Search**: Instant local search across message bodies, sender names, and attached filenames with direct jump-to-message navigation.
- **Offline Media Vault**: Filterable gallery and attachment ledger for mirrored photos, documents, audio files, and extracted URLs across all archived chats.
- **Telegram Desktop JSON Importer**: Drag-and-drop or upload official `result.json` chat exports from Telegram Desktop (`Export Chat History → JSON`) with pre-import validation and preview.
- **Telegram Bot API Mirror**: Connect a Telegram Bot token server-side to track groups/channels, poll updates via `getUpdates`, and automatically download shared photos and documents to local disk (`data/media/`).
- **Portable Archive Export**: Export any mirrored group or channel back out as a standalone JSON archive.
- **Light & Dark Themes**: Accessible dual-theme interface with persistent tabular typography.

> For step-by-step operator instructions, backup procedures, BotFather configuration, and troubleshooting, see [OPERATIONS_MANUAL.md](./OPERATIONS_MANUAL.md).

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide Icons
- **Backend**: Express, Node.js (`tsx`), Vite middleware
- **Database & Storage**: SQLite (`better-sqlite3`) with `WAL` mode and `FTS5` full-text indexing (`data/mirror.db`), plus local media storage (`data/media/`)

## Project Structure

```text
├── server.ts                  # Express server, API routes, Vite dev middleware
├── src/
│   ├── App.tsx                # Main workspace layout, sidebar, message stream
│   ├── types.ts               # Shared TypeScript interfaces
│   ├── index.css              # Tailwind v4 configuration and theme tokens
│   ├── utils/format.ts        # Safe URL checks, byte/date formatters, avatars
│   ├── server/
│   │   ├── db.ts              # SQLite schema, FTS5 triggers, queries, seeder
│   │   └── telegram.ts        # Telegram Bot API client & JSON export parser
│   └── components/
│       ├── MessageItem.tsx    # Individual message card & attachment renderer
│       ├── RichTextRenderer.tsx # XSS-safe Telegram entity renderer
│       ├── ThreadDrawer.tsx   # Comments, replies & channel info drawer
│       ├── MediaVaultView.tsx # Photos, documents & links vault
│       ├── SyncSourcesView.tsx # JSON importer, Bot API setup & sync logs
│       ├── GlobalSearchView.tsx # Full-text FTS5 search view
│       └── LightboxModal.tsx  # Full-screen image preview modal
└── data/                      # Local SQLite database & downloaded media
```

## Getting Started

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment variables (optional)**:
   Copy `.env.example` to `.env` if you want to supply a server-side Telegram Bot token automatically:
   ```env
   TELEGRAM_BOT_TOKEN=123456789:AAH...
   ```

3. **Run in development**:
   ```bash
   npm run dev
   ```
   The dev server starts on `http://localhost:3000` (or set `PORT=3080`).

4. **Typecheck & production build**:
   ```bash
   npm run lint
   npm run build
   NODE_ENV=production npm start
   ```
   Production mode listens on `http://localhost:3080`.

5. **Run with Docker Compose** *(persistent `./data` volume)*:
   ```bash
   docker compose up -d --build
   ```
   TeleVault will be available at `http://localhost:3080` with SQLite and mirrored media stored in `./data`.

## Security Notes

- Telegram Bot tokens are stored strictly on the server (via `process.env.TELEGRAM_BOT_TOKEN` or server memory) and are never returned unmasked to the browser.
- All SQLite queries use parameterized prepared statements, and FTS5 search queries are sanitized prior to execution.
- Rich message links are validated for `http:` / `https:` schemes and rendered through React JSX without raw HTML injection.
- Local media file routes enforce strict directory path confinement under `data/media/`.

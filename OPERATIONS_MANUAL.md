# TeleVault Operation & Maintenance Tutorial Manual

This manual provides step-by-step instructions for deploying, operating, mirroring Telegram groups/channels, maintaining the SQLite + media storage vault, and troubleshooting **TeleVault**.

---

## 1. System Architecture & Data Layout

TeleVault runs as a single Node.js + Express process (`server.ts`) serving both the REST API (`/api/*`) and the React frontend on port `3000`.

| Path | Purpose |
| :--- | :--- |
| `data/mirror.db` | Primary SQLite database (WAL mode) storing `chats`, `messages`, `comments`, `messages_fts` (FTS5 index), and `sync_logs`. |
| `data/mirror.db-wal` / `-shm` | SQLite Write-Ahead Log sidecar files present while the server is running. |
| `data/media/<chat_dir>/` | Locally downloaded photos, documents, and attachments fetched via Telegram Bot API. |
| `server.ts` | Express server, API routes, path-confined media file server, and Vite/dist asset handler. |
| `src/server/db.ts` | Database schema initialization, FTS5 triggers, parameterized query layer. |
| `src/server/telegram.ts` | Telegram Bot API poller (`getMe`, `getChat`, `getUpdates`, `getFile`) and `result.json` importer. |

**Archive Fidelity Rule:** Archived messages and Telegram comments are strictly **read-only**. Comments displayed in the **Telegram Comments** drawer originate exclusively from mirrored Telegram threads/exports and cannot be forged or altered inside the offline viewer.

---

## 2. Deployment & Startup Tutorial

### 2.1 Prerequisites
- **Node.js 20+** (with `npm`)
- **SQLite CLI (`sqlite3`)** (recommended on host for hot backups and maintenance)
- Outbound HTTPS access to `https://api.telegram.org` (only required when running live Bot API syncs; offline browsing works with zero network access).

### 2.2 Environment Configuration
1. Copy the template environment file:
   ```bash
   cp .env.example .env
   ```
2. *(Optional)* Configure a persistent Bot API token in `.env` (or your hosting secret manager):
   ```env
   TELEGRAM_BOT_TOKEN=123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
   > If omitted from `.env`, operators can connect a bot token at runtime through the **Sync Sources** UI. Runtime tokens stay strictly in server memory.

### 2.3 Installing, Building & Running
- **Development Mode** (Vite middleware + live API):
  ```bash
  npm install
  npm run dev
  ```
- **Production Mode** (static compiled frontend + Express API):
  ```bash
  npm install
  npm run lint
  npm run build
  NODE_ENV=production npm start
  ```
  Verify the service is responding on port `3000`:
  ```bash
  curl -sf http://localhost:3000/api/health
  ```

### 2.4 Running with Docker & Docker Compose
TeleVault includes a multi-stage `Dockerfile` (with `sqlite3` CLI preinstalled for hot backups) and `docker-compose.yml` mounting `./data:/app/data`.

1. **Build and start the container**:
   ```bash
   docker compose up -d --build
   ```
2. **Pass a Bot Token via `.env` (optional)**:
   ```bash
   TELEGRAM_BOT_TOKEN=123456789:AAH... docker compose up -d
   ```
3. **Check container health and logs**:
   ```bash
   docker compose ps
   docker compose logs -f televault
   ```
4. **Run SQLite hot backups inside the running container**:
   ```bash
   mkdir -p backups/$(date +%F)
   docker exec televault sqlite3 /app/data/mirror.db ".backup '/app/data/mirror_backup.db'"
   mv data/mirror_backup.db backups/$(date +%F)/mirror.db
   ```

---

## 3. Daily Operations Tutorials

### Mirroring Channels & Groups Owned by Others (Ownership Matrix)
Telegram enforces strict access boundaries depending on who owns the channel or group:

| Source Type | Recommended TeleVault Method | Notes |
| :--- | :--- | :--- |
| **Public Channel owned by someone else** (`@username`) | **Public Channel Mirror** (`t.me/s/<username>`) | No admin rights or bot token required. Fetches posts, view counts, replies, and inline photos directly into SQLite + `data/media/`. |
| **Private Group or Private Channel owned by someone else** (you are a member) | **Telegram Desktop JSON Export** (`result.json`) | Export chat history as JSON from your Telegram Desktop client and drop `result.json` into TeleVault. |
| **Channel or Group you admin / own** | **Telegram Bot API Mirror** (`getUpdates`) | Add your bot (with Group Privacy disabled for groups) and sync live messages + media incrementally. |

---

### Tutorial A: Mirroring Public Channels Owned by Others (`@username`)
1. Open **Sync Sources** (or click **Add Source**).
2. In **Public Channel Mirror (Owned by Others)**, enter a channel handle (`@durov`) or URL (`https://t.me/telegram`).
3. Keep **Save photos locally** checked to download post images to `data/media/`.
4. Click **Mirror Public Channel**. TeleVault fetches the public web preview (`t.me/s/<username>`), saves channel metadata and posts into SQLite, and opens the archived channel.

---

### Tutorial B: Importing Historical Archives via Telegram Desktop (`result.json`)
Use this workflow to mirror complete historical logs of any existing group or channel—including **private groups and channels owned by others** where you are a member.

1. Open **Telegram Desktop** on your workstation and navigate to the target group or channel.
2. Click the **⋮ (More)** menu → **Export Chat History**.
3. Set **Format** to **JSON** (`result.json`). Uncheck unnecessary heavy media types if you only want text/metadata, or export in smaller date chunks for very large groups.
4. Open TeleVault in your browser and click **Add Source** (top-right CTA) or **Sync Sources** in the navigation bar.
5. Drag and drop `result.json` into the **Import Telegram Desktop Export** dropzone (or click **Choose JSON File**).
6. Review the pre-import preview card (chat title and total record count) and click **Import Into Offline Vault**.
7. TeleVault parses rich text entities, reply chains (`reply_to_message_id`), reactions, and mirrored `comments`, indexes all records into SQLite FTS5, and opens the archived stream immediately.

---

### Tutorial B: Live Mirroring via Telegram Bot API
Use this workflow to continuously capture new posts, replies, and media files into local storage.

1. **Create a Bot in Telegram**:
   - Message `@BotFather` on Telegram and run `/newbot`.
   - Copy the generated Bot Token (`123456789:AAH...`).
2. **Disable Group Privacy Mode** *(Critical for Groups)*:
   - In `@BotFather`, send `/mybots` → select your bot → **Bot Settings** → **Group Privacy** → **Turn off**.
   - Without disabling privacy mode, Telegram only delivers `/` commands and mentions to bots in groups rather than all group messages.
3. **Add the Bot to Target Channels & Groups**:
   - **Groups / Supergroups**: Add the bot as a regular member (or admin for pinned message metadata).
   - **Channels**: Add the bot as an **Administrator** (at minimum with permission to read/post messages; TeleVault only reads `channel_post` updates).
4. **Connect & Sync in TeleVault**:
   - Go to **Sync Sources → Telegram Bot API Mirror**.
   - Paste the Bot Token, ensure **Automatically download photos & documents to local disk** is checked, and click **Connect Bot Token**.
   - *(Optional)* Enter a channel `@username` or numeric chat ID (e.g., `-1001234567890`) and click **Track Chat** to fetch its metadata and pinned post immediately.
   - Click **Sync New Messages & Media Now** to poll `getUpdates`. New messages are committed to `data/mirror.db`, and attached photos/documents (up to 20 MB per file) are saved under `data/media/<chat_id>/`.
5. **Verify Sync History**:
   - Inspect the **Sync & Import History** table at the bottom of **Sync Sources** to confirm message counts, downloaded media counts, and timestamps.

---

### Tutorial C: Offline Browsing, Search & Portable Backups
- **Channel & Group Reading**: Switch between mirrored chats in the left sidebar (`All`, `Chan`, `Grp`, `Saved`), filter messages inline (`All`, `Photos`, `Files`, `Links`, `Pinned`, `Saved`), and click reply quote blocks or pinned banners to jump directly to the referenced message.
- **Inspecting Telegram Comments**: On any message or channel post showing `N comments`, click the comment link to open the read-only **Telegram Comments** drawer, which displays mirrored text, inline photos (with full-screen lightbox preview), audio/video playback, and attached files.
- **Full-Text Search**: Use **Global Search** (powered by SQLite FTS5) to search across all chats by keyword, sender name, or filename, then click **Jump** to open the exact message in context.
- **Media Vault**: Use **Media Vault** to browse archived photos in a lightbox gallery, inspect a tabular ledger of downloaded files, or review extracted URLs.
- **Exporting Portable JSON**: Open any chat's **Details** drawer (or header **Export JSON** button) to download `<chat>_mirror.json` containing messages, formatting entities, reactions, and mirrored comments.

---

## 4. Routine Maintenance Procedures

### 4.1 Safe Hot Backups (While Server Is Running)
Because `data/mirror.db` runs in SQLite `WAL` mode, **never** copy `mirror.db` alone with `cp` while the server is active without including `-wal`/`-shm` or using SQLite's online `.backup` command.

**Recommended Backup Command:**
```bash
mkdir -p backups/$(date +%F)
sqlite3 data/mirror.db ".backup 'backups/$(date +%F)/mirror.db'"
tar -czf backups/$(date +%F)/media.tar.gz data/media/
```

### 4.2 Restoring from Backup
1. Stop the TeleVault server process cleanly (`Ctrl+C` or `systemctl stop televault`).
2. Remove any stale `-wal` / `-shm` sidecar files in `data/`:
   ```bash
   rm -f data/mirror.db-wal data/mirror.db-shm
   ```
3. Restore `mirror.db` and `data/media/`:
   ```bash
   cp backups/YYYY-MM-DD/mirror.db data/mirror.db
   tar -xzf backups/YYYY-MM-DD/media.tar.gz -C .
   ```
4. Restart the server (`npm start`).

### 4.3 Database Compaction & FTS5 Index Maintenance
Run periodic maintenance during a low-traffic window:
```bash
# 1. Checkpoint WAL into main database file
sqlite3 data/mirror.db "PRAGMA wal_checkpoint(TRUNCATE);"

# 2. Rebuild the FTS5 full-text index if search results appear out of sync
sqlite3 data/mirror.db "INSERT INTO messages_fts(messages_fts) VALUES('rebuild');"

# 3. Reclaim unused disk pages after deleting large chats
sqlite3 data/mirror.db "VACUUM;"

# 4. Verify database integrity
sqlite3 data/mirror.db "PRAGMA integrity_check;"
```

### 4.4 Storage Capacity Monitoring
Check disk usage of the SQLite database and mirrored media directories:
```bash
du -sh data/ data/mirror.db data/media/*
```
To reclaim space from an obsolete archive, open **Archive → Details → Remove Mirrored Archive** in the UI. This deletes the chat record, cascades deletion of its messages/comments in SQLite, and removes its `data/media/<chat_id>/` directory.

---

## 5. Troubleshooting Runbook

| Symptom | Likely Cause | Resolution |
| :--- | :--- | :--- |
| **Bot connects, but `Sync` returns 0 group messages** | Bot privacy mode is enabled in `@BotFather`, or no new messages arrived since the bot joined. | Turn off Group Privacy in `@BotFather` (`/mybots` → **Group Privacy** → **Turn off**), remove and re-add the bot to the group, send a test message, and click **Sync New Messages & Media Now**. |
| **`409 Conflict: terminated by other getUpdates request`** | Another process or webhook is using the same Bot Token concurrently. | Ensure only one TeleVault instance polls that token, or delete any active webhook via `https://api.telegram.org/bot<TOKEN>/deleteWebhook`. |
| **JSON import fails with payload too large** | `result.json` exceeds the 50 MB Express JSON body limit. | Re-export from Telegram Desktop in smaller date ranges (e.g., per quarter/year) and import sequentially; upserts deduplicate by `(chat_id, tg_message_id)`. |
| **Media card shows `Indexed` instead of image/download** | Imported `result.json` only references relative file paths without uploading binary assets, or the Bot API file exceeded 20 MB. | For live Bot API syncs, verify **Automatically download photos & documents** is enabled before syncing; files over 20 MB must be archived via Telegram Desktop export. |
| **Lost Bot connection after server restart** | Token was entered in the UI (stored in server memory only). | Re-enter the token in **Sync Sources** or persist `TELEGRAM_BOT_TOKEN` in `.env` / environment secrets before starting the server. |

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || './data/newgen-chat.sqlite';
if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
 token_version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS friendships (
 id TEXT PRIMARY KEY, from_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 to_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected','blocked')),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(from_user,to_user), CHECK(from_user <> to_user)
);
CREATE TABLE IF NOT EXISTS blocks (
 blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL, PRIMARY KEY(blocker_id,blocked_id), CHECK(blocker_id <> blocked_id)
);
CREATE TABLE IF NOT EXISTS messages (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
 sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 ciphertext TEXT NOT NULL, nonce TEXT NOT NULL, salt TEXT NOT NULL,
 algorithm TEXT NOT NULL DEFAULT 'AES-256-GCM-PBKDF2-SHA256', created_at INTEGER NOT NULL,
 delivered_at INTEGER, read_at INTEGER, expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS groups_chat (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 64),
 owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS group_members (
 group_id TEXT NOT NULL REFERENCES groups_chat(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('admin','member')),
 joined_at INTEGER NOT NULL, PRIMARY KEY(group_id,user_id)
);
CREATE TABLE IF NOT EXISTS group_messages (
 id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups_chat(id) ON DELETE CASCADE,
 sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 ciphertext TEXT NOT NULL, nonce TEXT NOT NULL, salt TEXT NOT NULL,
 algorithm TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_group_messages ON group_messages(group_id,created_at);
CREATE TABLE IF NOT EXISTS statuses (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 ciphertext TEXT NOT NULL, nonce TEXT NOT NULL, salt TEXT NOT NULL,
 expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS status_reactions (
 status_id TEXT NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 reaction TEXT NOT NULL CHECK(length(reaction) <= 16), created_at INTEGER NOT NULL,
 PRIMARY KEY(status_id,user_id)
);
CREATE TABLE IF NOT EXISTS status_replies (
 id TEXT PRIMARY KEY, status_id TEXT NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 ciphertext TEXT NOT NULL, nonce TEXT NOT NULL, salt TEXT NOT NULL, created_at INTEGER NOT NULL
);
`);

// Revoked JWT IDs allow one-device logout without invalidating every other session.
// Expired entries are pruned on logout; password reset/logout-all still use token_version.
db.exec(`CREATE TABLE IF NOT EXISTS revoked_tokens (
 jti TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL,
 revoked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_user ON revoked_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at);
`);
module.exports = db;


// Encrypted media blobs are opaque to the API; never store plaintext media.
db.exec(`
CREATE TABLE IF NOT EXISTS media_blobs (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 recipient_id TEXT REFERENCES users(id) ON DELETE CASCADE,
 ciphertext_b64 TEXT NOT NULL, nonce TEXT NOT NULL, salt TEXT NOT NULL,
 mime_type TEXT NOT NULL, file_name TEXT NOT NULL, byte_length INTEGER NOT NULL,
 group_id TEXT REFERENCES groups_chat(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL, expires_at INTEGER
);
CREATE TABLE IF NOT EXISTS user_presence (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 last_seen_at INTEGER NOT NULL, is_online INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS typing_state (
 room_key TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL, PRIMARY KEY(room_key,user_id)
);
CREATE TABLE IF NOT EXISTS status_views (
 status_id TEXT NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
 viewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 viewed_at INTEGER NOT NULL, PRIMARY KEY(status_id,viewer_id)
);
`);

// Lightweight forward-compatible SQLite migrations for existing local development databases.
const userColumns = new Set(db.pragma('table_info(users)').map(column => column.name));
if (!userColumns.has('token_version')) db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
const messageColumns = new Set(db.pragma('table_info(messages)').map(column => column.name));
if (!messageColumns.has('expires_at')) db.exec('ALTER TABLE messages ADD COLUMN expires_at INTEGER');
const groupMessageColumns = new Set(db.pragma('table_info(group_messages)').map(column => column.name));
if (!groupMessageColumns.has('expires_at')) db.exec('ALTER TABLE group_messages ADD COLUMN expires_at INTEGER');
const mediaColumns = new Set(db.pragma('table_info(media_blobs)').map(column => column.name));
if (!mediaColumns.has('group_id')) db.exec('ALTER TABLE media_blobs ADD COLUMN group_id TEXT REFERENCES groups_chat(id) ON DELETE CASCADE');

db.exec(`CREATE TABLE IF NOT EXISTS account_recovery (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 code_hash TEXT NOT NULL, created_at INTEGER NOT NULL
);`);

// FCM registration tokens are per-installation credentials; store only for delivery,
// never expose them through user/profile APIs.
db.exec(`
CREATE TABLE IF NOT EXISTS push_devices (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_devices_user ON push_devices(user_id);
`);

// Security-question recovery is separate from chat passkeys and recovery keys.
const securityColumns = new Set(db.pragma('table_info(users)').map(column => column.name));
if (!securityColumns.has('security_question')) db.exec('ALTER TABLE users ADD COLUMN security_question TEXT');
if (!securityColumns.has('security_answer_hash')) db.exec('ALTER TABLE users ADD COLUMN security_answer_hash TEXT');


// Device identity and recipient-specific conversation-key envelopes.
// The API stores public keys and ciphertext only; private keys and plaintext
// conversation keys must remain on the clients.
db.exec(`
CREATE TABLE IF NOT EXISTS device_keys (
 device_id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 public_key_b64 TEXT NOT NULL,
 algorithm TEXT NOT NULL CHECK(algorithm='ECDH-P256-SPKI'),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_device_keys_user ON device_keys(user_id);
CREATE TABLE IF NOT EXISTS key_envelopes (
 conversation_id TEXT NOT NULL,
 sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 sender_device_id TEXT NOT NULL REFERENCES device_keys(device_id) ON DELETE CASCADE,
 recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 recipient_device_id TEXT NOT NULL REFERENCES device_keys(device_id) ON DELETE CASCADE,
 ciphertext TEXT NOT NULL,
 nonce TEXT NOT NULL,
 algorithm TEXT NOT NULL CHECK(algorithm='ECDH-P256-HKDF-SHA256-AES-256-GCM'),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(conversation_id, recipient_device_id)
);
CREATE INDEX IF NOT EXISTS idx_key_envelopes_recipient ON key_envelopes(recipient_id, conversation_id);
`);

// Any group membership change invalidates current group-key envelopes.
// Clients must generate a fresh group key and distribute new envelopes.
db.exec(`
CREATE TRIGGER IF NOT EXISTS invalidate_group_envelopes_after_member_insert
AFTER INSERT ON group_members
BEGIN
 DELETE FROM key_envelopes WHERE conversation_id=NEW.group_id;
END;
CREATE TRIGGER IF NOT EXISTS invalidate_group_envelopes_after_member_delete
AFTER DELETE ON group_members
BEGIN
 DELETE FROM key_envelopes WHERE conversation_id=OLD.group_id;
END;
`);

const envelopeColumns = new Set(db.pragma('table_info(key_envelopes)').map(column => column.name));
if (!envelopeColumns.has('sender_device_id')) {
  db.exec('ALTER TABLE key_envelopes ADD COLUMN sender_device_id TEXT REFERENCES device_keys(device_id) ON DELETE CASCADE');
  // Legacy envelopes cannot prove which sender device created them; fail closed.
  db.exec('DELETE FROM key_envelopes');
}

-- NEWGEN CHAT web passkey migration.
-- The web client now derives an AES-256-GCM key locally from a user-entered
-- chat passkey for each message. No conversation key/passkey is stored or
-- returned by the web API.
--
-- IMPORTANT: Existing web-prototype messages used random conversation keys
-- stored in conversation_members.encrypted_conversation_key. Clearing these
-- legacy keys makes those old messages unrecoverable unless a user has a
-- separately saved copy. Export/back up any needed legacy content BEFORE
-- running this migration. New chats created after deploying this version
-- will not store raw conversation keys.

UPDATE public.conversation_members
SET encrypted_conversation_key = NULL
WHERE encrypted_conversation_key IS NOT NULL;

COMMENT ON COLUMN public.conversation_members.encrypted_conversation_key IS
'Deprecated legacy field. Must remain NULL. Web chat passkeys and encryption keys are never sent to or stored by the server.';

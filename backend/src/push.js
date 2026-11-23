const { randomUUID } = require('node:crypto');

let messaging = null;
let initializationAttempted = false;
function getMessaging() {
  if (initializationAttempted) return messaging;
  initializationAttempted = true;
  try {
    const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
    if (!encoded) return null;
    const serviceAccount = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) return null;
    const admin = require('firebase-admin');
    const app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    messaging = app.messaging();
  } catch (error) {
    // Push is an optional capability until Firebase credentials are configured.
    // Do not log credential material or token values.
    process.stderr.write(`FCM initialization unavailable: ${error.code || error.name || 'configuration_error'}\n`);
  }
  return messaging;
}

async function sendGenericPush(userIds) {
  const uniqueIds = [...new Set(userIds)].filter(Boolean);
  if (!uniqueIds.length) return { sent: 0, skipped: true };
  const fcm = getMessaging();
  if (!fcm) return { sent: 0, skipped: true };
  const db = require('./db');
  const placeholders = uniqueIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id,token FROM push_devices WHERE user_id IN (${placeholders})`).all(...uniqueIds);
  if (!rows.length) return { sent: 0, skipped: true };
  let sent = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    try {
      const response = await fcm.sendEachForMulticast({
        tokens: batch.map(row => row.token),
        data: { kind: 'new_message', eventId: randomUUID() },
        android: { priority: 'high', ttl: 7 * 24 * 60 * 60 * 1000 }
      });
      sent += response.successCount;
      const remove = [];
      response.responses.forEach((result, index) => {
        const code = result.error && result.error.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
          remove.push(batch[index].id);
        }
      });
      if (remove.length) {
        const marks = remove.map(() => '?').join(',');
        db.prepare(`DELETE FROM push_devices WHERE id IN (${marks})`).run(...remove);
      }
    } catch (error) {
      process.stderr.write(`FCM delivery failed: ${error.code || error.name || 'delivery_error'}\n`);
    }
  }
  return { sent, skipped: false };
}

module.exports = { sendGenericPush };

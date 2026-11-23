require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID, createPublicKey } = require('node:crypto');
const { z } = require('zod');
const db = require('./db');
const { sendGenericPush } = require('./push');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be set to a random value of at least 32 characters.');
  process.exit(1);
}
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(helmet());
app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : false }));
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
const usernameSchema = z.string().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/);
// bcrypt only processes the first 72 UTF-8 bytes; reject longer inputs rather than
// silently treating different passwords as identical.
const passwordSchema = z.string().min(10).refine(value => Buffer.byteLength(value, 'utf8') <= 72, {
  message: 'Password must be at most 72 UTF-8 bytes (bcrypt limit)'
});
const SECURITY_QUESTION = 'What was the name of your first school?';
const authSchema = z.object({ username: usernameSchema, password: passwordSchema });
const registerSchema = authSchema.extend({ securityQuestion: z.literal(SECURITY_QUESTION), securityAnswer: z.string().trim().min(2).max(100) });
const encryptedSchema = z.object({ ciphertext: z.string().min(1).max(100000), nonce: z.string().min(8).max(128), salt: z.string().min(8).max(128), algorithm: z.literal('AES-256-GCM-PBKDF2-SHA256').optional(), expiresInSeconds: z.number().int().min(10).max(30*24*60*60).optional() });

function issueToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, ver: Number(user.token_version || 0) }, process.env.JWT_SECRET, { expiresIn: process.env.TOKEN_TTL || '7d', issuer: 'newgen-chat' });
}
function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'newgen-chat', algorithms: ['HS256'] });
    const current = db.prepare('SELECT id,username,token_version FROM users WHERE id=?').get(payload.sub);
    if (!current || Number(payload.ver || 0) !== Number(current.token_version || 0)) {
      return res.status(401).json({ error: 'Session expired; please log in again' });
    }
    req.user = { id: current.id, username: current.username };
    next();
  } catch { res.status(401).json({ error: 'Authentication required' }); }
}
function validate(schema, req, res) {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid request', details: parsed.error.issues.map(x => ({ path: x.path.join('.'), message: x.message })) }); return null; }
  return parsed.data;
}
function friendshipBetween(a, b) {
  return db.prepare(`SELECT * FROM friendships WHERE (from_user=? AND to_user=?) OR (from_user=? AND to_user=?)`).get(a,b,b,a);
}

app.get('/api/health', (_req,res) => res.json({ status:'ok', service:'newgen-chat-api', timestamp:Date.now() }));
app.post('/api/auth/register', authLimiter, async (req,res) => {
  const data = validate(registerSchema, req,res); if (!data) return;
  const username = data.username.toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) return res.status(409).json({ error:'Username is already taken' });
  const id = randomUUID();
  const passwordHash = await bcrypt.hash(data.password, 12);
  const securityAnswerHash = await bcrypt.hash(data.securityAnswer.normalize('NFKC').trim().toLowerCase(), 12);
  try {
    db.prepare('INSERT INTO users(id,username,password_hash,created_at,security_question,security_answer_hash) VALUES(?,?,?,?,?,?)').run(id,username,passwordHash,Date.now(),data.securityQuestion,securityAnswerHash);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error:'Username is already taken' });
    throw error;
  }
  const user = { id, username, token_version: 0 };
  res.status(201).json({ user: { id, username }, token:issueToken(user) });
});
app.post('/api/auth/login', authLimiter, async (req,res) => {
  const data = validate(authSchema, req,res); if (!data) return;
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(data.username.toLowerCase());
  if (!user || !(await bcrypt.compare(data.password,user.password_hash))) return res.status(401).json({ error:'Invalid username or password' });
  res.json({ user:{ id:user.id, username:user.username }, token:issueToken(user) });
});
app.get('/api/me', requireAuth, (req,res) => res.json({ user:req.user }));

// Device push registration. FCM tokens are sensitive routing identifiers and are
// never returned to clients or included in logs. Payloads intentionally contain no
// message text, sender, room, media URL, or ciphertext.
app.post('/api/push/token', requireAuth, (req,res) => {
  const data = validate(z.object({ token: z.string().min(20).max(4096) }), req, res);
  if (!data) return;
  const now = Date.now();
  db.prepare('DELETE FROM push_devices WHERE token=? AND user_id<>?').run(data.token, req.user.id);
  const existing = db.prepare('SELECT id FROM push_devices WHERE token=?').get(data.token);
  if (existing) {
    db.prepare('UPDATE push_devices SET user_id=?,updated_at=? WHERE id=?').run(req.user.id, now, existing.id);
  } else {
    db.prepare('INSERT INTO push_devices(id,user_id,token,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run(randomUUID(), req.user.id, data.token, now, now);
  }
  res.status(204).end();
});
app.delete('/api/push/token', requireAuth, (req,res) => {
  const data = validate(z.object({ token: z.string().min(20).max(4096) }), req, res);
  if (!data) return;
  db.prepare('DELETE FROM push_devices WHERE user_id=? AND token=?').run(req.user.id, data.token);
  res.status(204).end();
});
app.get('/api/users/search', requireAuth, (req,res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2 || q.length > 24) return res.status(400).json({ error:'Search must be 2–24 characters' });
  const escapedQuery = q.replace(/[\\%_]/g, '\\$&');
  const users = db.prepare("SELECT id,username FROM users WHERE username LIKE ? ESCAPE '\\' AND id<>? ORDER BY username LIMIT 20").all(`%${escapedQuery}%`,req.user.id);
  res.json({ users });
});
app.post('/api/friends/requests/:userId', requireAuth, (req,res) => {
  const target = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.userId);
  if (!target || target.id === req.user.id) return res.status(404).json({ error:'User not found' });
  const blocked = db.prepare('SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)').get(req.user.id,target.id,target.id,req.user.id);
  if (blocked) return res.status(403).json({ error:'This user cannot be contacted' });
  const existing = friendshipBetween(req.user.id,target.id);
  if (existing?.status === 'accepted') return res.status(409).json({ error:'Already friends' });
  if (existing?.status === 'pending') return res.status(409).json({ error:'Request already exists' });
  if (existing?.status === 'blocked') return res.status(403).json({ error:'Request not allowed' });
  if (existing?.status === 'rejected') db.prepare('DELETE FROM friendships WHERE id=?').run(existing.id);
  const now=Date.now();
  db.prepare('INSERT INTO friendships(id,from_user,to_user,status,created_at,updated_at) VALUES(?,?,? ,\'pending\',?,?)').run(randomUUID(),req.user.id,target.id,now,now);
  res.status(201).json({ status:'pending' });
});
app.get('/api/friends/requests', requireAuth, (req,res) => {
  const incoming=db.prepare(`SELECT f.id,f.from_user AS user_id,u.username,f.created_at FROM friendships f JOIN users u ON u.id=f.from_user WHERE f.to_user=? AND f.status='pending' ORDER BY f.created_at DESC`).all(req.user.id);
  const outgoing=db.prepare(`SELECT f.id,f.to_user AS user_id,u.username,f.created_at FROM friendships f JOIN users u ON u.id=f.to_user WHERE f.from_user=? AND f.status='pending' ORDER BY f.created_at DESC`).all(req.user.id);
  res.json({ incoming,outgoing });
});
app.post('/api/friends/requests/:requestId/accept', requireAuth, (req,res) => {
  const pending=db.prepare('SELECT from_user FROM friendships WHERE id=? AND to_user=? AND status=\'pending\'').get(req.params.requestId,req.user.id);
  if(!pending)return res.status(404).json({error:'Pending request not found'});
  const blocked=db.prepare('SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)').get(req.user.id,pending.from_user,pending.from_user,req.user.id);
  if(blocked)return res.status(403).json({error:'Blocked relationship'});
  const result=db.prepare(`UPDATE friendships SET status='accepted',updated_at=? WHERE id=? AND to_user=? AND status='pending'`).run(Date.now(),req.params.requestId,req.user.id);
  if (!result.changes) return res.status(404).json({ error:'Pending request not found' });
  res.json({ status:'accepted' });
});
app.post('/api/friends/requests/:requestId/reject', requireAuth, (req,res) => {
  const result=db.prepare(`UPDATE friendships SET status='rejected',updated_at=? WHERE id=? AND to_user=? AND status='pending'`).run(Date.now(),req.params.requestId,req.user.id);
  if (!result.changes) return res.status(404).json({ error:'Pending request not found' });
  res.json({ status:'rejected' });
});
app.get('/api/friends', requireAuth, (req,res) => {
  const friends=db.prepare(`SELECT u.id,u.username FROM friendships f JOIN users u ON u.id=CASE WHEN f.from_user=? THEN f.to_user ELSE f.from_user END WHERE (f.from_user=? OR f.to_user=?) AND f.status='accepted' ORDER BY u.username`).all(req.user.id,req.user.id,req.user.id);
  res.json({ friends });
});
app.post('/api/messages/:recipientId', requireAuth, (req,res) => {
  const data=validate(encryptedSchema,req,res); if(!data)return;
  const recipient=db.prepare('SELECT id FROM users WHERE id=?').get(req.params.recipientId);
  if(!recipient || !friendshipBetween(req.user.id,recipient.id) || friendshipBetween(req.user.id,recipient.id).status!=='accepted') return res.status(403).json({ error:'You must be friends before messaging' });
  const conversationId=[req.user.id,recipient.id].sort().join(':');
  const id=randomUUID(),createdAt=Date.now();
  const expiresAt=data.expiresInSeconds ? createdAt+data.expiresInSeconds*1000 : null;
  db.prepare(`INSERT INTO messages(id,conversation_id,sender_id,recipient_id,ciphertext,nonce,salt,algorithm,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id,conversationId,req.user.id,recipient.id,data.ciphertext,data.nonce,data.salt,data.algorithm||'AES-256-GCM-PBKDF2-SHA256',createdAt,expiresAt);
  void sendGenericPush([recipient.id]).catch(() => process.stderr.write('Push dispatch failed\n'));
  res.status(201).json({ message:{ id,conversationId,senderId:req.user.id,recipientId:recipient.id,ciphertext:data.ciphertext,nonce:data.nonce,salt:data.salt,algorithm:data.algorithm||'AES-256-GCM-PBKDF2-SHA256',createdAt,expiresAt } });
});

// Forward/share a message without exposing its plaintext to the server.
// The Android client MUST decrypt locally and encrypt again with the destination chat key.
// Reusing the original ciphertext is intentionally not supported because each chat has its own key.
app.post('/api/messages/:recipientId/forward', requireAuth, (req,res) => {
  const data = validate(z.object({
    sourceMessageId: z.string().uuid(),
    ciphertext: encryptedSchema.shape.ciphertext,
    nonce: encryptedSchema.shape.nonce,
    salt: encryptedSchema.shape.salt,
    algorithm: encryptedSchema.shape.algorithm
  }), req, res);
  if (!data) return;
  const source = db.prepare(
    'SELECT id,ciphertext,nonce,salt,algorithm FROM messages WHERE id=? AND (sender_id=? OR recipient_id=?)'
  ).get(data.sourceMessageId, req.user.id, req.user.id);
  if (!source) return res.status(404).json({ error: 'Source message not found' });
  if (source.ciphertext === data.ciphertext && source.nonce === data.nonce &&
      source.salt === data.salt && source.algorithm === (data.algorithm || source.algorithm)) {
    return res.status(400).json({ error: 'Forwarding requires a newly encrypted destination payload' });
  }

  const recipient = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.recipientId);
  const relation = recipient && friendshipBetween(req.user.id, recipient.id);
  if (!recipient || recipient.id === req.user.id || !relation || relation.status !== 'accepted') {
    return res.status(403).json({ error: 'You must be friends before sharing to this chat' });
  }
  const blocked = db.prepare(
    'SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)'
  ).get(req.user.id, recipient.id, recipient.id, req.user.id);
  if (blocked) return res.status(403).json({ error: 'This user cannot be contacted' });

  const id = randomUUID();
  const createdAt = Date.now();
  const conversationId = [req.user.id, recipient.id].sort().join(':');
  const algorithm = data.algorithm || 'AES-256-GCM-PBKDF2-SHA256';
  db.prepare(`INSERT INTO messages
    (id,conversation_id,sender_id,recipient_id,ciphertext,nonce,salt,algorithm,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(
      id, conversationId, req.user.id, recipient.id,
      data.ciphertext, data.nonce, data.salt, algorithm, createdAt
    );
  void sendGenericPush([recipient.id]).catch(() => process.stderr.write('Push dispatch failed\n'));
  res.status(201).json({ message: {
    id, conversationId, senderId: req.user.id, recipientId: recipient.id,
    ciphertext: data.ciphertext, nonce: data.nonce, salt: data.salt, algorithm, createdAt,
    forwarded: true
  }});
});

app.get('/api/messages/:userId', requireAuth, (req,res) => {
  const other=req.params.userId;
  const relation=friendshipBetween(req.user.id,other);
  if(!relation || relation.status!=='accepted') return res.status(403).json({ error:'Not allowed' });
  const conversationId=[req.user.id,other].sort().join(':');
  db.prepare('DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at<=?').run(Date.now());
  const messages=db.prepare(`SELECT id,conversation_id AS conversationId,sender_id AS senderId,recipient_id AS recipientId,ciphertext,nonce,salt,algorithm,created_at AS createdAt FROM messages WHERE conversation_id=? ORDER BY created_at DESC LIMIT 200`).all(conversationId).reverse();
  res.json({ messages });
});
app.post('/api/status', requireAuth, (req,res) => {
  const data=validate(encryptedSchema,req,res);if(!data)return;
  const id=randomUUID(),createdAt=Date.now(),expiresAt=createdAt+24*60*60*1000;
  db.prepare('INSERT INTO statuses(id,user_id,ciphertext,nonce,salt,expires_at,created_at) VALUES(?,?,?,?,?,?,?)').run(id,req.user.id,data.ciphertext,data.nonce,data.salt,expiresAt,createdAt);
  res.status(201).json({ status:{ id,expiresAt,createdAt } });
});
app.get('/api/status', requireAuth, (req,res) => {
  db.prepare('DELETE FROM statuses WHERE expires_at<=?').run(Date.now());
  const statuses=db.prepare(`SELECT s.id,s.user_id AS userId,u.username,s.ciphertext,s.nonce,s.salt,s.expires_at AS expiresAt,s.created_at AS createdAt FROM statuses s JOIN users u ON u.id=s.user_id WHERE s.expires_at>? AND (s.user_id=? OR EXISTS(SELECT 1 FROM friendships f WHERE f.status='accepted' AND ((f.from_user=? AND f.to_user=s.user_id) OR (f.to_user=? AND f.from_user=s.user_id)))) ORDER BY s.created_at DESC`).all(Date.now(),req.user.id,req.user.id,req.user.id);
  res.json({ statuses });
});

// Block / unblock controls. A block is directional and immediately prevents new contact.
app.post('/api/users/:userId/block', requireAuth, (req,res) => {
  const target=db.prepare('SELECT id FROM users WHERE id=?').get(req.params.userId);
  if(!target || target.id===req.user.id) return res.status(404).json({error:'User not found'});
  db.prepare('INSERT OR IGNORE INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)').run(req.user.id,target.id,Date.now());
  db.prepare("DELETE FROM friendships WHERE (from_user=? AND to_user=?) OR (from_user=? AND to_user=?)").run(req.user.id,target.id,target.id,req.user.id);
  db.prepare("DELETE FROM media_blobs WHERE (owner_id=? AND recipient_id=?) OR (owner_id=? AND recipient_id=?)").run(req.user.id,target.id,target.id,req.user.id);
  res.json({status:'blocked'});
});
app.delete('/api/users/:userId/block', requireAuth, (req,res) => {
  db.prepare('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?').run(req.user.id,req.params.userId);
  res.json({status:'unblocked'});
});
app.get('/api/blocks', requireAuth, (req,res) => {
  res.json({blocks:db.prepare('SELECT b.blocked_id AS userId,u.username,b.created_at AS createdAt FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=? ORDER BY b.created_at DESC').all(req.user.id)});
});

// Group chat: payloads remain opaque to the server; group key distribution is a client responsibility.
const groupCreateSchema=z.object({name:z.string().trim().min(1).max(64),memberIds:z.array(z.string().uuid()).max(99).default([])});
app.post('/api/groups', requireAuth, (req,res) => {
  const data=validate(groupCreateSchema,req,res);if(!data)return;
  const ids=[...new Set([req.user.id,...data.memberIds])];
  if(ids.length>1){
    const rows=db.prepare(`SELECT id FROM users WHERE id IN (${ids.slice(1).map(()=>'?').join(',')})`).all(...ids.slice(1));
    if(rows.length!==ids.length-1) return res.status(400).json({error:'One or more members do not exist'});
    for(const id of ids.slice(1)){
      const f=friendshipBetween(req.user.id,id);
      const blocked=db.prepare('SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)').get(req.user.id,id,id,req.user.id);
      if(!f || f.status!=='accepted' || blocked) return res.status(403).json({error:'Groups can only include accepted friends'});
    }
  }
  const id=randomUUID(),now=Date.now();
  const create=db.transaction(()=>{
    db.prepare('INSERT INTO groups_chat(id,name,owner_id,created_at) VALUES(?,?,?,?)').run(id,data.name,req.user.id,now);
    const add=db.prepare('INSERT INTO group_members(group_id,user_id,role,joined_at) VALUES(?,?,?,?)');
    ids.forEach((uid)=>add.run(id,uid,uid===req.user.id?'admin':'member',now));
  });
  create();res.status(201).json({group:{id,name:data.name,ownerId:req.user.id,memberIds:ids,createdAt:now}});
});
app.get('/api/groups', requireAuth, (req,res) => {
  const groups=db.prepare(`SELECT g.id,g.name,g.owner_id AS ownerId,g.created_at AS createdAt FROM groups_chat g JOIN group_members m ON m.group_id=g.id WHERE m.user_id=? ORDER BY g.created_at DESC`).all(req.user.id);
  res.json({groups});
});
app.get('/api/groups/:groupId/members', requireAuth, (req,res) => {
  const member=db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(req.params.groupId,req.user.id);
  if(!member)return res.status(403).json({error:'Not a group member'});
  res.json({members:db.prepare('SELECT u.id,u.username,m.role,m.joined_at AS joinedAt FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=? ORDER BY m.joined_at').all(req.params.groupId)});
});
app.post('/api/groups/:groupId/members', requireAuth, (req,res) => {
  const data=validate(z.object({userId:z.string().uuid()}),req,res);if(!data)return;
  const admin=db.prepare("SELECT 1 FROM group_members WHERE group_id=? AND user_id=? AND role='admin'").get(req.params.groupId,req.user.id);
  if(!admin)return res.status(403).json({error:'Group admin permission required'});
  const f=friendshipBetween(req.user.id,data.userId);
  const blocked=db.prepare('SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)').get(req.user.id,data.userId,data.userId,req.user.id);
  if(!f || f.status!=='accepted' || blocked)return res.status(403).json({error:'Only accepted friends can be added'});
  try{db.prepare("INSERT INTO group_members(group_id,user_id,role,joined_at) VALUES(?,?,'member',?)").run(req.params.groupId,data.userId,Date.now());}
  catch{return res.status(409).json({error:'User is already a member or group does not exist'});}
  res.status(201).json({status:'added'});
});
app.delete('/api/groups/:groupId/members/:userId', requireAuth, (req,res) => {
  const actor=db.prepare('SELECT role FROM group_members WHERE group_id=? AND user_id=?').get(req.params.groupId,req.user.id);
  if(!actor)return res.status(403).json({error:'Not a group member'});
  if(req.params.userId!==req.user.id && actor.role!=='admin')return res.status(403).json({error:'Group admin permission required'});
  const target=db.prepare('SELECT role FROM group_members WHERE group_id=? AND user_id=?').get(req.params.groupId,req.params.userId);
  if(!target)return res.status(404).json({error:'Member not found'});
  if(target.role==='admin'){
    const other=db.prepare("SELECT user_id FROM group_members WHERE group_id=? AND role='admin' AND user_id<>? LIMIT 1").get(req.params.groupId,req.params.userId);
    if(!other)return res.status(409).json({error:'A group must retain at least one admin'});
  }
  db.prepare('DELETE FROM group_members WHERE group_id=? AND user_id=?').run(req.params.groupId,req.params.userId);
  res.json({status:'removed'});
});
app.post('/api/groups/:groupId/messages', requireAuth, (req,res) => {
  const data=validate(encryptedSchema,req,res);if(!data)return;
  const member=db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(req.params.groupId,req.user.id);
  if(!member)return res.status(403).json({error:'Not a group member'});
  const id=randomUUID(),createdAt=Date.now(),algorithm=data.algorithm||'AES-256-GCM-PBKDF2-SHA256';
  const expiresAt=data.expiresInSeconds ? createdAt+data.expiresInSeconds*1000 : null;
  db.prepare('INSERT INTO group_messages(id,group_id,sender_id,ciphertext,nonce,salt,algorithm,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,req.params.groupId,req.user.id,data.ciphertext,data.nonce,data.salt,algorithm,createdAt,expiresAt);
  const recipients=db.prepare('SELECT user_id FROM group_members WHERE group_id=? AND user_id<>?').all(req.params.groupId,req.user.id).map(x=>x.user_id);
  void sendGenericPush(recipients).catch(() => process.stderr.write('Push dispatch failed\n'));
  res.status(201).json({message:{id,groupId:req.params.groupId,senderId:req.user.id,ciphertext:data.ciphertext,nonce:data.nonce,salt:data.salt,algorithm,createdAt,expiresAt}});
});
app.get('/api/groups/:groupId/messages', requireAuth, (req,res) => {
  const member=db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(req.params.groupId,req.user.id);
  if(!member)return res.status(403).json({error:'Not a group member'});
  db.prepare('DELETE FROM group_messages WHERE expires_at IS NOT NULL AND expires_at<=?').run(Date.now());
  const messages=db.prepare('SELECT id,group_id AS groupId,sender_id AS senderId,ciphertext,nonce,salt,algorithm,created_at AS createdAt,expires_at AS expiresAt FROM group_messages WHERE group_id=? ORDER BY created_at DESC LIMIT 200').all(req.params.groupId).reverse();
  res.json({messages});
});

// Delivery/read receipts for direct messages.
app.post('/api/messages/:messageId/delivered', requireAuth, (req,res) => {
  const r=db.prepare('UPDATE messages SET delivered_at=COALESCE(delivered_at,?) WHERE id=? AND recipient_id=?').run(Date.now(),req.params.messageId,req.user.id);
  if(!r.changes)return res.status(404).json({error:'Message not found'});
  res.json({status:'delivered'});
});
app.post('/api/messages/:messageId/read', requireAuth, (req,res) => {
  const r=db.prepare('UPDATE messages SET delivered_at=COALESCE(delivered_at,?),read_at=COALESCE(read_at,?) WHERE id=? AND recipient_id=?').run(Date.now(),Date.now(),req.params.messageId,req.user.id);
  if(!r.changes)return res.status(404).json({error:'Message not found'});
  res.json({status:'read'});
});
app.delete('/api/messages/:messageId', requireAuth, (req,res) => {
  const r=db.prepare('DELETE FROM messages WHERE id=? AND sender_id=?').run(req.params.messageId,req.user.id);
  if(!r.changes)return res.status(404).json({error:'Message not found or not owned by you'});
  res.json({status:'deleted_for_everyone'});
});

// Status detail feed for an owner or accepted friend. Replies stay encrypted at rest.
app.get('/api/status/:statusId/details', requireAuth, (req,res) => {
  const status=db.prepare('SELECT id,user_id AS userId,expires_at AS expiresAt FROM statuses WHERE id=?').get(req.params.statusId);
  if(!status || status.expiresAt<=Date.now())return res.status(404).json({error:'Status not found'});
  if(status.userId!==req.user.id){const f=friendshipBetween(req.user.id,status.userId);if(!f || f.status!=='accepted')return res.status(403).json({error:'Not allowed'});}
  const reactions=db.prepare('SELECT user_id AS userId,reaction,created_at AS createdAt FROM status_reactions WHERE status_id=? ORDER BY created_at').all(req.params.statusId);
  const replies=db.prepare('SELECT id,user_id AS userId,ciphertext,nonce,salt,created_at AS createdAt FROM status_replies WHERE status_id=? ORDER BY created_at').all(req.params.statusId);
  const views=db.prepare('SELECT COUNT(*) AS count FROM status_views WHERE status_id=?').get(req.params.statusId).count;
  res.json({status,reactions,replies,viewCount:views});
});

// Status reactions and encrypted replies; only the owner or an accepted friend can interact.
app.post('/api/status/:statusId/reactions', requireAuth, (req,res) => {
  const data=validate(z.object({reaction:z.string().min(1).max(16)}),req,res);if(!data)return;
  const status=db.prepare('SELECT user_id,expires_at FROM statuses WHERE id=?').get(req.params.statusId);
  if(!status || status.expires_at<=Date.now())return res.status(404).json({error:'Status not found'});
  if(status.user_id!==req.user.id){const f=friendshipBetween(req.user.id,status.user_id);if(!f || f.status!=='accepted')return res.status(403).json({error:'Not allowed'});}
  db.prepare('INSERT INTO status_reactions(status_id,user_id,reaction,created_at) VALUES(?,?,?,?) ON CONFLICT(status_id,user_id) DO UPDATE SET reaction=excluded.reaction,created_at=excluded.created_at').run(req.params.statusId,req.user.id,data.reaction,Date.now());
  res.json({status:'reacted'});
});
app.post('/api/status/:statusId/replies', requireAuth, (req,res) => {
  const data=validate(z.object({ciphertext:z.string().min(1).max(100000),nonce:z.string().min(8).max(128),salt:z.string().min(8).max(128)}),req,res);if(!data)return;
  const status=db.prepare('SELECT user_id,expires_at FROM statuses WHERE id=?').get(req.params.statusId);
  if(!status || status.expires_at<=Date.now())return res.status(404).json({error:'Status not found'});
  if(status.user_id!==req.user.id){const f=friendshipBetween(req.user.id,status.user_id);if(!f || f.status!=='accepted')return res.status(403).json({error:'Not allowed'});}
  const id=randomUUID(),createdAt=Date.now();
  db.prepare('INSERT INTO status_replies(id,status_id,user_id,ciphertext,nonce,salt,created_at) VALUES(?,?,?,?,?,?,?)').run(id,req.params.statusId,req.user.id,data.ciphertext,data.nonce,data.salt,createdAt);
  res.status(201).json({reply:{id,statusId:req.params.statusId,createdAt}});
});


// Account profile and account deletion.
app.get('/api/profile/:userId', requireAuth, (req,res) => {
  const user = db.prepare('SELECT id,username,created_at AS createdAt FROM users WHERE id=?').get(req.params.userId);
  if (!user) return res.status(404).json({error:'User not found'});
  const relation = req.params.userId === req.user.id ? null : friendshipBetween(req.user.id, req.params.userId);
  if (req.params.userId !== req.user.id && (!relation || relation.status !== 'accepted')) {
    return res.status(403).json({error:'Profile is visible to friends only'});
  }
  res.json({user});
});
app.delete('/api/account', requireAuth, (req,res) => {
  const result = db.prepare('DELETE FROM users WHERE id=?').run(req.user.id);
  if (!result.changes) return res.status(404).json({error:'Account not found'});
  res.json({status:'account_deleted'});
});

// One-time recovery code. Client should show it once and store it offline.
// Only a hash is stored; this is account recovery, NOT E2EE key recovery.
app.post('/api/account/recovery-code', requireAuth, (req,res) => {
  const recoveryCode = require('node:crypto').randomBytes(24).toString('base64url');
  const hash = require('node:crypto').createHash('sha256').update(recoveryCode).digest('hex');
  db.prepare('INSERT INTO account_recovery(user_id,code_hash,created_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash,created_at=excluded.created_at')
    .run(req.user.id,hash,Date.now());
  res.json({recoveryCode, warning:'Save this code offline. It is shown only once and cannot recover encrypted chat keys.'});
});
app.post('/api/account/recover-password', authLimiter, async (req,res) => {
  const data=validate(z.object({
    username:usernameSchema,
    recoveryCode:z.string().min(20).max(100).optional(),
    securityAnswer:z.string().trim().min(2).max(100).optional(),
    newPassword:passwordSchema
  }).refine(value => Boolean(value.recoveryCode) !== Boolean(value.securityAnswer), { message:'Provide exactly one recovery method' }),req,res); if(!data)return;
  const user=db.prepare('SELECT id,security_answer_hash FROM users WHERE username=?').get(data.username.toLowerCase());
  if(!user)return res.status(400).json({error:'Invalid recovery details'});
  let verified = false;
  if (data.recoveryCode) {
    const hash=require('node:crypto').createHash('sha256').update(data.recoveryCode).digest('hex');
    const saved=db.prepare('SELECT code_hash FROM account_recovery WHERE user_id=?').get(user.id);
    verified = Boolean(saved && require('node:crypto').timingSafeEqual(Buffer.from(saved.code_hash),Buffer.from(hash)));
  } else if (data.securityAnswer && user.security_answer_hash) {
    verified = await bcrypt.compare(data.securityAnswer.normalize('NFKC').trim().toLowerCase(), user.security_answer_hash);
  }
  if (!verified) return res.status(400).json({error:'Invalid recovery details'});
  const passwordHash = await bcrypt.hash(data.newPassword,12);
  // Revoke every existing access token when account credentials are recovered.
  db.prepare('UPDATE users SET password_hash=?, token_version=token_version+1 WHERE id=?').run(passwordHash,user.id);
  db.prepare('DELETE FROM account_recovery WHERE user_id=?').run(user.id);
  res.json({status:'password_reset',message:'Create a new recovery code after login.'});
});

// Encrypted media upload/download. The app encrypts media before upload; API stores only ciphertext.
// A small cap is intentional for this SQLite MVP. Use private object storage for production.
const mediaSchema=z.object({
  ciphertextB64:z.string().min(16).max(8_000_000),
  nonce:z.string().min(8).max(128),
  salt:z.string().min(8).max(128),
  mimeType:z.enum(['image/jpeg','image/png','image/webp','image/gif','video/mp4','audio/mpeg','audio/mp4','audio/ogg','application/pdf','application/octet-stream']),
  fileName:z.string().trim().min(1).max(120),
  recipientId:z.string().uuid().optional(),
  groupId:z.string().uuid().optional(),
  expiresInSeconds:z.number().int().min(0).max(30*24*60*60).optional()
}).refine(data => !(data.recipientId && data.groupId), { message:'Choose either a direct recipient or a group, not both' });
app.post('/api/media', requireAuth, (req,res) => {
  db.prepare('DELETE FROM media_blobs WHERE expires_at IS NOT NULL AND expires_at<=?').run(Date.now());
  const data=validate(mediaSchema,req,res); if(!data)return;
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(data.ciphertextB64)) return res.status(400).json({error:'Invalid base64 ciphertext'});
  const decoded=Buffer.from(data.ciphertextB64,'base64');
  if(decoded.length===0 || decoded.toString('base64')!==data.ciphertextB64) return res.status(400).json({error:'Invalid base64 ciphertext'});
  if(decoded.length>6_000_000) return res.status(413).json({error:'Encrypted media exceeds the 6 MB limit'});
  if(data.recipientId){
    const f=friendshipBetween(req.user.id,data.recipientId);
    const blocked=db.prepare('SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)').get(req.user.id,data.recipientId,data.recipientId,req.user.id);
    if(!f || f.status!=='accepted' || blocked)return res.status(403).json({error:'Media recipient must be an accepted friend'});
  }
  if(data.groupId){
    const member=db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(data.groupId,req.user.id);
    if(!member)return res.status(403).json({error:'You must be a group member to upload group media'});
  }
  const id=randomUUID(),createdAt=Date.now(),expiresAt=data.expiresInSeconds ? createdAt+data.expiresInSeconds*1000 : null;
  db.prepare(`INSERT INTO media_blobs(id,owner_id,recipient_id,group_id,ciphertext_b64,nonce,salt,mime_type,file_name,byte_length,created_at,expires_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,req.user.id,data.recipientId||null,data.groupId||null,data.ciphertextB64,data.nonce,data.salt,data.mimeType,data.fileName,decoded.length,createdAt,expiresAt);
  res.status(201).json({media:{id,mimeType:data.mimeType,fileName:data.fileName,byteLength:decoded.length,createdAt,expiresAt}});
});
app.get('/api/media/:mediaId', requireAuth, (req,res) => {
  db.prepare('DELETE FROM media_blobs WHERE expires_at IS NOT NULL AND expires_at<=?').run(Date.now());
  const media=db.prepare('SELECT * FROM media_blobs WHERE id=? AND (expires_at IS NULL OR expires_at>?)').get(req.params.mediaId,Date.now());
  if(!media)return res.status(404).json({error:'Media not found'});
  const groupMember=media.group_id && db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(media.group_id,req.user.id);
  if(media.owner_id!==req.user.id && media.recipient_id!==req.user.id && !groupMember){
    return res.status(403).json({error:'Media access not granted'});
  }
  res.json({media:{id:media.id,ciphertextB64:media.ciphertext_b64,nonce:media.nonce,salt:media.salt,mimeType:media.mime_type,fileName:media.file_name,byteLength:media.byte_length}});
});
app.delete('/api/media/:mediaId', requireAuth, (req,res) => {
  const result=db.prepare('DELETE FROM media_blobs WHERE id=? AND owner_id=?').run(req.params.mediaId,req.user.id);
  if(!result.changes)return res.status(404).json({error:'Media not found'});
  res.json({status:'deleted'});
});

// Presence and typing indicators are ephemeral hints, never authoritative delivery state.
app.post('/api/presence/heartbeat', requireAuth, (req,res) => {
  const now=Date.now();
  db.prepare(`INSERT INTO user_presence(user_id,last_seen_at,is_online) VALUES(?,?,1)
    ON CONFLICT(user_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,is_online=1`).run(req.user.id,now);
  res.json({status:'online',lastSeenAt:now});
});
app.post('/api/presence/offline', requireAuth, (req,res) => {
  const now=Date.now();
  db.prepare('UPDATE user_presence SET last_seen_at=?,is_online=0 WHERE user_id=?').run(now,req.user.id);
  res.json({status:'offline',lastSeenAt:now});
});
app.get('/api/presence/:userId', requireAuth, (req,res) => {
  const f=friendshipBetween(req.user.id,req.params.userId);
  if(req.params.userId!==req.user.id && (!f || f.status!=='accepted'))return res.status(403).json({error:'Not allowed'});
  const row=db.prepare('SELECT last_seen_at AS lastSeenAt,is_online AS isOnline FROM user_presence WHERE user_id=?').get(req.params.userId);
  if(!row)return res.json({isOnline:false,lastSeenAt:null});
  const online=Boolean(row.isOnline) && Date.now()-row.lastSeenAt<90_000;
  res.json({isOnline:online,lastSeenAt:row.lastSeenAt});
});

function canAccessTypingRoom(userId, roomKey) {
  if(roomKey.startsWith('group:')) {
    const groupId=roomKey.slice(6);
    return Boolean(db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(groupId,userId));
  }
  const parts=roomKey.split(':');
  if(parts.length!==2 || !parts.includes(userId)) return false;
  const relation=friendshipBetween(parts[0],parts[1]);
  return Boolean(relation && relation.status==='accepted');
}
app.post('/api/typing/:roomKey', requireAuth, (req,res) => {
  const roomKey=String(req.params.roomKey).slice(0,128);
  if(!canAccessTypingRoom(req.user.id,roomKey))return res.status(403).json({error:'Not allowed'});
  const active=Boolean(req.body?.active);
  if(active) db.prepare(`INSERT INTO typing_state(room_key,user_id,expires_at) VALUES(?,?,?)
    ON CONFLICT(room_key,user_id) DO UPDATE SET expires_at=excluded.expires_at`).run(roomKey,req.user.id,Date.now()+5000);
  else db.prepare('DELETE FROM typing_state WHERE room_key=? AND user_id=?').run(roomKey,req.user.id);
  res.json({status:active?'typing':'stopped'});
});
app.get('/api/typing/:roomKey', requireAuth, (req,res) => {
  const roomKey=String(req.params.roomKey).slice(0,128);
  if(!canAccessTypingRoom(req.user.id,roomKey))return res.status(403).json({error:'Not allowed'});
  const users=db.prepare('SELECT t.user_id AS userId,u.username FROM typing_state t JOIN users u ON u.id=t.user_id WHERE t.room_key=? AND t.expires_at>? AND t.user_id<>?').all(roomKey,Date.now(),req.user.id);
  res.json({users});
});

// Per-message expiry. The server purges expired payloads during history reads.
app.post('/api/messages/:messageId/expire', requireAuth, (req,res) => {
  const data=validate(z.object({expiresInSeconds:z.number().int().min(10).max(30*24*60*60)}),req,res);if(!data)return;
  const expiresAt=Date.now()+data.expiresInSeconds*1000;
  const result=db.prepare('UPDATE messages SET expires_at=? WHERE id=? AND sender_id=?').run(expiresAt,req.params.messageId,req.user.id);
  if(!result.changes)return res.status(404).json({error:'Message not found'});
  res.json({expiresAt});
});

// Status view receipts. Status owner can see viewers; other users cannot enumerate them.
app.post('/api/status/:statusId/view', requireAuth, (req,res) => {
  const status=db.prepare('SELECT user_id,expires_at FROM statuses WHERE id=?').get(req.params.statusId);
  if(!status || status.expires_at<=Date.now())return res.status(404).json({error:'Status not found'});
  if(status.user_id!==req.user.id){
    const f=friendshipBetween(req.user.id,status.user_id);
    if(!f || f.status!=='accepted')return res.status(403).json({error:'Not allowed'});
  }
  db.prepare('INSERT OR IGNORE INTO status_views(status_id,viewer_id,viewed_at) VALUES(?,?,?)').run(req.params.statusId,req.user.id,Date.now());
  res.json({status:'viewed'});
});
app.get('/api/status/:statusId/viewers', requireAuth, (req,res) => {
  const status=db.prepare('SELECT user_id,expires_at FROM statuses WHERE id=?').get(req.params.statusId);
  if(!status || status.user_id!==req.user.id)return res.status(404).json({error:'Status not found'});
  const viewers=db.prepare('SELECT u.id,u.username,v.viewed_at AS viewedAt FROM status_views v JOIN users u ON u.id=v.viewer_id WHERE v.status_id=? ORDER BY v.viewed_at').all(req.params.statusId);
  res.json({viewers});
});



// End-to-end key distribution primitives. The server stores public device keys
// and encrypted per-device key envelopes only; it never receives a private key
// or a plaintext conversation key.
const DEVICE_KEY_ALGORITHM = 'ECDH-P256-SPKI';
const ENVELOPE_ALGORITHM = 'ECDH-P256-HKDF-SHA256-AES-256-GCM';
function isCanonicalBase64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try { const decoded = Buffer.from(value, 'base64'); return decoded.length > 0 && decoded.toString('base64') === value; }
  catch { return false; }
}
function canAccessKeyConversation(userId, conversationId, otherUserId) {
  if (otherUserId) {
    if (conversationId !== [userId, otherUserId].sort().join(':')) return false;
    const relation = friendshipBetween(userId, otherUserId);
    return Boolean(relation && relation.status === 'accepted');
  }
  return Boolean(db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(conversationId, userId));
}
function canShareKeysWith(userId, otherUserId) {
  if (userId === otherUserId) return true;
  const relation = friendshipBetween(userId, otherUserId);
  if (relation?.status === 'accepted') return true;
  return Boolean(db.prepare(`SELECT 1 FROM group_members a JOIN group_members b ON a.group_id=b.group_id WHERE a.user_id=? AND b.user_id=? LIMIT 1`).get(userId, otherUserId));
}

app.put('/api/keys/devices/:deviceId', requireAuth, (req, res) => {
  const data = validate(z.object({
    publicKey: z.string().min(80).max(2048),
    algorithm: z.literal(DEVICE_KEY_ALGORITHM)
  }), req, res);
  if (!data) return;
  if (!isCanonicalBase64(data.publicKey)) return res.status(400).json({ error: 'Invalid public key encoding' });
  try {
    const key = createPublicKey({ key: Buffer.from(data.publicKey, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      return res.status(400).json({ error: 'Only P-256 ECDH public keys are supported' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid P-256 public key' });
  }
  const now = Date.now();
  const existing = db.prepare('SELECT user_id FROM device_keys WHERE device_id=?').get(req.params.deviceId);
  if (existing && existing.user_id !== req.user.id) return res.status(409).json({ error: 'Device identity is already registered' });
  db.prepare(`INSERT INTO device_keys(device_id,user_id,public_key_b64,algorithm,created_at,updated_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET
    public_key_b64=excluded.public_key_b64, algorithm=excluded.algorithm, updated_at=excluded.updated_at
    WHERE device_keys.user_id=excluded.user_id`)
    .run(req.params.deviceId, req.user.id, data.publicKey, data.algorithm, now, now);
  res.status(200).json({ deviceId: req.params.deviceId, algorithm: DEVICE_KEY_ALGORITHM, updatedAt: now });
});

app.get('/api/keys/users/:userId/devices', requireAuth, (req, res) => {
  if (!canShareKeysWith(req.user.id, req.params.userId)) return res.status(403).json({ error: 'Not allowed to view device keys' });
  const devices = db.prepare('SELECT device_id AS deviceId,public_key_b64 AS publicKey,algorithm,created_at AS createdAt,updated_at AS updatedAt FROM device_keys WHERE user_id=? ORDER BY created_at').all(req.params.userId);
  res.json({ devices });
});

app.delete('/api/keys/devices/:deviceId', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM device_keys WHERE device_id=? AND user_id=?').run(req.params.deviceId, req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Device key not found' });
  res.json({ status: 'device_key_deleted' });
});

app.put('/api/keys/conversations/:conversationId/envelopes', requireAuth, (req, res) => {
  const data = validate(z.object({
    recipientId: z.string().uuid(),
    senderDeviceId: z.string().uuid(),
    recipientDeviceId: z.string().uuid(),
    ciphertext: z.string().min(24).max(8192),
    nonce: z.string().min(16).max(64),
    algorithm: z.literal(ENVELOPE_ALGORITHM)
  }), req, res);
  if (!data) return;
  const group = db.prepare('SELECT id FROM groups_chat WHERE id=?').get(req.params.conversationId);
  if (group) {
    const senderMember = db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(group.id, req.user.id);
    const recipientMember = db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(group.id, data.recipientId);
    if (!senderMember || !recipientMember) return res.status(403).json({ error: 'Both users must be current group members' });
  } else if (!canAccessKeyConversation(req.user.id, req.params.conversationId, data.recipientId)) {
    return res.status(403).json({ error: 'Conversation access not allowed' });
  }
  if (!isCanonicalBase64(data.ciphertext) || !isCanonicalBase64(data.nonce) || Buffer.from(data.nonce, 'base64').length !== 12) {
    return res.status(400).json({ error: 'Invalid encrypted key envelope' });
  }
  const senderDevice = db.prepare('SELECT user_id FROM device_keys WHERE device_id=?').get(data.senderDeviceId);
  if (!senderDevice || senderDevice.user_id !== req.user.id) return res.status(403).json({ error: 'Sender device key not found' });
  const device = db.prepare('SELECT user_id FROM device_keys WHERE device_id=?').get(data.recipientDeviceId);
  if (!device || device.user_id !== data.recipientId) return res.status(404).json({ error: 'Recipient device key not found' });
  const existing = db.prepare('SELECT sender_id FROM key_envelopes WHERE conversation_id=? AND recipient_device_id=?')
    .get(req.params.conversationId, data.recipientDeviceId);
  if (existing && existing.sender_id !== req.user.id) return res.status(409).json({ error: 'Only the original envelope sender can replace this envelope' });
  const now = Date.now();
  db.prepare(`INSERT INTO key_envelopes(conversation_id,sender_id,sender_device_id,recipient_id,recipient_device_id,ciphertext,nonce,algorithm,created_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(conversation_id,recipient_device_id) DO UPDATE SET
    sender_device_id=excluded.sender_device_id, ciphertext=excluded.ciphertext, nonce=excluded.nonce, algorithm=excluded.algorithm, created_at=excluded.created_at
    WHERE key_envelopes.sender_id=excluded.sender_id`)
    .run(req.params.conversationId, req.user.id, data.senderDeviceId, data.recipientId, data.recipientDeviceId, data.ciphertext, data.nonce, data.algorithm, now);
  res.status(201).json({ status: 'envelope_stored', conversationId: req.params.conversationId, recipientDeviceId: data.recipientDeviceId });
});

app.get('/api/keys/conversations/:conversationId/envelopes', requireAuth, (req, res) => {
  const deviceId = String(req.query.deviceId || '');
  if (!/^[0-9a-f-]{36}$/i.test(deviceId)) return res.status(400).json({ error: 'A valid deviceId is required' });
  const device = db.prepare('SELECT user_id FROM device_keys WHERE device_id=?').get(deviceId);
  if (!device || device.user_id !== req.user.id) return res.status(403).json({ error: 'Device does not belong to this account' });
  const group = db.prepare('SELECT id FROM groups_chat WHERE id=?').get(req.params.conversationId);
  if (group) {
    if (!db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(group.id, req.user.id)) return res.status(403).json({ error: 'Not a group member' });
  } else {
    const parts = req.params.conversationId.split(':');
    if (parts.length !== 2 || !parts.includes(req.user.id) || !canAccessKeyConversation(req.user.id, req.params.conversationId, parts.find(id => id !== req.user.id))) {
      return res.status(403).json({ error: 'Conversation access not allowed' });
    }
  }
  const envelopes = db.prepare(`SELECT sender_id AS senderId,sender_device_id AS senderDeviceId,recipient_id AS recipientId,recipient_device_id AS recipientDeviceId,
    ciphertext,nonce,algorithm,created_at AS createdAt FROM key_envelopes
    WHERE conversation_id=? AND recipient_id=? AND recipient_device_id=?`)
    .all(req.params.conversationId, req.user.id, deviceId);
  res.json({ envelopes });
});

app.use((err,_req,res,_next)=>{
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error:'Malformed JSON request body' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error:'Request body is too large' });
  console.error('Request failed:',err.message);
  res.status(500).json({error:'Internal server error'});
});
const port=Number(process.env.PORT||5000),host=process.env.HOST||'127.0.0.1';
app.listen(port,host,()=>console.log(`NEWGEN CHAT API listening on http://${host}:${port}`));

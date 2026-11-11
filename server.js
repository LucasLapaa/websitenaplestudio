import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(APP_DIR, 'data'));
const ORDERS_DIR = path.join(DATA_DIR, 'pedidos');
const UPLOAD_DIR = path.join(DATA_DIR, 'anexos');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const DISCORD_TICKET_URL = /^https:\/\/(discord\.com|discordapp\.com)\/channels\/\d+\/\d+\/?$/.test(process.env.DISCORD_TICKET_URL || '') ? process.env.DISCORD_TICKET_URL : '';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const SESSION_TTL = 8 * 60 * 60 * 1000;
const sessions = new Map();
const attempts = new Map();
// Limpeza periódica dos registros de limitação de tentativas (sem manter o processo aberto).
setInterval(() => { const now = Date.now(); for (const [key, record] of attempts) if (now - record.at > 20 * 60 * 1000) attempts.delete(key); for (const [key,record] of sessions) if (record.expires < now) sessions.delete(key); }, 10 * 60 * 1000).unref();

if (ADMIN_PASSWORD.length < 12 || ADMIN_PASSWORD.length > 256) {
  console.error('[Naples Portal] Configure ADMIN_PASSWORD com 12 a 256 caracteres nas Variables do Railway.');
  process.exit(1);
}
for (const dir of [DATA_DIR, ORDERS_DIR, UPLOAD_DIR]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

const adminPasswordDigest = crypto.scryptSync(ADMIN_PASSWORD, 'naples-portal-password-v1', 64);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const statusLabels = { novo: 'Recebido', andamento: 'Em andamento', concluido: 'Concluído' };

function send(res, code, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function fail(res, code, message) { send(res, code, { error: message }); }
function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'");
}
function readJSON(req) {
  return new Promise((resolve, reject) => {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) return reject(Object.assign(new Error('Envie JSON válido.'), { code: 415 }));
    let bytes = 0; const chunks = [];
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) { reject(Object.assign(new Error('Arquivo muito grande. Limite: 5 MB.'), { code: 413 })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Dados inválidos.'), { code: 400 })); }
    });
    req.on('error', reject);
  });
}
function getIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return ((typeof forwarded === 'string' ? forwarded.split(',').at(-1).trim() : '') || req.socket.remoteAddress || 'unknown').slice(0, 100);
}
function rateLimit(req, res, scope, max, duration) {
  const key = scope + ':' + getIp(req);
  const now = Date.now(); let record = attempts.get(key);
  if (!record || now - record.at > duration) record = { at: now, n: 0 };
  record.n += 1; attempts.set(key, record);
  if (record.n > max) { fail(res, 429, 'Muitas tentativas. Aguarde alguns minutos.'); return false; }
  return true;
}
function cookies(req) {
  const result = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i > 0) result[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return result;
}
function adminSession(req) {
  const token = cookies(req).naples_admin || '';
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const record = sessions.get(hash);
  if (!record) return null;
  if (record.expires < Date.now()) { sessions.delete(hash); return null; }
  return hash;
}
function setSessionCookie(req, res, token, maxAge) {
  const secured = process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `naples_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secured ? '; Secure' : ''}`);
}
function requireAdmin(req, res) { if (!adminSession(req)) { fail(res, 401, 'Acesso restrito à moderação.'); return false; } return true; }
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
function validateImg(upload) {
  if (upload == null) return null;
  if (typeof upload !== 'object' || typeof upload.base64 !== 'string' || upload.base64.length > 7_200_000 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(upload.base64)) throw new Error('Imagem inválida.');
  const data = Buffer.from(upload.base64, 'base64');
  if (!data.length || data.length > MAX_IMAGE_BYTES) throw new Error('A imagem deve ter no máximo 5 MB.');
  const png = data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  const jpg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const webp = data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP';
  const accepted = { 'image/png': [png, 'png'], 'image/jpeg': [jpg, 'jpg'], 'image/webp': [webp, 'webp'] };
  const mime = upload.mime;
  if (!accepted[mime] || !accepted[mime][0]) throw new Error('Anexe apenas PNG, JPG ou WEBP válidos.');
  return { data, mime, ext: accepted[mime][1] };
}
function codePath(code) { return path.join(ORDERS_DIR, `${code}.json`); }
function safeCode(input) { return typeof input === 'string' && /^NPL-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(input) ? input : null; }
function makeCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'NPL-';
  // Map 5-bit chunks directly to the 32-character unambiguous alphabet.
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) code += (i === 4 ? '-' : '') + abc[bytes[i] & 31];
  return code;
}
function readOrder(code) {
  try { return JSON.parse(fs.readFileSync(codePath(code), 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}
function persistOrder(order, mode = 'w') {
  const filename = codePath(order.code);
  if (mode === 'wx') fs.writeFileSync(filename, JSON.stringify(order, null, 2), { flag: 'wx', mode: 0o600 });
  else {
    const tmp = `${filename}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(order, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, filename);
  }
}
function formatDate(d) { return new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }); }
async function webhookNotify(order) {
  if (!DISCORD_WEBHOOK_URL) return;
  if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+$/.test(DISCORD_WEBHOOK_URL)) {
    console.warn('[Naples Portal] DISCORD_WEBHOOK_URL inválida, notificação não enviada.'); return;
  }
  const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '';
  const adminUrl = publicDomain ? `\n🔐 Painel da equipe: ${publicDomain}/admin` : '\n🔐 Consulte o painel /admin do portal.';
  const payload = {
    username: 'Naples Community • Pedidos', allowed_mentions: { parse: [] },
    embeds: [{ color: 0x39f58a, title: '🟢 Novo pedido de projeto',
      description: `**Código:** \`${order.code}\`\n**Desenvolvedor:** ${order.developer}\n**Data:** ${formatDate(order.createdAt)}\n${adminUrl}\n\n*A ideia e o anexo só aparecem após login.*`,
      footer: { text: 'Naples Studios • Solicitação registrada' } }]
  };
  try {
    const reply = await fetch(DISCORD_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) });
    if (!reply.ok) console.warn('[Naples Portal] Falha ao enviar webhook Discord:', reply.status);
  } catch (e) { console.warn('[Naples Portal] Discord indisponível:', e.message); }
}
function listOrders() {
  return fs.readdirSync(ORDERS_DIR).filter(n => /^NPL-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}\.json$/.test(n)).map(name => readOrder(name.slice(0, -5))).filter(Boolean).sort((a,b)=> b.createdAt.localeCompare(a.createdAt));
}
const staticFiles = new Map([
  ['/', 'index.html'], ['/admin', 'admin.html'], ['/styles.css', 'styles.css'], ['/app.js','app.js'], ['/admin.js','admin.js'], ['/assets/favicon.svg','assets/favicon.svg'], ['/assets/naples-developers.webp','assets/naples-developers.webp']
]);
const server = http.createServer(async (req,res) => {
  securityHeaders(res);
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  const method = req.method;
  try {
    if (method === 'GET' && pathname === '/health') return send(res, 200, { ok: true, service: 'Naples Community - Portal de Projetos', version: '1.0.0' });
    if (method === 'GET' && pathname === '/api/config') return send(res, 200, { discordTicketUrl: DISCORD_TICKET_URL });
    if (method === 'GET' && staticFiles.has(pathname)) {
      const file = path.join(PUBLIC_DIR, staticFiles.get(pathname));
      const body = fs.readFileSync(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=86400' : 'no-store' });
      return res.end(body);
    }
    if (method === 'POST' && pathname === '/api/requests') {
      if (!sameOrigin(req)) return fail(res,403,'Origem inválida.');
      if (!rateLimit(req,res,'create', 8, 15*60*1000)) return;
      const data = await readJSON(req);
      const developer = data.developer;
      const discord = typeof data.discord === 'string' ? data.discord.trim() : '';
      const title = typeof data.title === 'string' ? data.title.trim() : '';
      const idea = typeof data.idea === 'string' ? data.idea.trim() : '';
      if (!['DEV NAPLES','BRADOCK'].includes(developer)) return fail(res,400,'Selecione DEV NAPLES ou BRADOCK.');
      if (!discord || discord.length > 80 || /[\x00-\x1f<>]/.test(discord)) return fail(res,400,'Informe seu usuário do Discord (até 80 caracteres).');
      if (title.length > 100) return fail(res,400,'Título muito longo.');
      if (idea.length < 20 || idea.length > 4000) return fail(res,400,'Descreva a ideia com 20 a 4.000 caracteres.');
      if (data.accepted !== true) return fail(res,400,'Aceite o envio das informações para análise.');
      let img;
      try { img = validateImg(data.image); } catch(e) { return fail(res,400,e.message); }
      let code, saved = false;
      for (let i=0; i<8; i++) { code = makeCode(); if (!fs.existsSync(codePath(code))) {saved = true; break;} }
      if (!saved) return fail(res,500,'Não foi possível gerar código único.');
      const now = new Date().toISOString();
      const order = { code, developer, discord, title, idea, createdAt: now, updatedAt:now, status:'novo', image: img ? { mime: img.mime, ext: img.ext } : null, history: [{ status:'novo', at:now }] };
      try {
        if (img) fs.writeFileSync(path.join(UPLOAD_DIR, `${code}.${img.ext}`), img.data, { flag:'wx', mode:0o600 });
        persistOrder(order, 'wx');
      } catch (err) {
        if (img) {try{fs.unlinkSync(path.join(UPLOAD_DIR, `${code}.${img.ext}`));}catch{}}
        console.error('[Naples Portal] Erro ao salvar:', err);
        return fail(res,500,'Não foi possível salvar. Tente novamente.');
      }
      // A notificação é destinada a um canal privado de equipe (opcional).
      // O ticket do cliente recebe o código quando ele usa "Copiar mensagem para o ticket".
      void webhookNotify(order);
      return send(res,201,{ code, developer, status:'novo' });
    }
    if (method === 'POST' && pathname === '/api/admin/login') {
      if (!sameOrigin(req)) return fail(res,403,'Origem inválida.');
      if (!rateLimit(req,res,'login',6,15*60*1000)) return;
      const data = await readJSON(req);
      const password = typeof data.password === 'string' ? data.password : '';
      if (!password || password.length > 256) return fail(res,401,'Senha incorreta.');
      const actual = crypto.scryptSync(password, 'naples-portal-password-v1',64);
      if (!crypto.timingSafeEqual(actual,adminPasswordDigest)) return fail(res,401,'Senha incorreta.');
      const token = crypto.randomBytes(32).toString('hex');
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      sessions.set(hash,{ expires:Date.now()+SESSION_TTL });
      setSessionCookie(req,res,token,SESSION_TTL/1000);
      return send(res,200,{ ok:true });
    }
    if (method === 'POST' && pathname === '/api/admin/logout') {
      if (!sameOrigin(req)) return fail(res,403,'Origem inválida.');
      const sess = adminSession(req); if(sess) sessions.delete(sess);
      setSessionCookie(req,res,'',0);
      return send(res,200,{ ok:true });
    }
    if (method === 'GET' && pathname === '/api/admin/me') return send(res, 200, { authenticated:!!adminSession(req) });
    if (pathname.startsWith('/api/admin/')) {
      if (!requireAdmin(req,res)) return;
      if (!sameOrigin(req)) return fail(res,403,'Origem inválida.');
      if (method === 'GET' && pathname === '/api/admin/orders') {
        const orders = listOrders().map(o=>({ code:o.code, developer:o.developer, discord:o.discord, title:o.title, ideaPreview:o.idea.slice(0,145), status:o.status, createdAt:o.createdAt, updatedAt:o.updatedAt, hasImage:!!o.image }));
        return send(res,200,{ orders });
      }
      const detailMatch = /^\/api\/admin\/orders\/(NPL-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4})(?:\/(image|status))?$/.exec(pathname);
      if (detailMatch) {
        const code = safeCode(detailMatch[1]);
        const order = code && readOrder(code);
        if (!order) return fail(res,404,'Solicitação não encontrada.');
        const suffix = detailMatch[2] || '';
        if (method === 'GET' && !suffix) return send(res,200,{ order });
        if (method === 'GET' && suffix === 'image') {
          if (!order.image) return fail(res,404,'Não há imagem neste pedido.');
          const filename = path.join(UPLOAD_DIR, `${code}.${order.image.ext}`);
          try { const body = fs.readFileSync(filename); res.writeHead(200,{ 'Content-Type':order.image.mime, 'Content-Length':body.length, 'Content-Disposition':`inline; filename="${code}.${order.image.ext}"`, 'Cache-Control':'no-store' }); return res.end(body); }
          catch { return fail(res,404,'Imagem não encontrada no armazenamento.'); }
        }
        if (method === 'PATCH' && suffix === 'status') {
          const body = await readJSON(req);
          if (!Object.hasOwn(statusLabels,body.status)) return fail(res,400,'Status inválido.');
          order.status = body.status; order.updatedAt = new Date().toISOString(); order.history.push({ status:body.status,at:order.updatedAt });
          persistOrder(order);
          return send(res,200,{ ok:true, status:body.status });
        }
        if (method === 'DELETE' && !suffix) {
          fs.unlinkSync(codePath(code));
          if (order.image) {try{fs.unlinkSync(path.join(UPLOAD_DIR,`${code}.${order.image.ext}`));}catch{}}
          return send(res,200,{ ok:true });
        }
      }
    }
    return fail(res,404,'Página não encontrada.');
  } catch (e) {
    console.error('[Naples Portal] Requisição:', e?.stack || e);
    if (!res.headersSent && !res.destroyed) return fail(res,Number.isInteger(e.code) ? e.code : 500, Number.isInteger(e.code) ? e.message : 'Erro interno. Tente novamente.');
  }
});
server.headersTimeout = 12_000;
server.requestTimeout = 20_000;
const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => console.log(`[Naples Portal] Online em 0.0.0.0:${port} | dados: ${DATA_DIR}`));

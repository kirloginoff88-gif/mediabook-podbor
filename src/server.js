// HTTP-маршрутизатор. Работает и как функция Vercel (api/index.js), и как обычный сервер (src/start.js).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { call } = require('./tg');
const { handleUpdate, WELCOME } = require('./bot');
const { handleLead } = require('./lead');

const WEBAPP = path.join(__dirname, '..', 'webapp', 'index.html');

function baseUrl(req) {
  if (config.publicUrl) return config.publicUrl;
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = String(req.headers['x-forwarded-proto'] || (host.startsWith('localhost') ? 'http' : 'https')).split(',')[0];
  return `${proto}://${host}`;
}

async function readBody(req) {
  if (req.body !== undefined) { // Vercel уже разобрал тело
    if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return Object.fromEntries(new URLSearchParams(req.body)); } }
    if (Buffer.isBuffer(req.body)) return parse(req.body.toString(), req);
    return req.body || {};
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 200000) break; chunks.push(c); }
  return parse(Buffer.concat(chunks).toString(), req);
}
function parse(raw, req) {
  if (String(req.headers['content-type'] || '').includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.statusCode = status;
  res.setHeader('content-type', type);
  res.setHeader('cache-control', 'no-store');
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const page = (title, inner) => `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 20px;color:#0d2233}input,button{font:inherit;padding:10px 14px;border-radius:10px;border:1px solid #cfd9df}button{background:#0f7c8c;color:#fff;border:0;cursor:pointer}li{margin:6px 0}.ok{color:#1f8a4c}.err{color:#b4581b}code{background:#e3f3f5;padding:1px 6px;border-radius:5px}</style></head><body>${inner}</body></html>`;

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

// Подключение бота: вебхук, кнопка меню с мини-приложением, команды, описание
async function setup(base) {
  const steps = [];
  const run = async (label, method, params) => {
    const r = await call(method, params);
    steps.push({ label, ok: !!r.ok, info: r.ok ? '' : r.description });
    return r;
  };
  const me = await run('Проверка токена', 'getMe', {});
  await run('Вебхук → ' + base + '/webhook', 'setWebhook', {
    url: base + '/webhook', secret_token: config.webhookSecret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true,
  });
  await run('Кнопка меню «Подобрать рекламу»', 'setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'Подобрать рекламу', web_app: { url: base + '/app' } },
  });
  await run('Команды бота', 'setMyCommands', {
    commands: [
      { command: 'start', description: 'Начать' },
      { command: 'plan', description: 'Подобрать рекламу' },
      { command: 'manager', description: 'Связаться с менеджером' },
    ],
  });
  await run('Описание бота', 'setMyDescription', { description: WELCOME.replace(/<[^>]+>/g, '').slice(0, 512) });
  await run('Короткое описание', 'setMyShortDescription', { short_description: 'Подбор рекламы в Сочи под ваш бизнес: носители Медиабук, охваты, заявки и бюджет.' });
  return { steps, username: me.ok ? me.result.username : null };
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  try {
    if (p === '/health') return send(res, 200, { ok: true, bot: !!config.token, managers: config.managerChats.length, b24: !!config.b24Webhook });

    if ((p === '/' || p === '/app') && req.method === 'GET') {
      return send(res, 200, fs.readFileSync(WEBAPP, 'utf8'), 'text/html; charset=utf-8');
    }

    if (p === '/webhook' && req.method === 'POST') {
      if (!config.token || !safeEqual(req.headers['x-telegram-bot-api-secret-token'] || '', config.webhookSecret)) return send(res, 401, { ok: false });
      const update = await readBody(req);
      try { await handleUpdate(update, baseUrl(req)); } catch (e) { console.error('[bot]', e); }
      return send(res, 200, { ok: true }); // Telegram всегда получает 200, иначе будет повторять
    }

    if (p === '/api/lead' && req.method === 'POST') {
      const r = await handleLead(await readBody(req));
      return send(res, r.status, r.json);
    }

    if (p === '/setup') {
      if (!config.token) return send(res, 500, page('Настройка', '<h2>Не задан TG_TOKEN</h2><p>Добавьте переменную TG_TOKEN в настройках проекта и передеплойте.</p>'), 'text/html; charset=utf-8');
      if (!config.adminPassword) return send(res, 500, page('Настройка', '<h2>Не задан ADMIN_PASSWORD</h2><p>Добавьте переменную ADMIN_PASSWORD и передеплойте.</p>'), 'text/html; charset=utf-8');
      if (req.method !== 'POST') {
        return send(res, 200, page('Подключение бота', `<h2>Подключение бота МедиаПодбор</h2><p>Адрес приложения: <code>${baseUrl(req)}</code></p>
<form method="post"><input type="password" name="password" placeholder="ADMIN_PASSWORD" required> <button>Подключить бота</button></form>`), 'text/html; charset=utf-8');
      }
      const body = await readBody(req);
      if (!safeEqual(body.password || '', config.adminPassword)) return send(res, 403, page('Ошибка', '<h2 class="err">Неверный пароль</h2><p><a href="/setup">Назад</a></p>'), 'text/html; charset=utf-8');
      const r = await setup(baseUrl(req));
      const list = r.steps.map(s => `<li class="${s.ok ? 'ok' : 'err'}">${s.ok ? '✓' : '✗'} ${s.label}${s.info ? ' — ' + s.info : ''}</li>`).join('');
      const all = r.steps.every(s => s.ok);
      return send(res, all ? 200 : 500, page('Готово', `<h2>${all ? 'Бот подключён' : 'Есть ошибки'}</h2><ul>${list}</ul>${r.username ? `<p>Откройте бота: <a href="https://t.me/${r.username}">t.me/${r.username}</a> и нажмите /start</p>` : ''}
<p>Заявки менеджерам: ${config.managerChats.length ? 'включены' : 'выключены — напишите боту /chatid в нужном чате и добавьте MANAGER_CHAT_ID'}</p>`), 'text/html; charset=utf-8');
    }

    return send(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    console.error('[server]', e);
    return send(res, 500, { ok: false, error: 'server error' });
  }
}

module.exports = { handle, setup, baseUrl };

// Минимальный клиент Telegram Bot API на встроенном fetch (Node 20+), без зависимостей.
const config = require('./config');

async function call(method, params = {}) {
  if (!config.token) throw new Error('TG_TOKEN не задан');
  const res = await fetch(`https://api.telegram.org/bot${config.token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({ ok: false, description: 'HTTP ' + res.status }));
  if (!data.ok) console.error(`[tg] ${method}: ${data.description}`);
  return data;
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const send = (chatId, text, extra = {}) =>
  call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

module.exports = { call, send, esc };

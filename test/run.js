// Тесты без сети: fetch к Telegram и Битрикс24 подменяется заглушкой.
const test = require('node:test');
const assert = require('node:assert');
const { Readable } = require('stream');

process.env.TG_TOKEN = '123456:TEST_TOKEN';
process.env.ADMIN_PASSWORD = 'secret-pass';
process.env.MANAGER_CHAT_ID = '-100777';
process.env.B24_WEBHOOK = 'https://demo.bitrix24.ru/rest/1/abc';

const calls = [];
global.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body || '{}');
  calls.push({ url, body });
  if (url.includes('bitrix24')) return { ok: true, status: 200, json: async () => ({ result: 4242 }) };
  if (url.endsWith('/getMe')) return { ok: true, status: 200, json: async () => ({ ok: true, result: { username: 'mediabook_test_bot' } }) };
  return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
};

const config = require('../src/config');
const server = require('../src/server');
const { sign, validate } = require('../src/initdata');
const lead = require('../src/lead');

function req(method, url, { body, headers = {}, form } = {}) {
  const raw = form ? new URLSearchParams(form).toString() : body ? JSON.stringify(body) : '';
  const r = Readable.from([Buffer.from(raw)]);
  r.method = method; r.url = url;
  r.headers = Object.assign({ host: 'podbor.example.ru', 'x-forwarded-proto': 'https', 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' }, headers);
  return r;
}
function call(r) {
  return new Promise(resolve => {
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }); } };
    server.handle(r, res);
  });
}
const tgCalls = m => calls.filter(c => c.url.endsWith('/' + m));
const initData = (user = { id: 555, first_name: 'Ольга', username: 'olga_sochi' }) =>
  sign({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user), query_id: 'AAA' }, config.token);

const PLAN = {
  profile: 'Клиника / стоматология\nРайоны: Адлер', skipped: '', dur: 3, src: 'qr_adler',
  channels: [{ name: 'Сити-форматы и пиллары на остановках', units: '3 × 1 сторона', cost: 15000, contacts: 360000, leads: 4.3 },
             { name: 'Листовки в почтовые ящики', units: '6 × 1 000 листовок', cost: 18000, contacts: 6000, leads: 21 }],
  totals: { cost: 33000, contacts: 366000, lo: 17, hi: 33, cpl: 1309, one: 3500 },
};

test('health и мини-приложение отдаются', async () => {
  const h = await call(req('GET', '/health'));
  assert.equal(h.status, 200);
  assert.deepEqual(JSON.parse(h.body), { ok: true, bot: true, managers: 1, b24: true });
  const app = await call(req('GET', '/app?src=qr'));
  assert.equal(app.status, 200);
  assert.match(app.body, /telegram-web-app\.js/);
  assert.match(app.body, /МедиаПодбор/);
});

test('проверка подписи initData', () => {
  assert.ok(validate(initData(), config.token));
  assert.equal(validate(initData(), 'other:token'), null);
  const forged = new URLSearchParams(initData()); forged.set('user', JSON.stringify({ id: 1, first_name: 'Мария' }));
  assert.equal(validate(forged.toString(), config.token), null);
});

test('вебхук без секрета отклоняется', async () => {
  const r = await call(req('POST', '/webhook', { body: { message: { chat: { id: 1 }, text: '/start' } } }));
  assert.equal(r.status, 401);
});

test('/start присылает кнопку мини-приложения с источником', async () => {
  calls.length = 0;
  const r = await call(req('POST', '/webhook', {
    headers: { 'x-telegram-bot-api-secret-token': config.webhookSecret },
    body: { message: { chat: { id: 10, type: 'private' }, from: { id: 10 }, text: '/start qr_adler' } },
  }));
  assert.equal(r.status, 200);
  const m = tgCalls('sendMessage')[0].body;
  assert.equal(m.chat_id, 10);
  assert.equal(m.reply_markup.inline_keyboard[0][0].web_app.url, 'https://podbor.example.ru/app?src=qr_adler');
});

test('вопрос в чате уходит менеджеру, контакт — тоже', async () => {
  calls.length = 0;
  const hdr = { 'x-telegram-bot-api-secret-token': config.webhookSecret };
  await call(req('POST', '/webhook', { headers: hdr, body: { message: { chat: { id: 11, type: 'private' }, from: { id: 11, first_name: 'Иван' }, text: 'Сколько стоит лифт?' } } }));
  assert.ok(tgCalls('sendMessage').some(c => c.body.chat_id === '-100777' && /Сколько стоит лифт/.test(c.body.text)));
  calls.length = 0;
  await call(req('POST', '/webhook', { headers: hdr, body: { message: { chat: { id: 11, type: 'private' }, from: { id: 11 }, contact: { phone_number: '+79990001122' } } } }));
  assert.ok(tgCalls('sendMessage').some(c => c.body.chat_id === '-100777' && /\+79990001122/.test(c.body.text)));
});

test('заявка: клиенту план, менеджеру карточка, лид в Битрикс24', async () => {
  calls.length = 0; lead._recent.clear();
  const r = await call(req('POST', '/api/lead', { body: { initData: initData(), plan: { ...PLAN, phone: '+7 999 000-11-22' } } }));
  assert.equal(r.status, 200, r.body);
  assert.equal(JSON.parse(r.body).leadId, 4242);
  const sends = tgCalls('sendMessage');
  const toUser = sends.find(c => c.body.chat_id === 555), toMgr = sends.find(c => c.body.chat_id === '-100777');
  assert.ok(toUser && /Ваш медиаплан/.test(toUser.body.text) && /33\s000 ₽/.test(toUser.body.text));
  assert.ok(toMgr && /Лид в Битрикс24: #4242/.test(toMgr.body.text) && /qr_adler/.test(toMgr.body.text) && /@olga_sochi/.test(toMgr.body.text));
  const b24 = calls.find(c => c.url.includes('crm.lead.add'));
  assert.equal(b24.body.fields.OPPORTUNITY, 33000 * 3 + 3500);
  assert.equal(b24.body.fields.PHONE[0].VALUE, '+7 999 000-11-22');
});

test('заявка: повтор, подделка и мусор отклоняются', async () => {
  const again = await call(req('POST', '/api/lead', { body: { initData: initData(), plan: PLAN } }));
  assert.equal(again.status, 429);
  const fake = await call(req('POST', '/api/lead', { body: { initData: sign({ auth_date: String(Math.floor(Date.now() / 1000)), user: '{"id":1}' }, 'evil:token'), plan: PLAN } }));
  assert.equal(fake.status, 401);
  lead._recent.clear();
  const empty = await call(req('POST', '/api/lead', { body: { initData: initData(), plan: { channels: [] } } }));
  assert.equal(empty.status, 400);
  const x = lead.clean({ channels: [{ name: '<script>', cost: -5, contacts: 'abc' }], phone: '+7<b>999' });
  assert.equal(x.channels[0].cost, 0);
  assert.equal(x.phone, '+7999');
  assert.match(lead.planText(x), /&lt;script&gt;/);
});

test('/setup: пароль обязателен, затем бот настраивается', async () => {
  const form = await call(req('GET', '/setup'));
  assert.equal(form.status, 200);
  const bad = await call(req('POST', '/setup', { form: { password: 'nope' } }));
  assert.equal(bad.status, 403);
  calls.length = 0;
  const ok = await call(req('POST', '/setup', { form: { password: 'secret-pass' } }));
  assert.equal(ok.status, 200, ok.body);
  assert.match(ok.body, /t\.me\/mediabook_test_bot/);
  const wh = tgCalls('setWebhook')[0].body;
  assert.equal(wh.url, 'https://podbor.example.ru/webhook');
  assert.equal(wh.secret_token, config.webhookSecret);
  assert.equal(tgCalls('setChatMenuButton')[0].body.menu_button.web_app.url, 'https://podbor.example.ru/app');
  assert.ok(tgCalls('setMyCommands').length && tgCalls('setMyDescription').length);
});

test('токен не попадает ни в мини-приложение, ни в ответы', async () => {
  const app = await call(req('GET', '/app'));
  assert.ok(!app.body.includes('TEST_TOKEN'));
  const h = await call(req('GET', '/health'));
  assert.ok(!h.body.includes('TEST_TOKEN'));
});

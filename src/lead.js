// Заявка из мини-приложения: проверяем подпись Telegram, пишем клиенту и менеджерам, создаём лид в Битрикс24.
const config = require('./config');
const { send, esc } = require('./tg');
const { validate } = require('./initdata');
const { notifyManagers, who } = require('./bot');

const recent = new Map(); // защита от повторных нажатий: не чаще раза в 30 секунд с одного пользователя

const str = (v, n = 200) => String(v ?? '').slice(0, n);
const numv = v => (Number.isFinite(+v) ? Math.max(0, +v) : 0);
const rub = n => Math.round(numv(n)).toLocaleString('ru-RU') + ' ₽';
const big = n => (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' млн' : n >= 1e4 ? Math.round(n / 1000) + ' тыс.' : String(Math.round(n)));

// Приводим присланный план к безопасному виду: только ожидаемые поля и ограниченная длина
function clean(plan) {
  const p = plan && typeof plan === 'object' ? plan : {};
  const t = p.totals || {};
  return {
    profile: str(p.profile, 1500),
    skipped: str(p.skipped, 600),
    phone: str(p.phone, 30).replace(/[^\d+()\- ]/g, ''),
    src: str(p.src, 64).replace(/[^\w\-.]/g, ''),
    dur: Math.min(24, numv(p.dur)) || 1,
    channels: (Array.isArray(p.channels) ? p.channels : []).slice(0, 8).map(c => ({
      name: str(c.name, 120), units: str(c.units, 200), cost: numv(c.cost), contacts: numv(c.contacts), leads: numv(c.leads),
    })),
    totals: { cost: numv(t.cost), contacts: numv(t.contacts), lo: numv(t.lo), hi: numv(t.hi), cpl: numv(t.cpl), one: numv(t.one) },
  };
}

function planText(p) {
  const lines = p.channels.map((c, i) =>
    `${i + 1}. ${esc(c.name)} — ${rub(c.cost)}/мес, ${big(c.contacts)} контактов, ~${c.leads.toFixed(1).replace('.', ',')} заявки\n   <i>${esc(c.units)}</i>`);
  return lines.join('\n') +
    `\n\n<b>Итого:</b> ${rub(p.totals.cost)}/мес · ${big(p.totals.contacts)} контактов · ${p.totals.lo}–${p.totals.hi} заявок/мес · заявка ≈ ${rub(p.totals.cpl)}` +
    (p.totals.one ? `\nРазово (печать, ролики): ${rub(p.totals.one)}` : '') +
    `\nСрок: ${p.dur} мес · вся кампания ≈ ${rub(p.totals.cost * p.dur + p.totals.one)}`;
}

async function toBitrix(p, user) {
  if (!config.b24Webhook) return null;
  const name = user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : '';
  const fields = {
    TITLE: 'МедиаПодбор: ' + (p.profile.split('\n')[0] || 'заявка из Telegram').slice(0, 180),
    NAME: name || 'Клиент из Telegram',
    SOURCE_DESCRIPTION: 'Telegram-бот МедиаПодбор' + (p.src ? ' · ' + p.src : ''),
    OPPORTUNITY: Math.round(p.totals.cost * p.dur + p.totals.one),
    CURRENCY_ID: 'RUB',
    COMMENTS: (p.profile + '\n\n' + planText(p)).replace(/<[^>]+>/g, '').replace(/\n/g, '<br>'),
  };
  if (p.phone) fields.PHONE = [{ VALUE: p.phone, VALUE_TYPE: 'WORK' }];
  if (user && user.username) fields.IM = [{ VALUE: 'https://t.me/' + user.username, VALUE_TYPE: 'TELEGRAM' }];
  try {
    const res = await fetch(config.b24Webhook + 'crm.lead.add.json', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields }),
    });
    const data = await res.json();
    return data.result || null;
  } catch (e) {
    console.error('[b24]', e.message);
    return null;
  }
}

async function handleLead(body) {
  const auth = validate(body && body.initData, config.token);
  if (!auth || !auth.user) return { status: 401, json: { ok: false, error: 'Откройте подбор из Telegram-бота' } };
  const u = auth.user;
  const last = recent.get(u.id) || 0;
  if (Date.now() - last < 30000) return { status: 429, json: { ok: false, error: 'Заявка уже отправлена' } };
  recent.set(u.id, Date.now());

  const p = clean(body.plan);
  if (!p.channels.length) return { status: 400, json: { ok: false, error: 'Пустой медиаплан' } };
  if (!p.src && auth.startParam) p.src = auth.startParam.slice(0, 64);

  const leadId = await toBitrix(p, u);
  await notifyManagers(
    '<b>Новая заявка из МедиаПодбора</b>\n' + who(u) + (p.phone ? '\nТелефон: ' + esc(p.phone) : '') +
    (p.src ? '\nИсточник: ' + esc(p.src) : '') + (leadId ? '\nЛид в Битрикс24: #' + leadId : '') +
    '\n\n' + esc(p.profile) + (p.skipped ? '\n<i>Пропущено: ' + esc(p.skipped) + '</i>' : '') +
    '\n\n' + planText(p)
  );
  await send(u.id,
    '<b>Ваш медиаплан</b>\n\n' + planText(p) +
    `\n\nЗаявку получил менеджер Медиабук, ${esc(config.managerName)} свяжется с вами в рабочее время и подтвердит цены и свободные поверхности. Телефон офиса: ${esc(config.managerPhone)}`
  );
  return { status: 200, json: { ok: true, leadId } };
}

module.exports = { handleLead, clean, planText, _recent: recent };

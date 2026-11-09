// Обработка обновлений Telegram (вебхук).
const config = require('./config');
const { call, send, esc } = require('./tg');

const appUrl = (base, src) => base + '/app' + (src ? '?src=' + encodeURIComponent(src) : '');

const mainKeyboard = (base, src) => ({
  inline_keyboard: [
    [{ text: 'Подобрать рекламу', web_app: { url: appUrl(base, src) } }],
    [{ text: 'Связаться с менеджером', callback_data: 'manager' }],
  ],
});

const contactKeyboard = {
  keyboard: [[{ text: 'Отправить номер телефона', request_contact: true }], [{ text: 'Отмена' }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

const WELCOME =
  '<b>МедиаПодбор от Медиабук</b>\n\n' +
  'Подберу рекламу в Сочи под ваш бизнес за 2 минуты: район, аудитория, бюджет. ' +
  'Покажу, какие носители подойдут, сколько будет контактов и заявок и сколько это стоит.\n\n' +
  'В подборе 37 офлайн-направлений Медиабук: наружка, лифты и подъезды, транспорт, ТРЦ, отели, курорты.';

async function notifyManagers(text) {
  for (const chat of config.managerChats) await send(chat, text);
}

function who(u) {
  if (!u) return 'неизвестно';
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
  return esc(name || 'без имени') + (u.username ? ' (@' + esc(u.username) + ')' : '') + ' · id ' + u.id;
}

async function askContact(chatId) {
  await send(chatId, 'Оставьте номер, и менеджер Медиабук свяжется с вами в рабочее время. Можно просто написать вопрос сюда.', {
    reply_markup: contactKeyboard,
  });
}

async function handleUpdate(update, base) {
  if (update.callback_query) {
    const q = update.callback_query;
    await call('answerCallbackQuery', { callback_query_id: q.id });
    if (q.data === 'manager') await askContact(q.message.chat.id);
    return;
  }
  const m = update.message;
  if (!m || !m.chat) return;
  const chatId = m.chat.id;
  const text = (m.text || '').trim();

  if (m.contact) {
    const c = m.contact;
    await notifyManagers(
      '<b>Запрос связи из бота МедиаПодбор</b>\n' + who(m.from) + '\nТелефон: ' + esc(c.phone_number)
    );
    await send(chatId, `Спасибо! ${esc(config.managerName)} свяжется с вами в рабочее время. Телефон офиса: ${esc(config.managerPhone)}`, {
      reply_markup: { remove_keyboard: true },
    });
    return;
  }
  if (text.startsWith('/start')) {
    const src = text.split(' ')[1] || '';
    await send(chatId, WELCOME, { reply_markup: mainKeyboard(base, src) });
    return;
  }
  if (text === '/plan') {
    await send(chatId, 'Нажмите кнопку, чтобы открыть подбор:', { reply_markup: mainKeyboard(base) });
    return;
  }
  if (text === '/manager') return askContact(chatId);
  if (text === '/chatid') {
    await send(chatId, `ID этого чата: <code>${chatId}</code>\nУкажите его в переменной MANAGER_CHAT_ID, чтобы сюда приходили заявки.`);
    return;
  }
  if (text === 'Отмена') {
    await send(chatId, 'Хорошо. Подбор всегда доступен по кнопке меню.', { reply_markup: { remove_keyboard: true } });
    return;
  }
  // Вопрос в свободной форме — пересылаем менеджерам (только из личных чатов)
  if (text && m.chat.type === 'private') {
    if (config.managerChats.length) {
      await notifyManagers('<b>Вопрос из бота МедиаПодбор</b>\n' + who(m.from) + '\n\n' + esc(text.slice(0, 3000)));
      await send(chatId, 'Передал вопрос менеджеру, ответим в рабочее время. А пока можно посмотреть подбор:', {
        reply_markup: mainKeyboard(base),
      });
    } else {
      await send(chatId, 'Чтобы подобрать рекламу, нажмите кнопку ниже:', { reply_markup: mainKeyboard(base) });
    }
  }
}

module.exports = { handleUpdate, notifyManagers, who, mainKeyboard, WELCOME };

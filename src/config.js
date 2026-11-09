// Настройки берутся только из переменных окружения. Токены в код и в git не попадают.
const crypto = require('crypto');

const env = process.env;
const token = (env.TG_TOKEN || '').trim();

module.exports = {
  token,
  // Пароль для страницы /setup (подключение бота). Без него настройка недоступна.
  adminPassword: (env.ADMIN_PASSWORD || '').trim(),
  // Куда слать заявки: id чата менеджеров (можно несколько через запятую). Узнать id — команда /chatid в боте.
  managerChats: (env.MANAGER_CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean),
  // Входящий вебхук Битрикс24, например https://company.bitrix24.ru/rest/1/abc123/ — по желанию
  b24Webhook: (env.B24_WEBHOOK || '').trim().replace(/\/?$/, '/'),
  // Публичный адрес. На Vercel можно не задавать — определяется по запросу.
  publicUrl: (env.PUBLIC_URL || '').trim().replace(/\/$/, ''),
  // Секрет вебхука выводится из токена: Telegram присылает его в заголовке, чужие запросы отбрасываются
  webhookSecret: token ? crypto.createHash('sha256').update('webhook:' + token).digest('hex').slice(0, 48) : '',
  managerName: env.MANAGER_NAME || 'Анна',
  managerPhone: env.MANAGER_PHONE || '+7 (918) 918-03-40',
};
if (module.exports.b24Webhook === '/') module.exports.b24Webhook = '';

// Запуск обычным сервером (VPS, Timeweb App Platform, локально): node src/start.js
const http = require('http');
const server = require('./server');

const port = +process.env.PORT || 3000;
http.createServer((req, res) => server.handle(req, res)).listen(port, () => {
  console.log(`МедиаПодбор слушает порт ${port}. Подключение бота: /setup`);
});

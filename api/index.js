// Точка входа на Vercel: все адреса (/, /app, /webhook, /api/lead, /setup, /health) ведут сюда.
const server = require('../src/server');

module.exports = (req, res) => server.handle(req, res);

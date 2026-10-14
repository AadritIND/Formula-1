// Dual-purpose entry point.
//
//   * On Vercel the project is deployed as a Node serverless function, so this
//     file simply exports the shared request handler.
//   * Running it directly (`npm start` / `node server.js`) starts a normal HTTP
//     server for local development.
//
// Both paths share lib/handler.js, so local and production behaviour match.

const { handler } = require('./lib/handler');

module.exports = handler;

if (require.main === module) {
  const http = require('node:http');
  const PORT = Number(process.env.PORT || 3000);
  http.createServer(handler).listen(PORT, '0.0.0.0', () => {
    console.log(`APEX is running at http://localhost:${PORT}`);
  });
}

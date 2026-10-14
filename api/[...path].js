// Vercel serverless entry point. Every /api/* request is routed here and
// handled by the shared handler, so the API stays identical to local dev.
const { handler } = require('../lib/handler');

module.exports = handler;

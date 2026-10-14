const http = require('node:http');
const { handler } = require('./lib/handler');

const PORT = Number(process.env.PORT || 3000);

const server = http.createServer(handler);
server.listen(PORT, '0.0.0.0', () => console.log(`APEX is running at http://localhost:${PORT}`));

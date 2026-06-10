const http = require('http');

const PORT = process.env.PORT || 3000;
const VERSION = process.env.APP_VERSION || '1.0.0';

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`Hello from CI/CD pipeline! Version ${VERSION}\nServed by: ${process.env.HOSTNAME || 'local'}\n`);
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT} (version ${VERSION})`);
});

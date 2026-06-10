const http = require('http');
const { spawn } = require('child_process');

const PORT = 3001;
const child = spawn('node', ['app.js'], { env: { ...process.env, PORT } });

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    console.log(`  ok  ${name}`);
    passed++;
  } else {
    console.log(`  FAIL  ${name}`);
    failed++;
  }
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}${path}`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

setTimeout(async () => {
  try {
    const root = await get('/');
    check('GET / returns 200', root.status === 200);
    check('GET / body mentions CI/CD', root.body.includes('CI/CD'));

    const health = await get('/health');
    check('GET /health returns 200', health.status === 200);
    check('GET /health returns ok status', health.body.includes('ok'));

    console.log(`\n${passed} passed, ${failed} failed`);
    child.kill();
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error('Test runner error:', err);
    child.kill();
    process.exit(1);
  }
}, 500);

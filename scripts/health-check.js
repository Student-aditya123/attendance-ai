#!/usr/bin/env node
/**
 * scripts/health-check.js
 * Run: node scripts/health-check.js
 * Checks all three services are alive before you start working.
 */
const http = require('http');

const services = [
  { name: 'Backend API',    url: 'http://localhost:3000/health' },
  { name: 'AI Service',     url: 'http://localhost:8000/health' },
  { name: 'Frontend (Vite)',url: 'http://localhost:5173'        },
];

const c = {
  green:'\x1b[32m', red:'\x1b[31m', yellow:'\x1b[33m',
  bold:'\x1b[1m',   reset:'\x1b[0m', dim:'\x1b[2m',
};

console.log(`\n${c.bold}AttendanceAI — Service Health Check${c.reset}\n`);

function check(service) {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.get(service.url, (res) => {
      const ms = Date.now() - start;
      if (res.statusCode >= 200 && res.statusCode < 400) {
        console.log(`  ${c.green}✓${c.reset} ${service.name.padEnd(20)} ${c.green}UP${c.reset} ${c.dim}(${ms}ms)${c.reset}`);
      } else {
        console.log(`  ${c.yellow}⚠${c.reset} ${service.name.padEnd(20)} ${c.yellow}HTTP ${res.statusCode}${c.reset}`);
      }
      resolve(res.statusCode < 400);
    });
    req.on('error', () => {
      console.log(`  ${c.red}✗${c.reset} ${service.name.padEnd(20)} ${c.red}DOWN${c.reset} — not running`);
      resolve(false);
    });
    req.setTimeout(3000, () => {
      req.destroy();
      console.log(`  ${c.red}✗${c.reset} ${service.name.padEnd(20)} ${c.red}TIMEOUT${c.reset}`);
      resolve(false);
    });
  });
}

async function main() {
  const results = await Promise.all(services.map(check));
  const allOk   = results.every(Boolean);

  console.log('');
  if (allOk) {
    console.log(`  ${c.green}${c.bold}All services running ✓${c.reset}`);
    console.log(`  ${c.dim}Open: http://localhost:5173${c.reset}\n`);
  } else {
    console.log(`  ${c.yellow}Some services are not running.${c.reset}`);
    console.log(`  ${c.dim}Run: npm run dev${c.reset}\n`);
  }
}

main();

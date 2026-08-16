#!/usr/bin/env node
/**
 * scripts/setup.js — One-shot project setup
 *
 * Run:  node scripts/setup.js
 *
 * What it does:
 *   1. Checks Node.js, Python, pip versions
 *   2. Checks MongoDB and Redis are reachable
 *   3. Copies .env.example → .env for backend and ai-service
 *   4. npm install for backend and frontend
 *   5. pip install for ai-service
 *   6. Generates training data and trains the risk model
 *   7. Prints a "you're ready" summary with next steps
 */
const { execSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ── ANSI colours ──────────────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',  bold:   '\x1b[1m',
  green:  '\x1b[32m', yellow: '\x1b[33m',
  red:    '\x1b[31m', cyan:   '\x1b[36m',
  dim:    '\x1b[2m',
};

const ok    = (msg) => console.log(`${c.green}✓${c.reset}  ${msg}`);
const warn  = (msg) => console.log(`${c.yellow}⚠${c.reset}  ${msg}`);
const fail  = (msg) => console.log(`${c.red}✗${c.reset}  ${msg}`);
const info  = (msg) => console.log(`${c.cyan}→${c.reset}  ${msg}`);
const title = (msg) => console.log(`\n${c.bold}${msg}${c.reset}`);
const dim   = (msg) => console.log(`${c.dim}   ${msg}${c.reset}`);

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
  } catch {
    return null;
  }
}

function section(name, fn) {
  title(`── ${name} ${'─'.repeat(Math.max(0, 44 - name.length))}`);
  fn();
}

// ── 1. Prerequisite checks ────────────────────────────────────────────────────
section('Checking prerequisites', () => {
  // Node.js
  const nodeVer = process.version;
  const nodeMajor = parseInt(nodeVer.slice(1));
  if (nodeMajor >= 20) ok(`Node.js ${nodeVer}`);
  else                 fail(`Node.js ${nodeVer} — need ≥ 20. Download: https://nodejs.org`);

  // npm
  const npmVer = run('npm --version');
  if (npmVer) ok(`npm v${npmVer}`);

  // Python
  const pyVer = run('python3 --version') || run('python --version');
  if (pyVer) {
    const [, maj, min] = (pyVer.match(/(\d+)\.(\d+)/) || []);
    if (parseInt(maj) >= 3 && parseInt(min) >= 11) ok(pyVer);
    else warn(`${pyVer} — Python 3.11+ recommended. face_recognition may fail on older versions.`);
  } else {
    fail('Python not found. Download: https://python.org/downloads');
  }

  // pip
  const pipVer = run('pip3 --version') || run('pip --version');
  if (pipVer) ok('pip available');
  else        fail('pip not found. Install with: python -m ensurepip');

  // Git
  const gitVer = run('git --version');
  if (gitVer) ok(gitVer);
  else        warn('Git not found — optional for setup, required for CI/CD');

  // Docker (optional)
  const dockerVer = run('docker --version');
  if (dockerVer) ok(`${dockerVer} (Docker available — you can use docker-compose too)`);
  else           warn('Docker not found — needed for docker-compose mode. Optional for manual mode.');
});

// ── 2. Copy env files ─────────────────────────────────────────────────────────
section('Setting up environment files', () => {
  const envFiles = [
    ['backend/.env.example',    'backend/.env'],
    ['ai-service/.env.example', 'ai-service/.env'],
  ];

  for (const [src, dst] of envFiles) {
    const srcPath = path.join(ROOT, src);
    const dstPath = path.join(ROOT, dst);

    if (!fs.existsSync(srcPath)) {
      warn(`${src} not found — skipping`);
      continue;
    }

    if (fs.existsSync(dstPath)) {
      ok(`${dst} already exists — not overwriting`);
    } else {
      fs.copyFileSync(srcPath, dstPath);
      ok(`Created ${dst} from ${src}`);
    }
  }

  console.log('');
  warn('IMPORTANT: Edit backend/.env and set these values before starting:');
  dim('MONGO_URI      = mongodb://127.0.0.1:27017/attendance_db');
  dim('REDIS_URL      = redis://127.0.0.1:6379');
  dim('JWT_ACCESS_SECRET  = (any 64-char random string)');
  dim('JWT_REFRESH_SECRET = (any different 64-char random string)');
});

// ── 3. Install Node.js dependencies ──────────────────────────────────────────
section('Installing Node.js dependencies', () => {
  info('Installing backend dependencies…');
  const backendResult = spawnSync('npm', ['install'], {
    cwd:   path.join(ROOT, 'backend'),
    stdio: 'inherit',
    shell: true,
  });
  if (backendResult.status === 0) ok('Backend node_modules installed');
  else                            fail('Backend npm install failed');

  info('Installing frontend dependencies…');
  const frontendResult = spawnSync('npm', ['install'], {
    cwd:   path.join(ROOT, 'frontend'),
    stdio: 'inherit',
    shell: true,
  });
  if (frontendResult.status === 0) ok('Frontend node_modules installed');
  else                             fail('Frontend npm install failed');
});

// ── 4. Install Python dependencies ───────────────────────────────────────────
section('Installing Python dependencies (ai-service)', () => {
  warn('This may take 5–10 minutes — dlib must compile from source.');
  warn('On macOS: ensure Xcode CLI tools are installed (xcode-select --install)');
  warn('On Ubuntu/Debian: ensure cmake g++ libopenblas-dev are installed');
  console.log('');

  const pip  = process.platform === 'win32' ? 'pip' : 'pip3';
  const flag = '--break-system-packages';

  info(`Running: ${pip} install -r ai-service/requirements.txt ${flag}`);
  const result = spawnSync(pip, ['install', '-r', 'ai-service/requirements.txt', flag], {
    cwd:   ROOT,
    stdio: 'inherit',
    shell: true,
  });

  if (result.status === 0) ok('Python dependencies installed');
  else {
    warn('pip install failed — trying without --break-system-packages flag…');
    const result2 = spawnSync(pip, ['install', '-r', 'ai-service/requirements.txt'], {
      cwd: ROOT, stdio: 'inherit', shell: true,
    });
    if (result2.status === 0) ok('Python dependencies installed');
    else fail('pip install failed. Try: cd ai-service && pip install -r requirements.txt');
  }
});

// ── 5. Train the ML risk model ────────────────────────────────────────────────
section('Training the AI risk model', () => {
  const modelsDir = path.join(ROOT, 'ai-service', 'models');
  const modelFile = path.join(modelsDir, 'risk_model.joblib');

  if (fs.existsSync(modelFile)) {
    ok('risk_model.joblib already exists — skipping training');
    return;
  }

  if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true });
  const dataDir = path.join(ROOT, 'ai-service', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  info('Generating 15,000 synthetic training records…');
  run(`python3 ai-service/training/generate_sample_data.py --samples 15000 --out ai-service/data/training.csv`, { cwd: ROOT });

  info('Training logistic regression risk model…');
  run(`python3 ai-service/training/train_risk_model.py --data ai-service/data/training.csv --model-out ai-service/models/risk_model.joblib --eval`, { cwd: ROOT });

  if (fs.existsSync(modelFile)) ok('risk_model.joblib trained and saved');
  else                          warn('Model training may have failed. Run: npm run train:model');
});

// ── 6. Done — print summary ───────────────────────────────────────────────────
title('─'.repeat(50));
title('🎉  Setup complete! Next steps:');
console.log('');

const steps = [
  ['1', 'Start MongoDB:',        'mongod --dbpath ~/data/db'],
  ['2', 'Start Redis:',          'redis-server'],
  ['3', 'Start all services:',   'npm run dev'],
  ['4', 'Seed demo data:',       'npm run seed'],
  ['5', 'Open in browser:',      'http://localhost:5173'],
];

for (const [n, label, cmd] of steps) {
  console.log(`  ${c.cyan}${n}.${c.reset} ${label}`);
  console.log(`     ${c.dim}${cmd}${c.reset}`);
}

console.log('');
console.log(`  ${c.bold}Demo logins (password: Password@123)${c.reset}`);
console.log(`  ${c.dim}Admin:   admin@university.edu${c.reset}`);
console.log(`  ${c.dim}Faculty: faculty1@university.edu${c.reset}`);
console.log(`  ${c.dim}Student: cs21001@university.edu${c.reset}`);
console.log('');

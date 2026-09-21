const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
const venv = path.join(root, '.venv');
const venvPython = os.platform() === 'win32'
  ? path.join(venv, 'Scripts', 'python.exe')
  : path.join(venv, 'bin', 'python');

function hostPython() {
  const candidates = os.platform() === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // Try the next interpreter name.
    }
  }
  throw new Error('Python 3 is required to create the backend virtual environment.');
}

function ensureVenv() {
  if (!fs.existsSync(venvPython)) {
    console.log('[setup] Creating Python virtual environment...');
    execFileSync(hostPython(), ['-m', 'venv', '.venv'], { stdio: 'inherit', cwd: root });
  }

  // The old setup attempted `pip install -e .`, but this repository is not a
  // Python package (there is no setup.py/[project] metadata). Check the
  // actual runtime dependency instead, then install from the requirements
  // contract when a checkout has a missing or partial venv.
  try {
    execFileSync(venvPython, ['-c', 'import uvicorn'], { stdio: 'ignore', cwd: root });
    return;
  } catch {
    // Install below.
  }

  const requirementName = process.env.IFRAME_PYTHON_REQUIREMENTS === 'full'
    ? 'requirements.txt'
    : 'requirements-docker.txt';
  const requirements = path.join(root, requirementName);
  if (!fs.existsSync(requirements)) {
    throw new Error(`Missing Python dependency file: ${requirementName}`);
  }
  const pip = os.platform() === 'win32'
    ? path.join(venv, 'Scripts', 'pip.exe')
    : path.join(venv, 'bin', 'pip');
  console.log(`[setup] Installing Python dependencies from ${requirementName}...`);
  execFileSync(pip, ['install', '-r', requirements], { stdio: 'inherit', cwd: root });
}

console.log('[setup] Checking environment...');

// 1. Setup Python venv and verify the dependency needed by start-backend.js.
let backendSetupFailed = false;
try {
  ensureVenv();
} catch (e) {
  backendSetupFailed = true;
  console.error('[setup] Failed to setup venv:', e.message);
}

// 2. Setup Frontend dependencies if missing
const frontendModules = path.join(root, 'frontend', 'node_modules');
if (!fs.existsSync(frontendModules)) {
  console.log('[setup] Installing frontend dependencies...');
  execSync('npm install', { stdio: 'inherit', cwd: path.join(root, 'frontend') });
}

if (backendSetupFailed) {
  console.error('[setup] Backend setup is incomplete; refusing to start a frontend-only dev session.');
  process.exitCode = 1;
}

// 3. Pre-download Demucs model when the optional full dependency is present.
// The headless requirements used by default intentionally do not pull the
// very large torch/demucs stack just to bring the HTTP API online.
if (fs.existsSync(venvPython)) {
  let hasDemucs = false;
  try {
    execFileSync(venvPython, ['-c', 'import demucs'], { stdio: 'ignore', cwd: root });
    hasDemucs = true;
  } catch {
    console.log('[setup] Demucs not installed; skipping optional audio model warmup.');
  }
  if (hasDemucs) {
    console.log('[setup] Checking Demucs model...');
    try {
      execFileSync(
        venvPython,
        ['-c', "from demucs.pretrained import get_model; get_model('htdemucs'); print('[setup] Demucs htdemucs model ready.')"],
        { stdio: 'inherit', cwd: root, timeout: 180000 }
      );
    } catch (e) {
      console.warn('[setup] ⚠️  Demucs model download failed. Dubbing feature will attempt download on first use.');
      console.warn(`[setup]    ${e.message}`);
    }
  }
}

console.log('[setup] Done.');

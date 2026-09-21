const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const isWin = os.platform() === 'win32';
const pythonPath = isWin
  ? path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe')
  : path.join(__dirname, '..', '.venv', 'bin', 'python');

if (!fs.existsSync(pythonPath)) {
  console.error(`[backend] Python runtime not found: ${pythonPath}`);
  console.error('[backend] Run `npm run predev` from the repository root first.');
  process.exit(1);
}

const env = {
  ...process.env,
  NO_PROXY: '*.aliyuncs.com,localhost,127.0.0.1',
  no_proxy: '*.aliyuncs.com,localhost,127.0.0.1'
};

const backend = spawn(pythonPath, [
  '-m', 'uvicorn', 'src.apps.comic_gen.api:app',
  '--reload', '--port', '17177', '--host', '0.0.0.0'
], {
  stdio: 'inherit',
  env
});

backend.on('error', (error) => {
  console.error(`[backend] Failed to start uvicorn: ${error.message}`);
  process.exit(1);
});

backend.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});

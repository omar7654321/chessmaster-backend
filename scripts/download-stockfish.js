#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const crypto = require('crypto');
const unzipper = require('unzipper');

const BIN_DIR = path.resolve(__dirname, '..', 'bin', 'stockfish');
const TMP_ROOT = path.resolve(os.tmpdir(), 'stockfish-download-cache');
const TMP_DIR = path.join(TMP_ROOT, `sf-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const PLATFORM = process.platform;
const ARCH = process.arch;

const RELEASES = {
  win32: {
    x64: {
      targets: [
        'https://github.com/official-stockfish/Stockfish/releases/download/sf_17.1/stockfish-windows-x86-64-avx2.zip',
        'https://github.com/official-stockfish/Stockfish/releases/download/sf_17/stockfish-windows-x86-64-avx2.zip',
        'https://github.com/official-stockfish/Stockfish/releases/download/sf_16.1/stockfish-16.1-win-x86-64.zip',
        'https://github.com/official-stockfish/Stockfish/releases/download/sf_16/stockfish-16-win-x86-64.zip',
        'https://stockfishchess.org/files/stockfish-17.1-win-x64-avx2.zip',
        'https://stockfishchess.org/files/stockfish-16.1-win-x64.zip',
      ],
      binaryPattern: /stockfish[\\/]+stockfish-windows-(x86-64|x64).*\.exe$/i,
      target: 'stockfish.exe',
    },
    ia32: {
      targets: [
        'https://github.com/official-stockfish/Stockfish/releases/download/sf_16.1/stockfish-16.1-win-x86.zip',
        'https://stockfishchess.org/files/stockfish-16.1-win-x86.zip',
      ],
      binaryPattern: /stockfish[\\/]+stockfish-windows-x86.*\.exe$/i,
      target: 'stockfish.exe',
    },
  },
  darwin: {
    x64: {
      targets: [
        'https://github.com/official-stockfish/Stockfish/releases/download/sf_16.1/stockfish-16.1-mac-x86-64.zip',
        'https://stockfishchess.org/files/stockfish-16.1-mac-x86-64.zip',
      ],
      binaryPattern: /stockfish[\\/]+stockfish-apple-macOS-intel$/,
      target: 'stockfish',
    },
    arm64: {
      targets: [
        'https://github.com/official-stockfish/Stockfish/releases/download/sf_16.1/stockfish-16.1-mac-arm64.zip',
        'https://stockfishchess.org/files/stockfish-16.1-mac-arm64.zip',
      ],
      binaryPattern: /stockfish[\\/]+stockfish-apple-macOS-arm64$/, 
      target: 'stockfish',
    },
  },
  linux: {
    x64: {
      targets: [
        'https://github.com/official-stockfish/Stockfish/releases/download/sf_16.1/stockfish-16.1-linux-x86-64.zip',
        'https://stockfishchess.org/files/stockfish-16.1-linux-x86-64.zip',
      ],
      binaryPattern: /stockfish[\\/]+stockfish-linux-x86-64.*$/,
      target: 'stockfish',
    },
    arm64: {
      targets: [
        'https://github.com/official-stockfish/Stockfish/releases/download/sf_16.1/stockfish-16.1-linux-armv8.zip',
        'https://stockfishchess.org/files/stockfish-16.1-linux-armv8.zip',
      ],
      binaryPattern: /stockfish[\\/]+stockfish-linux-armv8.*$/,
      target: 'stockfish',
    },
  },
};

function log(message) {
  process.stdout.write(`${message}\n`);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function downloadFile(url, dest, attempt = 1) {
  ensureDir(path.dirname(dest));
  log(`Downloading Stockfish (attempt ${attempt}) from ${url}`);
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      const { statusCode } = response;
      const redirectLocation = response.headers.location;
      const contentType = response.headers['content-type'] || '';

      if (statusCode >= 300 && statusCode < 400 && redirectLocation) {
        response.resume();
        downloadFile(redirectLocation, dest, attempt).then(resolve).catch(reject);
        return;
      }

      if (statusCode !== 200) {
        response.resume();
        reject(new Error(`Request failed with status ${statusCode}`));
        return;
      }

      if (contentType.includes('text/html')) {
        response.resume();
        reject(new Error(`Unexpected content-type ${contentType}`));
        return;
      }

      const hash = crypto.createHash('sha256');
      const file = fs.createWriteStream(dest);
      response.on('data', (chunk) => hash.update(chunk));
      response.pipe(file);
      file.on('finish', () => file.close(() => resolve(hash.digest('hex'))));
      file.on('error', (err) => {
        file.close(() => {
          fs.unlink(dest, () => reject(err));
        });
      });
    });

    request.on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  }).catch((err) => {
    if (attempt < 3) {
      log(`Download failed (${err.message}). Retrying...`);
      return downloadFile(url, dest, attempt + 1);
    }
    throw err;
  });
}
async function unzip(zipPath, destDir) {
  ensureDir(destDir);
  await fs.createReadStream(zipPath)
    .pipe(unzipper.Extract({ path: destDir }))
    .promise();
}

function cleanupTemp() {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch (err) {
    // ignore cleanup errors
  }
}

function removePath(targetPath) {
  if (!targetPath) return;
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch (err) {
    // ignore
  }
}

async function downloadStockfish() {
  const platformConfig = RELEASES[PLATFORM] && RELEASES[PLATFORM][ARCH];
  if (!platformConfig) {
    log(`No Stockfish binary configured for platform=${PLATFORM} arch=${ARCH}. Skipping download.`);
    return;
  }

  ensureDir(BIN_DIR);
  ensureDir(TMP_ROOT);
  ensureDir(TMP_DIR);

  const targets = Array.isArray(platformConfig.targets) ? platformConfig.targets : [];
  if (targets.length === 0) {
    throw new Error('No download targets defined for this platform.');
  }

  let sourceBinary = '';
  const errors = [];

  for (let index = 0; index < targets.length && !sourceBinary; index += 1) {
    const targetUrl = targets[index];
    const cleanUrl = (targetUrl || '').split('?')[0];
    const archiveName = path.basename(cleanUrl) || `stockfish-${index}.zip`;
    const archivePath = path.join(TMP_DIR, `archive-${index}-${archiveName}`);
    const extractDir = path.join(TMP_DIR, `extract-${index}`);
    ensureDir(extractDir);

    try {
      const sha256 = await downloadFile(targetUrl, archivePath);
      log(`Downloaded ${targetUrl} (sha256=${sha256})`);

      log(`Extracting ${archivePath}`);
      await unzip(archivePath, extractDir);

      sourceBinary = findBinary(extractDir, platformConfig.binaryPattern) || '';
      if (!sourceBinary) {
        throw new Error('Expected Stockfish binary not found in extracted archive.');
      }
      log(`Using extracted binary ${sourceBinary}`);
    } catch (err) {
      errors.push(`${targetUrl}: ${err.message || err}`);
      removePath(archivePath);
      removePath(extractDir);
      log(`Attempt with ${targetUrl} failed: ${err.message || err}`);
    }
  }

  if (!sourceBinary) {
    throw new Error(`Unable to download Stockfish binary. Tried:\n - ${errors.join('\n - ')}`);
  }

  const targetBinary = path.join(BIN_DIR, platformConfig.target);
  ensureDir(path.dirname(targetBinary));

  fs.copyFileSync(sourceBinary, targetBinary);
  if (PLATFORM !== 'win32') {
    fs.chmodSync(targetBinary, 0o755);
  }

  log(`Stockfish binary installed to ${targetBinary}`);
}

function findBinary(root, pattern) {
  const entries = traverse(root);
  return entries.find((entry) => pattern.test(entry.replace(/\\/g, '/')));
}

function traverse(dir) {
  const results = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      results.push(...traverse(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

downloadStockfish()
  .catch((err) => {
    console.error('Failed to download Stockfish:', err.message || err);
    process.exitCode = 1;
  })
  .finally(() => {
    cleanupTemp();
  });

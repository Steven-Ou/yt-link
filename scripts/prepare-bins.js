const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const binDir = path.join(__dirname, '..', 'bin');
if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir);
}

// 1. Copy the current Node executable to the bin folder for yt-dlp to use
const nodeSource = process.execPath;
const nodeDest = path.join(binDir, os.platform() === 'win32' ? 'node.exe' : 'node');

try {
  console.log(`Copying Node runtime from: ${nodeSource}`);
  fs.copyFileSync(nodeSource, nodeDest);
} catch (err) {
  console.error('Failed to bundle Node runtime:', err);
}

// 2. Set permissions for non-Windows platforms
if (os.platform() !== 'win32') {
  try {
    // Include node in the chmod list
    execSync(`chmod +x "${path.join(binDir, 'ffmpeg')}" "${path.join(binDir, 'yt-dlp')}" "${path.join(binDir, 'node')}"`);
    console.log('Permissions set for all binaries.');
  } catch (error) {
    console.error('Failed to set permissions:', error);
  }
}
const os = require('os');
const { execSync } = require('child_process');

// Only run chmod on non-Windows platforms
if (os.platform() !== 'win32') {
  try {
    execSync('chmod +x bin/ffmpeg bin/yt-dlp');
    console.log('Permissions set for binaries.');
  } catch (error) {
    console.error('Failed to set permissions on binaries:', error);
  }
}
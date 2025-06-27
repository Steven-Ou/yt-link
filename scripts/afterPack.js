// In scripts/afterPack.js
const fs = require('fs');
const path = require('path');

/**
 * This hook is executed by electron-builder after the app is packaged.
 * Its purpose is to set the necessary executable permissions for the bundled
 * ffmpeg, ffprobe, and the Python backend itself, which is a requirement on macOS and Linux.
 */
exports.default = async function (context) {
  // This hook is only necessary for non-Windows platforms.
  if (process.platform === 'win32') {
    console.log('[AfterPack] Windows platform detected, skipping chmod.');
    return;
  }

  console.log('--- AfterPack Hook: Setting executable permissions ---');
  
  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;
  
  // Define the path to the app's resources directory. On macOS, this is inside the .app bundle.
  const resourcesPath = path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources');
  
  // Define paths to the bundled executables that need permissions.
  const ffmpegPath = path.join(resourcesPath, 'bin', 'ffmpeg');
  const ffprobePath = path.join(resourcesPath, 'bin', 'ffprobe');
  const backendPath = path.join(resourcesPath, 'backend', 'yt-link-backend');
  
  const filesToChmod = [ffmpegPath, ffprobePath, backendPath];

  for (const filePath of filesToChmod) {
    try {
      if (fs.existsSync(filePath)) {
        // Set permissions to 'rwxr-xr-x' (read/write/execute for owner, read/execute for others)
        fs.chmodSync(filePath, '755');
        console.log(`[AfterPack] SUCCESS: Set +x permission on ${path.basename(filePath)}`);
      } else {
        // This is a critical warning. If a file is not found, the app will fail.
        console.warn(`[AfterPack] WARNING: Could not find file to chmod: ${filePath}`);
      }
    } catch (error) {
      console.error(`[AfterPack] ERROR: Failed to set permissions on ${filePath}`, error);
      // Fail the entire build if permissions can't be set, as the app will be broken.
      throw error;
    }
  }

  console.log('--- AfterPack Hook: Finished successfully ---');
};

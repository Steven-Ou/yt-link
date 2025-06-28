// In scripts/afterPack.js
const fs = require('fs');
const path = require('path');

/**
 * This hook is executed by electron-builder after the app is packaged.
 * Its purpose is to set the necessary executable permissions for the bundled
 * ffmpeg, ffprobe, and the Python backend itself, which is a requirement on macOS and Linux.
 */
exports.default = async function (context) {
  const { appOutDir, packager } = context;
  const platformName = packager.platform.name;

  console.log(`--- AfterPack Hook: Starting for platform '${platformName}' ---`);

  // This hook is only necessary for non-Windows platforms.
  if (platformName === 'win') {
    console.log('[AfterPack] Windows platform detected, skipping chmod.');
    return;
  }

  // On macOS, resources are in the .app bundle. On Linux, they are in the root.
  const resourcesPath = platformName === 'mac'
    ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(appOutDir, 'resources');
  
  console.log(`[AfterPack] Resources path determined to be: ${resourcesPath}`);

  const filesToChmod = [
    path.join(resourcesPath, 'bin', 'ffmpeg'),
    path.join(resourcesPath, 'bin', 'ffprobe'),
    path.join(resourcesPath, 'backend', 'yt-link-backend')
  ];

  for (const filePath of filesToChmod) {
    console.log(`[AfterPack] Processing file: ${filePath}`);
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

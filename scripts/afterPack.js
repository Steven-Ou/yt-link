// scripts/afterPack.js
const fs = 'fs';
const path = 'path';

// This script is executed by electron-builder after the app is packaged.
// Its purpose is to set the necessary executable permissions for the bundled
// Python backend and ffmpeg utility, which is a requirement on macOS and Linux.
exports.default = async function (context) {
  // We only need to run this on macOS and Linux.
  if (process.platform === 'win32') {
    return;
  }

  console.log('--- AfterPack Hook: Setting executable permissions ---');

  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;
  const resourcesPath = path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources');

  // Paths to the key executables based on your 'extraResources' config.
  const backendExePath = path.join(resourcesPath, 'backend', 'yt-link-backend');
  const ffmpegExePath = path.join(resourcesPath, 'bin', 'ffmpeg', 'bin', 'ffmpeg');

  const filesToChmod = [backendExePath, ffmpegExePath];

  for (const filePath of filesToChmod) {
    try {
      if (fs.existsSync(filePath)) {
        // Set permissions to 'rwxr-xr-x' (read/write/execute for owner, read/execute for others)
        fs.chmodSync(filePath, '755');
        console.log(`SUCCESS: Set +x permission on ${path.basename(filePath)}`);
      } else {
        console.warn(`WARNING: Could not find file to chmod: ${filePath}`);
      }
    } catch (error) {
      console.error(`ERROR: Failed to set permissions on ${filePath}`, error);
      // If permissions fail, the app will not work, so we should throw to fail the build.
      throw error;
    }
  }

  console.log('--- AfterPack Hook: Finished ---');
};

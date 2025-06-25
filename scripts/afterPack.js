// scripts/afterPack.js
const fs = require('fs'); // FIX: Correctly require the 'fs' module
const path = require('path'); // FIX: Correctly require the 'path' module

// This script is executed by electron-builder after the app is packaged.
// Its purpose is to set the necessary executable permissions for the bundled
// Python backend and ffmpeg utility, which is a requirement on macOS and Linux.
exports.default = async function (context) {
  const { appOutDir, packager, platform } = context;

  console.log(`--- AfterPack Hook: Running for platform: ${platform.name} ---`);
  
  // Determine the correct path to the app's resources directory based on the platform.
  let resourcesPath;
  if (platform.name === 'mac') {
    const appName = packager.appInfo.productFilename;
    resourcesPath = path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources');
  } else {
    // For Windows and Linux, the resources are in a 'resources' folder within the output directory.
    resourcesPath = path.join(appOutDir, 'resources');
  }

  console.log(`[AfterPack] Determined resources path: ${resourcesPath}`);
  
  // Define platform-specific executable names
  const backendExeName = platform.name === 'win' ? 'yt-link-backend.exe' : 'yt-link-backend';
  const ffmpegExeName = platform.name === 'win' ? 'ffmpeg.exe' : 'ffmpeg';
  
  // Define the full paths to the executables within the packaged app
  const backendExePath = path.join(resourcesPath, 'backend', backendExeName);
  const ffmpegExePath = path.join(resourcesPath, 'bin', 'ffmpeg', 'bin', ffmpegExeName);
  
  // The permission change is only needed on non-Windows platforms.
  if (platform.name === 'win') {
    console.log('[AfterPack] Windows platform detected, skipping chmod.');
    return;
  }
  
  console.log('[AfterPack] macOS or Linux platform detected, setting executable permissions...');
  const filesToChmod = [backendExePath, ffmpegExePath];

  for (const filePath of filesToChmod) {
    try {
      if (fs.existsSync(filePath)) {
        // Set permissions to 'rwxr-xr-x' (read/write/execute for owner, read/execute for others)
        fs.chmodSync(filePath, '755');
        console.log(`[AfterPack] SUCCESS: Set +x permission on ${path.basename(filePath)}`);
      } else {
        console.warn(`[AfterPack] WARNING: Could not find file to chmod: ${filePath}`);
      }
    } catch (error) {
      console.error(`[AfterPack] ERROR: Failed to set permissions on ${filePath}`, error);
      // If permissions fail, the app will not work, so we should throw to fail the build.
      throw error;
    }
  }

  console.log('--- AfterPack Hook: Finished ---');
};

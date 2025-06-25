// scripts/afterPack.js
const fs = require('fs');
const path = require('path');

/**
 * This hook is executed by electron-builder after the app is packaged.
 * Its purpose is to set the necessary executable permissions for the bundled
 * Python backend and ffmpeg/ffprobe utilities, which is a requirement on macOS and Linux.
 */
exports.default = async function (context) {
  console.log('--- AfterPack Hook: Starting ---');
  
  const { appOutDir, packager } = context;
  const platform = packager.platform;

  if (!platform) {
    console.error('[AfterPack] ERROR: Could not determine platform from context.packager. Exiting.');
    return;
  }
  
  console.log(`[AfterPack] Detected platform: ${platform.name}`);

  // The permission change is only needed on non-Windows platforms.
  if (platform.name === 'win32' || platform.name === 'win') {
    console.log('[AfterPack] Windows platform detected, skipping chmod.');
    console.log('--- AfterPack Hook: Finished ---');
    return;
  }

  // Determine the correct path to the app's resources directory based on the platform.
  let resourcesPath;
  if (platform.name === 'mac') {
    const appName = packager.appInfo.productFilename;
    resourcesPath = path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources');
  } else {
    // For Linux, the resources are in a 'resources' folder within the output directory.
    resourcesPath = path.join(appOutDir, 'resources');
  }

  console.log(`[AfterPack] Determined resources path: ${resourcesPath}`);

  // Define platform-specific executable names
  const backendExeName = 'yt-link-backend'; 
  const ffmpegExeName = 'ffmpeg';
  const ffprobeExeName = 'ffprobe';
  
  // Define the full paths to the executables within the packaged app, matching the release.yml and package.json config.
  const backendExePath = path.join(resourcesPath, 'backend', backendExeName);
  const ffmpegExePath = path.join(resourcesPath, 'bin', ffmpegExeName);
  const ffprobeExePath = path.join(resourcesPath, 'bin', ffprobeExeName);
  
  console.log('[AfterPack] Setting executable permissions...');
  // Add all necessary executables to this array.
  const filesToChmod = [backendExePath, ffmpegExePath, ffprobeExePath];

  for (const filePath of filesToChmod) {
    try {
      if (fs.existsSync(filePath)) {
        // Set permissions to 'rwxr-xr-x' (read/write/execute for owner, read/execute for others)
        fs.chmodSync(filePath, '755');
        console.log(`[AfterPack] SUCCESS: Set +x permission on ${path.basename(filePath)} at ${filePath}`);
      } else {
        // This warning is crucial for debugging packaging issues.
        console.warn(`[AfterPack] WARNING: Could not find file to chmod: ${filePath}`);
      }
    } catch (error) {
      console.error(`[AfterPack] ERROR: Failed to set permissions on ${filePath}`, error);
      // If permissions fail, the app will not work, so we should throw to fail the build.
      throw error;
    }
  }

  console.log('--- AfterPack Hook: Finished Successfully ---');
};

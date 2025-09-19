// scripts/afterPack.js
const fs = require("fs");
const path = require("path");

exports.default = async function (context) {
  // Only run this script on macOS or Linux
  if (process.platform === "win32") {
    return; // Skip this script on Windows
  }

  const binPath = path.join(context.appOutDir, "bin");
  // Adjust binary names for macOS/Linux if they are different
  const ffmpegPath = path.join(binPath, "ffmpeg"); 
  const ytDlpPath = path.join(binPath, "yt-dlp");

  console.log("Setting permissions for binaries on macOS/Linux...");

  try {
    fs.chmodSync(ffmpegPath, 0o755);
    fs.chmodSync(ytDlpPath, 0o755);
    console.log("Permissions set successfully.");
  } catch (error) {
    console.error("Could not set permissions on binaries", error);
  }
};
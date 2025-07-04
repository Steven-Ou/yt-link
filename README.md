<div align="center">
  <h1 align="center">YT Link</h1>
  <a href="https://github.com/Steven-Ou/yt-link">
    <img src="https://raw.githubusercontent.com/Steven-Ou/yt-link/main/assets/app.png" alt="Logo" width="100" height="100">
  </a>
  <p align="center">
    A simple and elegant desktop application to download audio from your favorite videos.
    <br />
    <a href="https://github.com/Steven-Ou/yt-link/releases/latest"><strong>Download the App »</strong></a>
    ·
    <a href="https://github.com/Steven-Ou/yt-link/issues">Report Bug</a>
    ·
    <a href="https://github.com/Steven-Ou/yt-link/issues">Request Feature</a>
  </p>
  <p align="center">
    <a href="https://github.com/Steven-Ou/yt-link/actions/workflows/release.yml"><img src="https://github.com/Steven-Ou/yt-link/actions/workflows/release.yml/badge.svg" alt="Build Status"></a>
    <a href="https://github.com/Steven-Ou/yt-link/releases/latest"><img src="https://img.shields.io/github/v/release/Steven-Ou/yt-link?color=E53935&label=latest%20version" alt="Latest Release"></a>
    <a href="https://github.com/Steven-Ou/yt-link/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Steven-Ou/yt-link?color=E53935" alt="License"></a>
  </p>
</div>

---

### About The Project

YT Link provides a clean, easy-to-use interface for downloading audio from YouTube. Whether you need a single track or an entire playlist, this application streamlines the process, delivering high-quality MP3 files directly to your computer.

---

### Key Features

<table width="100%">
  <tr>
    <td align="center" width="33%">
      <h4>Single Video to MP3</h4>
      <p>Quickly convert any YouTube video into a high-quality MP3 file.</p>
    </td>
    <td align="center" width="33%">
      <h4>Playlist to ZIP</h4>
      <p>Download an entire playlist as a conveniently packaged ZIP archive of MP3s.</p>
    </td>
    <td align="center" width="33%">
      <h4>Cross-Platform</h4>
      <p>Native builds available for both Windows and macOS (Intel & Apple Silicon).</p>
    </td>
  </tr>
</table>

---

### Installation and Usage

To get started, simply download the correct version for your operating system from the latest release.

<table width="100%">
  <tr>
    <td width="50%" valign="top" style="padding-right: 15px; border-right: 1px solid #d0d7de;">
      <h4>For Windows Users</h4>
      <ol>
        <li>Go to the <a href="https://github.com/Steven-Ou/yt-link/releases/latest"><strong>Releases</strong></a> page.</li>
        <li>Download the latest <code>YT-Link-Windows-x64.zip</code> file.</li>
        <li><strong>Important:</strong> Once downloaded, right-click the <code>.zip</code> file and select <strong>"Extract All..."</strong>.</li>
        <li>Open the newly extracted folder and run <code>YT Link.exe</code> to start the application.</li>
      </ol>
    </td>
    <td width="50%" valign="top" style="padding-left: 15px;">
      <h4>For macOS Users</h4>
      <ol>
        <li>Go to the <a href="https://github.com/Steven-Ou/yt-link/releases/latest"><strong>Releases</strong></a> page.</li>
        <li>Download the latest <code>.dmg</code> file for your Mac's architecture.</li>
        <li>Open the downloaded <code>.dmg</code> file.</li>
        <li>Drag the <strong>YT Link</strong> application icon into the <strong>Applications</strong> folder shortcut.</li>
      </ol>
    </td>
  </tr>
</table>

<div style="background-color: #fffbdd; border-left: 6px solid #ffb900; padding: 10px 20px; margin-top: 20px; border-radius: 5px;">
  <p><strong>Important Note for macOS Users:</strong></p>
  <p>The first time you open the app, you may see a warning because it is not from an identified developer. Follow one of these methods:</p>
  <ul>
    <li>
      <strong>Method 1 (Recommended):</strong> Right-click the app icon and select <strong>"Open"</strong> from the context menu. You may need to do this twice.
    </li>
    <li>
      <strong>Method 2 (If the app "is damaged"):</strong> If you see an error saying the app is damaged and can’t be opened, run the following command in your <strong>Terminal</strong> to remove the quarantine attribute that causes the error.
      <pre><code>sudo xattr -cr "/Applications/YT Link.app"</code></pre>
      You will be prompted to enter your password. After running the command, you should be able to open the app normally.
    </li>
  </ul>
</div>

---

### Disclaimer
<p align="center">
This project is for educational purposes only. The software is intended to demonstrate full-stack and desktop application development skills. Users of this software are expected to respect the terms of service of any website they use it with, including YouTube. This tool should only be used to download content for which you have explicit permission from the copyright holder, or content that is in the public domain. The author is not responsible for any copyright infringement or misuse of this software. The responsibility lies solely with the user to ensure they are not violating any laws or terms of service.
</p>
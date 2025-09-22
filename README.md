<div align="center">
<h1 align="center">YT Link</h1>
<a href="https://github.com/Steven-Ou/yt-link">
<img src="https://raw.githubusercontent.com/Steven-Ou/yt-link/main/assets/app.png" alt="Logo" width="100" height="100">
</a>
<p align="center">
A simple and elegant desktop application to download audio and video from your favorite content.
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

About The Project
YT Link provides a clean, easy-to-use interface for downloading video and audio from YouTube. Whether you need a single video, a high-quality audio track, or an entire playlist, this application streamlines the process, delivering files directly to your computer.

Key Features
<table width="100%">
<tr>
<td align="center" width="20%">
<h4>Single Video</h4>
<p>Download any YouTube video in your chosen quality, up to its original resolution.</p>
</td>
<td align="center" width="20%">
<h4>Audio Extraction</h4>
<p>Quickly convert any YouTube video into a high-quality MP3 file.</p>
</td>
<td align="center" width="20%">
<h4>Playlist Downloads</h4>
<p>Download an entire playlist's audio tracks and save them in a convenient ZIP archive.</p>
</td>
<td align="center" width="20%">
<h4>Combine Playlist</h4>
<p>Download and merge a full playlist's audio into a single, combined MP3 file.</p>
</td>
<td align="center" width="20%">
<h4>Cross-Platform</h4>
<p>A single macOS app for both Intel & Apple Silicon, plus a build for Windows.</p>
</td>
</tr>
</table>

Installation and Usage
To get started, simply download the correct version for your operating system from the latest release.
Note: For large playlists, the download and processing may take some time. You can monitor the progress by opening the developer tools with Ctrl + Shift + I (Windows) or Command + Option + I (macOS) to view the log.


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
<p><strong>P.S.</strong> The command-line window that opens with the app will not show a detailed download progress bar. This is intentional to prevent crashes related to Windows character encoding issues. The progress bar inside the app itself will still work correctly.</p>
</td>
<td width="50%" valign="top" style="padding-left: 15px;">
<h4>For macOS Users (Intel & Apple Silicon)</h4>
<ol>
<li>Go to the <a href="https://github.com/Steven-Ou/yt-link/releases/latest"><strong>Releases</strong></a> page.</li>
<li>Download the latest <code>YT-Link-macOS-universal.dmg</code> file.</li>
<li>Open the downloaded <code>.dmg</code> file.</li>
<li>Drag the <strong>YT Link</strong> application icon into the <strong>Applications</strong> folder shortcut.</li>
</ol>
</td>
</tr>
</table>

Using Cookies for Private & Age-Restricted Content
<p>Some videos require you to be logged in. To download them, you'll need to provide your YouTube browser cookies to the application.</p>
<ol>
<li>
<strong>Install a Cookie Exporter Extension</strong><br>
A recommended one is "Get cookies.txt LOCALLY", available for <a href="https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc">Chrome</a> and <a href="https://addons.mozilla.org/en-US/firefox/addon/get-cookies-txt-locally/">Firefox</a>.
</li>
<li>
<strong>Export Your Cookies</strong>
<ul>
<li>Go to <code>youtube.com</code> and ensure you are logged in.</li>
<li>Click the extension's icon and then the <strong>"Export"</strong> or <strong>"Copy"</strong> button.</li>
</ul>
</li>
<li>
<strong>Paste into YT Link</strong>
<ul>
<li>In the application, paste the copied text into the "Paste YouTube Cookies Here" field.</li>
<li>You can now download the private or age-restricted content.</li>
</ul>
</li>
</ol>

<div style="background-color: #fffbdd; border-left: 6px solid #ffb900; padding: 10px 20px; margin-top: 20px; border-radius: 5px;">
<p><strong>Important Note for macOS Users:</strong></p>
<p>On first launch, you may see a security warning. Use one of these methods:</p>
<ul>
<li>
<strong>Method 1 (Recommended):</strong> Right-click the app icon and select <strong>"Open"</strong>. You might need to do this twice.
</li>
<li>
<strong>Method 2 (If "damaged"):</strong> If macOS reports the app is damaged, run this command in your <strong>Terminal</strong> to fix it:
<pre><code>sudo xattr -cr "/Applications/YT Link.app"</code></pre>
</li>
</ul>
</div>

Disclaimer
<p align="center">
This project is for educational purposes. Users are expected to respect the terms of service of any website they use it with. This tool should only be used to download content for which you have permission from the copyright holder. The author is not responsible for any copyright infringement or misuse of this software.
</p>

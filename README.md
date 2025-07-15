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

About The Project
YT Link provides a clean, easy-to-use interface for downloading audio from YouTube. Whether you need a single track or an entire playlist, this application streamlines the process, delivering high-quality MP3 files directly to your computer.

Key Features
<table width="100%">
<tr>
<td align="center" width="25%">
<h4>Single Video to MP3</h4>
<p>Quickly convert any YouTube video into a high-quality MP3 file.</p>
</td>
<td align="center" width="25%">
<h4>Playlist Downloads</h4>
<p>Download an entire playlist as a ZIP archive or a single combined MP3 file.</p>
</td>
<td align="center" width="25%">
<h4>Cookie Support</h4>
<p>Download age-restricted and private content by providing your browser's cookies.</p>
</td>
<td align="center" width="25%">
<h4>Universal macOS & Windows</h4>
<p>A single macOS app for both Intel and Apple Silicon, plus a build for Windows.</p>
</td>
</tr>
</table>

<h4> Installation and Usage</h4> <br>
To get started, simply download the correct version for your operating system from the latest release. <br>
<h4>Notes:</h4> <br>
 If there's alot of songs inside a playlist, it would take a while, make sure to do ctrl + shift+ i (for mac it would be command + option + i) to see the log, so you won't panic!
<br>
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
<p>Some videos or playlists require you to be logged in to view them. To download this content, you'll need to provide your YouTube browser cookies to the application.</p>
<ol>
<li>
<strong>Install a Cookie Exporter Extension</strong><br>
The easiest way to get your cookies is with a browser extension. A recommended one is "Get cookies.txt LOCALLY", which is available for both <a href="https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc">Chrome</a> and <a href="https://addons.mozilla.org/en-US/firefox/addon/get-cookies-txt-locally/">Firefox</a>.
</li>
<li>
<strong>Export Your Cookies</strong>
<ul>
<li>Go to <code>youtube.com</code> in your browser and make sure you are logged in.</li>
<li>Click the cookie extension's icon in your browser toolbar.</li>
<li>Click the <strong>"Export"</strong> or <strong>"Copy to Clipboard"</strong> button. This will copy the cookie data, which starts with <code># Netscape HTTP Cookie File</code>.</li>
</ul>
</li>
<li>
<strong>Paste into YT Link</strong>
<ul>
<li>In the YT Link application, paste the copied text into the "Paste YouTube Cookies Here" field.</li>
<li>You can now enter the URL of the private or age-restricted video/playlist and start your download.</li>
</ul>
</li>
</ol>

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

Disclaimer
<p align="center">
This project is for educational purposes only. The software is intended to demonstrate full-stack and desktop application development skills. Users of this software are expected to respect the terms of service of any website they use it with, including YouTube. This tool should only be used to download content for which you have explicit permission from the copyright holder, or content that is in the public domain. The author is not responsible for any copyright infringement or misuse of this software. The responsibility lies solely with the user to ensure they are not violating any laws or terms of service.
</p>

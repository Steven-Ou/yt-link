import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  const folder = `album_${Date.now()}`;
  fs.mkdirSync(folder);

  try {
    // Download and extract MP3 via yt-dlp
    await new Promise((resolve, reject) =>
      exec(
        `yt-dlp -x --audio-format mp3 -o "${folder}/%(title)s.%(ext)s" "${url}"`,
        (err) => (err ? reject(err) : resolve())
      )
    );

    // Zip the folder
    const zipName = `${folder}.zip`;
    await new Promise((resolve, reject) =>
      exec(`zip -r ${zipName} ${folder}`, (err) => (err ? reject(err) : resolve()))
    );

    // Send the ZIP file
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.sendFile(path.resolve(zipName), () => {
      // Cleanup
      fs.rmSync(folder, { recursive: true, force: true });
      fs.unlinkSync(zipName);
    });
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
}

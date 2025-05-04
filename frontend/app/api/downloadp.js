import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  if (req.method !== 'POST')
    return res.status(405).end('Only POST allowed');

  const { playlistUrl } = req.body;
  if (!playlistUrl) return res.status(400).json({ error: 'No playlist URL' });

  const folder = `playlist_${Date.now()}`;
  fs.mkdirSync(folder);

  try {
    // Download an entire playlist
    await new Promise((resolve, reject) =>
      exec(
        `yt-dlp -x --audio-format mp3 -o "${folder}/%(playlist_index)s - %(title)s.%(ext)s" "${playlistUrl}"`,
        (err) => (err ? reject(err) : resolve())
      )
    );

    const zipName = `${folder}.zip`;
    await new Promise((resolve, reject) =>
      exec(`zip -r ${zipName} ${folder}`, (err) => (err ? reject(err) : resolve()))
    );

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.sendFile(path.resolve(zipName), () => {
      fs.rmSync(folder, { recursive: true, force: true });
      fs.unlinkSync(zipName);
    });
  } catch (error) {
    console.error('Playlist download error:', error);
    res.status(500).json({ error: 'Playlist download failed' });
  }
}

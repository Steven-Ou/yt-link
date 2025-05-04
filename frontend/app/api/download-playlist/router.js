import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

export async function POST(request) {
  const { playlistUrl } = await request.json();
  if (!playlistUrl) {
    return NextResponse.json({ error: 'No playlist URL provided' }, { status: 400 });
  }

  const folder = `playlist_${Date.now()}`;
  fs.mkdirSync(folder);

  try {
    // 1) Download entire playlist
    await new Promise((resolve, reject) =>
      exec(
        `yt-dlp -x --audio-format mp3 -o "${folder}/%(playlist_index)s - %(title)s.%(ext)s" "${playlistUrl}"`,
        (err) => (err ? reject(err) : resolve())
      )
    );
    // 2) Zip folder
    const zipName = `${folder}.zip`;
    await new Promise((resolve, reject) =>
      exec(`zip -r ${zipName} ${folder}`, (err) => (err ? reject(err) : resolve()))
    );
    // 3) Stream ZIP back
    const filePath = path.resolve(zipName);
    const fileStream = fs.createReadStream(filePath);
    const res = new NextResponse(fileStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipName}"`,
      },
    });
    fileStream.on('close', () => {
      fs.rmSync(folder, { recursive: true, force: true });
      fs.unlinkSync(filePath);
    });
    return res;
  } catch (error) {
    console.error('API /download-playlist error:', error);
    return NextResponse.json({ error: 'Playlist download failed' }, { status: 500 });
  }
}

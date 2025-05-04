export const runtime = 'nodejs'; // Use Node.js runtime for server-side code

import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

export async function POST(request) {
  const { url } = await request.json();
  if (!url) {
    return NextResponse.json({ error: 'No URL provided' }, { status: 400 });
  }

  const folder = `album_${Date.now()}`;
  fs.mkdirSync(folder);

  try {
    // 1) Download audio
    await new Promise((resolve, reject) =>
      exec(
        `yt-dlp -x --audio-format mp3 -o "${folder}/%(title)s.%(ext)s" "${url}"`,
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
    // Cleanup after stream
    fileStream.on('close', () => {
      fs.rmSync(folder, { recursive: true, force: true });
      fs.unlinkSync(filePath);
    });
    return res;
  } catch (error) {
    console.error('API /download error:', error);
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}

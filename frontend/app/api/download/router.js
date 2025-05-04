export const runtime = 'nodejs';             // opt into Node.js APIs

import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

export async function POST(request) {
  const { url } = await request.json();
  if (!url) return NextResponse.json({ error: 'No URL provided' }, { status: 400 });

  const folder = `album_${Date.now()}`;
  fs.mkdirSync(folder);

  try {
    // Download MP3
    await new Promise((res, rej) =>
      exec(
        `yt-dlp -x --audio-format mp3 -o "${folder}/%(title)s.%(ext)s" "${url}"`,
        err => (err ? rej(err) : res())
      )
    );
    // Zip it
    const zipName = `${folder}.zip`;
    await new Promise((res, rej) =>
      exec(`zip -r ${zipName} ${folder}`, err => (err ? rej(err) : res()))
    );
    // Stream ZIP response
    const filePath = path.resolve(zipName);
    const stream = fs.createReadStream(filePath);
    return new NextResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipName}"`,
      },
    });
  } catch (error) {
    console.error('API /api/download error:', error);
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  } finally {
    // Cleanup
    fs.rmSync(folder, { recursive: true, force: true });
    fs.unlinkSync(`${folder}.zip`);
  }
}
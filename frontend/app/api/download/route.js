// opt into Node.js runtime so you can use fs, child_process, etc.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

export async function POST(request) {
  console.log('--- DOWNLOAD API ROUTE HIT ---');
  const { url } = await request.json();
  if (!url) {
    return NextResponse.json({ error: 'No URL provided' }, { status: 400 });
  }

  const folder = `album_${Date.now()}`;
  fs.mkdirSync(folder);

  try {
    await new Promise((res, rej) =>
      exec(
        `yt-dlp -x --audio-format mp3 -o "${folder}/%(title)s.%(ext)s" "${url}"`,
        err => (err ? rej(err) : res())
      )
    );
    const zipName = `${folder}.zip`;
    await new Promise((res, rej) =>
      exec(`zip -r ${zipName} ${folder}`, err => (err ? rej(err) : res()))
    );

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
    console.error('API /download error:', error);
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
    fs.unlinkSync(`${folder}.zip`);
  }
}

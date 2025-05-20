// /app/api/download-playlist/route.js

// Calls the Python microservice to start a playlist zip download job.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import axios from 'axios';

const PYTHON_MICROSERVICE_URL = process.env.PYTHON_SERVICE_URL;
const AXIOS_REQUEST_TIMEOUT_MS = 10000; // 10 seconds for job initiation

export async function POST(request) {
  console.log('--- API /api/download-playlist (Start Playlist Zip Job) ---');

  if (!PYTHON_MICROSERVICE_URL) {
      console.error("PYTHON_SERVICE_URL environment variable is not set.");
      return NextResponse.json({ error: "Server configuration error: Processing service URL is missing." }, { status: 500 });
  }

  let playlistUrl;
  let cookieData;
  try {
      const body = await request.json();
      playlistUrl = body.playlistUrl;
      cookieData = body.cookieData;
      if (!playlistUrl) {
          return NextResponse.json({ error: 'No playlistUrl provided in request body' }, { status: 400 });
      }
  } catch (e) {
       console.error("Error parsing request body:", e);
       return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // *** Corrected endpoint name ***
  const targetUrl = `${PYTHON_MICROSERVICE_URL}/start-playlist-zip-job`;
  console.log(`Forwarding request to start playlist zip job for ${playlistUrl} to ${targetUrl}`);
  console.log(`Cookie data being sent (length): ${cookieData ? cookieData.length : 'None'}`);

  try {
    const microserviceResponse = await axios.post(targetUrl,
      { playlistUrl: playlistUrl, cookieData: cookieData },
      {
          headers: { 'Content-Type': 'application/json' },
          timeout: AXIOS_REQUEST_TIMEOUT_MS
      }
    );

    console.log('Response from microservice (start job):', microserviceResponse.data);
    return NextResponse.json(microserviceResponse.data, { status: microserviceResponse.status });

  } catch (error) {
    console.error('API /api/download-playlist - Error calling microservice (start job):', error);
    if (axios.isAxiosError(error) && error.response) {
        console.error('Error data:', error.response.data);
        return NextResponse.json(
            { error: `Processing service failed: ${error.response.data.error || error.response.statusText}` },
            { status: error.response.status }
        );
    } else if (error.code === 'ECONNREFUSED') {
        return NextResponse.json({ error: "Processing service is unavailable." }, { status: 503 });
    }
    return NextResponse.json({ error: `Failed to start job: ${error.message}` }, { status: 502 });
  }
}

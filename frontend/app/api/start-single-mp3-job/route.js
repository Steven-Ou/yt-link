// /app/api/download/route.js

// Calls the Python microservice to start a single MP3 download job.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import axios from 'axios';

const PYTHON_MICROSERVICE_URL = process.env.PYTHON_SERVICE_URL;
const AXIOS_REQUEST_TIMEOUT_MS = 10000; // 10 seconds for job initiation

export async function POST(request) {
  console.log('--- API /api/download (Start Single MP3 Job) ---');

  if (!PYTHON_MICROSERVICE_URL) {
      console.error("PYTHON_SERVICE_URL environment variable is not set.");
      return NextResponse.json({ error: "Server configuration error: Processing service URL is missing." }, { status: 500 });
  }

  let url;
  let cookieData;
  try {
      const body = await request.json();
      url = body.url;
      cookieData = body.cookieData;
      if (!url) {
          return NextResponse.json({ error: 'No URL provided in request body' }, { status: 400 });
      }
  } catch (e) {
       console.error("Error parsing request body:", e);
       return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const targetUrl = `${PYTHON_MICROSERVICE_URL}/start-single-mp3-job`;
  console.log(`Forwarding request to start single MP3 job for ${url} to ${targetUrl}`);
  console.log(`Cookie data being sent (length): ${cookieData ? cookieData.length : 'None'}`);

  try {
    const microserviceResponse = await axios.post(targetUrl,
      { url: url, cookieData: cookieData },
      {
          headers: { 'Content-Type': 'application/json' },
          timeout: AXIOS_REQUEST_TIMEOUT_MS
      }
    );

    // Expecting { message: "Job queued successfully.", jobId: "..." }
    console.log('Response from microservice (start job):', microserviceResponse.data);
    return NextResponse.json(microserviceResponse.data, { status: microserviceResponse.status });

  } catch (error) {
    console.error('API /api/download - Error calling microservice (start job):', error);
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

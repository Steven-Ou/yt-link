// /app/api/download/route.js
export const dynamic = 'force-static';
// Calls the Python microservice to start a single MP3 download job.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import axios from 'axios';

const PYTHON_MICROSERVICE_URL = process.env.PYTHON_SERVICE_URL;
const AXIOS_REQUEST_TIMEOUT_MS = 10000; // 10 seconds for job initiation

export async function POST(request) {
  console.log('--- API /api/download (Start Single MP3 Job) ---');

  if (!PYTHON_MICROSERVICE_URL) {
      console.error("PYTHON_SERVICE_URL environment variable is not set in /api/download/route.js.");
      return NextResponse.json({ error: "Server configuration error: Processing service URL is missing." }, { status: 500 });
  }

  let url; // Changed from playlistUrl to url for single download
  let cookieData;
  try {
      const body = await request.json();
      url = body.url; // Expect 'url' for single MP3
      cookieData = body.cookieData; // Can be null or undefined if not provided

      if (!url) {
          console.error("No url provided in request body to /api/download");
          return NextResponse.json({ error: 'No URL provided in request body' }, { status: 400 });
      }
  } catch (e) {
       console.error("Error parsing request body in /api/download:", e.message);
       return NextResponse.json({ error: 'Invalid request body. Ensure it is valid JSON.', details: e.message }, { status: 400 });
  }

  const targetUrl = `${PYTHON_MICROSERVICE_URL}/start-single-mp3-job`; // Correct Python endpoint
  console.log(`Forwarding request to start single MP3 job for ${url} to ${targetUrl}`);
  if (cookieData) {
    console.log(`Cookie data being sent (length): ${String(cookieData).length}`);
  } else {
    console.log('No cookie data being sent.');
  }

  try {
    const microserviceResponse = await axios.post(targetUrl,
      { url: url, cookieData: cookieData }, // Send 'url'
      {
          headers: { 'Content-Type': 'application/json' },
          timeout: AXIOS_REQUEST_TIMEOUT_MS
      }
    );

    console.log('Response from Python microservice (/start-single-mp3-job):', microserviceResponse.data);
    return NextResponse.json(microserviceResponse.data, { status: microserviceResponse.status });

  } catch (error) {
    console.error('API /api/download - Error calling Python microservice (start-single-mp3-job):', error.message);

    if (axios.isAxiosError(error)) {
        if (error.response) {
            console.error('Python service error response data:', error.response.data);
            console.error('Python service error response status:', error.response.status);
            
            const pythonErrorData = error.response.data;
            let pythonErrorMessage = "Unknown error from processing service";
            if (typeof pythonErrorData === 'object' && pythonErrorData !== null && pythonErrorData.error) {
                pythonErrorMessage = pythonErrorData.error;
            } else if (typeof pythonErrorData === 'string') {
                pythonErrorMessage = pythonErrorData;
            } else {
                pythonErrorMessage = error.response.statusText || pythonErrorMessage;
            }
            
            return NextResponse.json(
                { error: `Processing service failed: ${pythonErrorMessage}`, details: pythonErrorData },
                { status: error.response.status || 500 }
            );
        } else if (error.request) {
            console.error('No response received from Python service (ECONNREFUSED or similar):', error.code);
            return NextResponse.json({ error: "Processing service is unavailable or did not respond.", details: error.code }, { status: 503 });
        }
    }
    return NextResponse.json({ error: `Failed to start job due to an unexpected server error.`, details: error.message }, { status: 500 });
  }
}

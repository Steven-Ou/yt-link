// /app/api/download-playlist/route.js
export const dynamic = 'force-static';
// Calls the Python microservice to start a playlist zip download job.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import axios from 'axios';

const PYTHON_MICROSERVICE_URL = process.env.PYTHON_SERVICE_URL;
const AXIOS_REQUEST_TIMEOUT_MS = 10000; // 10 seconds for job initiation

export async function POST(request) {
  console.log('--- API /api/download-playlist (Start Playlist Zip Job) ---');

  if (!PYTHON_MICROSERVICE_URL) {
      console.error("PYTHON_SERVICE_URL environment variable is not set in /api/download-playlist/route.js.");
      return NextResponse.json({ error: "Server configuration error: Processing service URL is missing." }, { status: 500 });
  }

  let playlistUrl;
  let cookieData;
  try {
      const body = await request.json();
      playlistUrl = body.playlistUrl;
      cookieData = body.cookieData; // Can be null or undefined if not provided

      if (!playlistUrl) {
          console.error("No playlistUrl provided in request body to /api/download-playlist");
          return NextResponse.json({ error: 'No playlistUrl provided in request body' }, { status: 400 });
      }
  } catch (e) {
       console.error("Error parsing request body in /api/download-playlist:", e.message); // Log only message for brevity
       return NextResponse.json({ error: 'Invalid request body. Ensure it is valid JSON.', details: e.message }, { status: 400 });
  }

  const targetUrl = `${PYTHON_MICROSERVICE_URL}/start-playlist-zip-job`;
  console.log(`Forwarding request to start playlist zip job for ${playlistUrl} to ${targetUrl}`);
  if (cookieData) {
    console.log(`Cookie data being sent (length): ${String(cookieData).length}`);
  } else {
    console.log('No cookie data being sent.');
  }


  try {
    const microserviceResponse = await axios.post(targetUrl,
      { playlistUrl: playlistUrl, cookieData: cookieData },
      {
          headers: { 'Content-Type': 'application/json' },
          timeout: AXIOS_REQUEST_TIMEOUT_MS
      }
    );

    console.log('Response from Python microservice (/start-playlist-zip-job):', microserviceResponse.data);
    return NextResponse.json(microserviceResponse.data, { status: microserviceResponse.status });

  } catch (error) {
    console.error('API /api/download-playlist - Error calling Python microservice (start-playlist-zip-job):', error.message); // Log error message

    if (axios.isAxiosError(error)) {
        if (error.response) {
            // The Python service responded with an error status code (4xx or 5xx)
            console.error('Python service error response data:', error.response.data);
            console.error('Python service error response status:', error.response.status);
            
            // Attempt to relay the error from the Python service if it's structured, otherwise use a generic message
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
            // The request was made but no response was received
            console.error('No response received from Python service (ECONNREFUSED or similar):', error.code);
            return NextResponse.json({ error: "Processing service is unavailable or did not respond.", details: error.code }, { status: 503 });
        }
    }
    // For other types of errors (e.g., setup issues, unexpected errors not from axios)
    return NextResponse.json({ error: `Failed to start job due to an unexpected server error.`, details: error.message }, { status: 500 }); // Use 500 for generic server errors
  }
}
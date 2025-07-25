// /app/api/convert/route.js
export const dynamic = 'force-static';
// Calls the Python microservice to start a job for combining playlist audio into a single MP3.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import axios from 'axios';

export async function POST(request) {
  // Static placeholder for the build process.
  return NextResponse.json({ 
    status: 'This is a static build placeholder for the convert route' 
  });
  
  /*
    // All of your original dynamic code is commented out below.
    
    const PYTHON_MICROSERVICE_URL = process.env.PYTHON_SERVICE_URL;
    const AXIOS_REQUEST_TIMEOUT_MS = 10000; // 10 seconds for job initiation

    console.log('--- API /api/convert (Start Combine Playlist MP3 Job) ---');

    if (!PYTHON_MICROSERVICE_URL) {
        console.error("PYTHON_SERVICE_URL environment variable is not set in /api/convert/route.js.");
        return NextResponse.json({ error: "Server configuration error: Processing service URL is missing." }, { status: 500 });
    }

    let playlistUrl;
    let cookieData;
    try {
        const body = await request.json();
        playlistUrl = body.playlistUrl;
        cookieData = body.cookieData; // Can be null or undefined if not provided

        if (!playlistUrl) {
            console.error("No playlistUrl provided in request body to /api/convert");
            return NextResponse.json({ error: 'No playlistUrl provided in request body' }, { status: 400 });
        }
    } catch (e) {
         console.error("Error parsing request body in /api/convert:", e.message);
         return NextResponse.json({ error: 'Invalid request body. Ensure it is valid JSON.', details: e.message }, { status: 400 });
    }

    const targetUrl = `${PYTHON_MICROSERVICE_URL}/start-combine-playlist-mp3-job`; // Correct Python endpoint
    console.log(`Forwarding request to start combine playlist MP3 job for ${playlistUrl} to ${targetUrl}`);
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

      console.log('Response from Python microservice (/start-combine-playlist-mp3-job):', microserviceResponse.data);
      return NextResponse.json(microserviceResponse.data, { status: microserviceResponse.status });

    } catch (error) {
      console.error('API /api/convert - Error calling Python microservice (start-combine-playlist-mp3-job):', error.message);

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
  */
}

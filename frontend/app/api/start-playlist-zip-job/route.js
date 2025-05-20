// /app/api/download-playlist/route.js

// Calls the Python microservice to start a playlist zip download job.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import axios from 'axios';

// Ensure this environment variable is correctly set where your Next.js app is running.
const PYTHON_MICROSERVICE_URL = process.env.PYTHON_SERVICE_URL;
const AXIOS_REQUEST_TIMEOUT_MS = 10000; // 10 seconds for job initiation

export async function POST(request) {
  console.log('--- API /api/download-playlist (Start Playlist Zip Job) ---'); // Step 1: Check if this log appears

  if (!PYTHON_MICROSERVICE_URL) {
      console.error("PYTHON_SERVICE_URL environment variable is not set in /api/download-playlist/route.js.");
      // This will be sent as JSON, which is good.
      return NextResponse.json({ error: "Server configuration error: Processing service URL is missing." }, { status: 500 });
  }

  let playlistUrl;
  let cookieData;
  try {
      // Step 2: Check if parsing the request body causes an error
      const body = await request.json();
      playlistUrl = body.playlistUrl;
      cookieData = body.cookieData; // Ensure cookieData is handled, even if null/undefined

      if (!playlistUrl) {
          console.error("No playlistUrl provided in request body to /api/download-playlist");
          return NextResponse.json({ error: 'No playlistUrl provided in request body' }, { status: 400 });
      }
  } catch (e) {
       // If request.json() fails, this will be caught.
       console.error("Error parsing request body in /api/download-playlist:", e);
       return NextResponse.json({ error: 'Invalid request body. Ensure it is valid JSON.' }, { status: 400 });
  }

  // This is the endpoint on your Python service
  const targetUrl = `${PYTHON_MICROSERVICE_URL}/start-playlist-zip-job`;
  console.log(`Forwarding request to start playlist zip job for ${playlistUrl} to ${targetUrl}`);
  console.log(`Cookie data being sent (length): ${cookieData ? String(cookieData).length : 'None'}`); // Log length or 'None'

  try {
    // Step 3: Check for errors during the axios.post call
    const microserviceResponse = await axios.post(targetUrl,
      { playlistUrl: playlistUrl, cookieData: cookieData }, // Send cookieData as is
      {
          headers: { 'Content-Type': 'application/json' },
          timeout: AXIOS_REQUEST_TIMEOUT_MS
      }
    );

    // Step 4: Check if the response from Python is what's expected
    console.log('Response from Python microservice (/start-playlist-zip-job):', microserviceResponse.data);
    // Assuming Python service correctly returns JSON and an appropriate status
    return NextResponse.json(microserviceResponse.data, { status: microserviceResponse.status });

  } catch (error) {
    // This block catches errors from the axios call (network error, Python service error response)
    console.error('API /api/download-playlist - Error calling Python microservice (start-playlist-zip-job):', error);

    if (axios.isAxiosError(error)) {
        if (error.response) {
            // The Python service responded with an error status code (4xx or 5xx)
            console.error('Python service error response data:', error.response.data);
            console.error('Python service error response status:', error.response.status);
            // Relay the error from the Python service if it's JSON, otherwise provide a generic message
            const pythonError = error.response.data?.error || error.response.data || error.response.statusText || "Unknown error from processing service";
            return NextResponse.json(
                { error: `Processing service failed: ${pythonError}` },
                { status: error.response.status || 500 } // Use Python's status or default to 500
            );
        } else if (error.request) {
            // The request was made but no response was received (e.g., Python service down, network issue)
            console.error('No response received from Python service:', error.request);
            return NextResponse.json({ error: "Processing service is unavailable or did not respond." }, { status: 503 }); // 503 Service Unavailable
        }
    }
    // For other types of errors (e.g., setup issues in the try block before axios call, unexpected errors)
    // or if error is not an AxiosError but still happened.
    console.error('Non-Axios error or unhandled issue in /api/download-playlist:', error.message);
    return NextResponse.json({ error: `Failed to start job due to an unexpected error: ${error.message}` }, { status: 502 }); // 502 Bad Gateway
  }
}

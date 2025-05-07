// /app/api/download-playlist/route.js

// Calls the external Python microservice to handle playlist zipping,
// including forwarding cookie data.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import axios from 'axios'; // Using axios for consistency and timeout control

// Get the microservice URL from environment variables
const PYTHON_MICROSERVICE_URL = process.env.PYTHON_SERVICE_URL;

// Define a long timeout in milliseconds (e.g., 1 hour for potentially long playlists)
const AXIOS_TIMEOUT_MS = 1 * 60 * 60 * 1000; // 1 hour

export async function POST(request) {
  console.log('--- PLAYLIST ZIP (Calling Microservice with Cookies) API ROUTE HIT ---');

  if (!PYTHON_MICROSERVICE_URL) {
      console.error("PYTHON_SERVICE_URL environment variable is not set.");
      return NextResponse.json({ error: "Server configuration error: Processing service URL is missing." }, { status: 500 });
  }

  let playlistUrl;
  let cookieData; // To hold cookie data
  try {
      const body = await request.json();
      playlistUrl = body.playlistUrl;
      cookieData = body.cookieData; // Expecting cookieData from frontend (page.js)
      if (!playlistUrl) {
          return NextResponse.json({ error: 'No playlistUrl provided in request body' }, { status: 400 });
      }
  } catch (e) {
       console.error("Error parsing request body:", e);
       return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Define the target endpoint on your Python service
  const targetUrl = `${PYTHON_MICROSERVICE_URL}/process-playlist-zip`;
  console.log(`Forwarding request for playlist zip ${playlistUrl} to microservice at ${targetUrl}`);
  console.log(`Cookie data being sent (length): ${cookieData ? cookieData.length : 'None'}`);


  try {
    // Make a POST request to the Python microservice
    const microserviceResponse = await axios.post(targetUrl,
      { // Data payload
          playlistUrl: playlistUrl,
          cookieData: cookieData // Forward cookieData
      },
      { // Axios config
          headers: { 'Content-Type': 'application/json' },
          responseType: 'stream', // We expect a file stream (the zip)
          timeout: AXIOS_TIMEOUT_MS
      }
    );

    console.log(`Microservice responded with status ${microserviceResponse.status}`);

    // Forward headers and stream body
    const responseHeaders = new Headers();
    if (microserviceResponse.headers['content-type']) { // Should be application/zip
        responseHeaders.set('Content-Type', microserviceResponse.headers['content-type']);
    }
    if (microserviceResponse.headers['content-length']) {
        responseHeaders.set('Content-Length', microserviceResponse.headers['content-length']);
    }
    if (microserviceResponse.headers['content-disposition']) { // Should contain zip filename
        responseHeaders.set('Content-Disposition', microserviceResponse.headers['content-disposition']);
    }
    console.log(`Streaming zip response from microservice with headers:`, Object.fromEntries(responseHeaders.entries()));

    return new NextResponse(microserviceResponse.data, {
      status: 200,
      headers: responseHeaders,
    });

  } catch (error) {
    console.error('API /api/download-playlist - Error calling microservice with axios:', error);

    if (axios.isAxiosError(error)) {
        if (error.response) {
            console.error('Error data:', error.response.data);
            console.error('Error status:', error.response.status);
            console.error('Error headers:', error.response.headers);
            let errorDetail = 'Processing service error.';
            if (error.response.data && error.response.data.error) {
                errorDetail = error.response.data.error;
            } else if (typeof error.response.data === 'string' && error.response.data.length < 200) {
                errorDetail = error.response.data;
            }
            return NextResponse.json({ error: `Processing service failed: ${errorDetail}` }, { status: error.response.status });
        } else if (error.request) {
            console.error('No response received from microservice:', error.request);
            return NextResponse.json({ error: "No response from processing service (possible timeout or network issue)." }, { status: 504 });
        } else {
            console.error('Error setting up request:', error.message);
        }
    }
    return NextResponse.json({ error: `Failed to connect to processing service: ${error.message}` }, { status: 502 });
  }
}

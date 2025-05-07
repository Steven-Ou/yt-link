// /app/api/convert/route.js

// Calls the external Python microservice to handle combining playlist audio into a single MP3
// using axios for better timeout control.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import axios from 'axios'; // Import axios

// Get the microservice URL from environment variables
// For local development, set this in .env.local (e.g., PYTHON_SERVICE_URL=http://localhost:8080)
const PYTHON_MICROSERVICE_URL = process.env.PYTHON_SERVICE_URL;

// Define a long timeout in milliseconds (e.g., 3 hours = 3 * 60 * 60 * 1000 ms)
// This will apply to the entire request, including waiting for headers and data.
const AXIOS_TIMEOUT_MS = 3 * 60 * 60 * 1000; // Adjust as needed

export async function POST(request) {
  console.log('--- COMBINE PLAYLIST TO SINGLE MP3 (Calling Microservice with axios) API ROUTE HIT ---');

  if (!PYTHON_MICROSERVICE_URL) {
      console.error("PYTHON_SERVICE_URL environment variable is not set.");
      return NextResponse.json({ error: "Server configuration error: Processing service URL is missing." }, { status: 500 });
  }

  let playlistUrl;
  let cookieData;
  try {
      const body = await request.json();
      playlistUrl = body.playlistUrl;
      cookieData = body.cookieData; // Expecting cookieData from frontend
      if (!playlistUrl) {
          return NextResponse.json({ error: 'No playlistUrl provided in request body' }, { status: 400 });
      }
  } catch (e) {
       console.error("Error parsing request body:", e);
       return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // *** Ensure this matches the new endpoint in your Python app.py ***
  const targetUrl = `${PYTHON_MICROSERVICE_URL}/process-combine-playlist-mp3`;
  console.log(`Forwarding request for combine playlist MP3 ${playlistUrl} to microservice at ${targetUrl}`);
  console.log(`Cookie data being sent (length): ${cookieData ? cookieData.length : 'None'}`);


  try {
    const microserviceResponse = await axios.post(targetUrl,
      { // Data payload
          playlistUrl: playlistUrl,
          cookieData: cookieData // Forward cookieData
      },
      { // Axios config
          headers: { 'Content-Type': 'application/json' },
          responseType: 'stream', // Important: We want to stream the response body
          timeout: AXIOS_TIMEOUT_MS // Set the overall timeout
      }
    );

    console.log(`Microservice responded with status ${microserviceResponse.status}`);

    // Forward headers and stream body
    const responseHeaders = new Headers();
    // Axios headers are in microserviceResponse.headers (lowercase keys)
    if (microserviceResponse.headers['content-type']) { // Should be audio/mpeg
        responseHeaders.set('Content-Type', microserviceResponse.headers['content-type']);
    }
    if (microserviceResponse.headers['content-length']) {
        responseHeaders.set('Content-Length', microserviceResponse.headers['content-length']);
    }
    if (microserviceResponse.headers['content-disposition']) { // Should contain .mp3 filename
        responseHeaders.set('Content-Disposition', microserviceResponse.headers['content-disposition']);
    }
    console.log(`Streaming MP3 response from microservice with headers:`, Object.fromEntries(responseHeaders.entries()));

    // microserviceResponse.data is the stream when responseType is 'stream'
    return new NextResponse(microserviceResponse.data, {
      status: 200,
      headers: responseHeaders,
    });

  } catch (error) {
    console.error('API /api/convert (combine MP3) - Error calling microservice with axios:', error);

    if (axios.isAxiosError(error)) {
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.error('Error data:', error.response.data);
            console.error('Error status:', error.response.status);
            console.error('Error headers:', error.response.headers);
            let errorDetail = 'Processing service error.';
            // Try to get error message from Python service if it sent JSON
            if (error.response.data && error.response.data.error) {
                errorDetail = error.response.data.error;
            } else if (typeof error.response.data === 'string' && error.response.data.length < 200) {
                errorDetail = error.response.data; // If it's a short string error
            }
            return NextResponse.json({ error: `Processing service failed: ${errorDetail}` }, { status: error.response.status });
        } else if (error.request) {
            // The request was made but no response was received
            console.error('No response received from microservice:', error.request);
            return NextResponse.json({ error: "No response from processing service (possible timeout or network issue)." }, { status: 504 }); // Gateway Timeout
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error('Error setting up request:', error.message);
        }
    }
    // Generic error for other issues
    return NextResponse.json({ error: `Failed to connect to processing service: ${error.message}` }, { status: 502 }); // Bad Gateway
  }
}

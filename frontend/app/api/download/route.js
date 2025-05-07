// /app/api/download/route.js

// Calls the external Python microservice to handle single MP3 downloads
// using axios for consistency and timeout control.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import axios from 'axios'; // Import axios

// Get the microservice URL from environment variables
// For local development, set this in .env.local (e.g., PYTHON_SERVICE_URL=http://localhost:8080)
const PYTHON_MICROSERVICE_URL = process.env.PYTHON_SERVICE_URL;

// Define a timeout for single downloads (e.g., 5 minutes)
// This can be shorter than for playlist operations.
const AXIOS_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export async function POST(request) {
  console.log('--- SINGLE DOWNLOAD (Calling Microservice with axios) API ROUTE HIT ---');

  if (!PYTHON_MICROSERVICE_URL) {
      console.error("PYTHON_SERVICE_URL environment variable is not set.");
      return NextResponse.json({ error: "Server configuration error: Processing service URL is missing." }, { status: 500 });
  }

  let url;
  let cookieData;
  try {
      const body = await request.json();
      url = body.url;
      cookieData = body.cookieData; // Expecting cookieData from frontend (page.js)
      if (!url) {
          return NextResponse.json({ error: 'No URL provided in request body' }, { status: 400 });
      }
  } catch (e) {
       console.error("Error parsing request body:", e);
       return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Define the target endpoint on your Python service
  const targetUrl = `${PYTHON_MICROSERVICE_URL}/process-single-mp3`;
  console.log(`Forwarding request for URL ${url} to microservice at ${targetUrl}`);
  console.log(`Cookie data being sent (length): ${cookieData ? cookieData.length : 'None'}`);


  try {
    // Make a POST request to the Python microservice
    const microserviceResponse = await axios.post(targetUrl,
      { // Data payload
          url: url,
          cookieData: cookieData // Forward cookieData
      },
      { // Axios config
          headers: { 'Content-Type': 'application/json' },
          responseType: 'stream', // We expect a file stream (the MP3)
          timeout: AXIOS_TIMEOUT_MS
      }
    );

    console.log(`Microservice responded with status ${microserviceResponse.status}`);

    // Forward headers and stream body
    const responseHeaders = new Headers();
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
    console.error('API /api/download - Error calling microservice with axios:', error);

    if (axios.isAxiosError(error)) {
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
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
            // The request was made but no response was received
            console.error('No response received from microservice:', error.request);
            return NextResponse.json({ error: "No response from processing service (possible timeout or network issue)." }, { status: 504 });
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error('Error setting up request:', error.message);
        }
    }
    // Generic error for other issues
    return NextResponse.json({ error: `Failed to connect to processing service: ${error.message}` }, { status: 502 });
  }
}

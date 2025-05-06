// /app/api/download/route.js

// Calls the external Python microservice to handle downloads.
export const runtime = 'nodejs'; // nodejs runtime is fine for fetch

import { NextResponse } from 'next/server';
// Note: No fs, os, child_process, or yt-dlp/youtube-dl libraries needed here

// Get the microservice URL from environment variables
// Set this in your Vercel project settings!
const PYTHON_MICROSERVICE_URL = process.env.PYTHON_SERVICE_URL;

export async function POST(request) {
  console.log('--- SINGLE DOWNLOAD (Calling Microservice) API ROUTE HIT ---');

  // 1. Check if the microservice URL is configured
  if (!PYTHON_MICROSERVICE_URL) {
      console.error("PYTHON_SERVICE_URL environment variable is not set.");
      return NextResponse.json({ error: "Server configuration error: Processing service URL is missing." }, { status: 500 });
  }

  // 2. Get the YouTube URL from the request body
  let url;
  try {
      const body = await request.json();
      url = body.url;
      if (!url) {
          return NextResponse.json({ error: 'No URL provided in request body' }, { status: 400 });
      }
  } catch (e) {
       console.error("Error parsing request body:", e);
       return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }


  // 3. Define the target endpoint on your Python service
  // Make sure this matches the route defined in your Flask app (app.py)
  const targetUrl = `${PYTHON_MICROSERVICE_URL}/process-single-mp3`;
  console.log(`Forwarding request for URL ${url} to microservice at ${targetUrl}`);

  try {
    // 4. Make a POST request to the Python microservice
    const microserviceResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Add any necessary authentication headers if you secure your microservice later
      },
      body: JSON.stringify({ url: url }), // Send the URL in the body
      // Consider using AbortController for timeouts on long requests if needed
    });

    // 5. Handle the response from the microservice

    // Case A: Microservice returned an error (e.g., 4xx, 5xx)
    if (!microserviceResponse.ok) {
      let errorBody = { error: `Processing service returned status ${microserviceResponse.status}` }; // Default error
      try {
          // Try to parse the error JSON sent back by the Python service
          errorBody = await microserviceResponse.json();
      } catch (e) {
          console.warn("Could not parse error response from microservice as JSON.");
          // If parsing fails, use the status text
          errorBody = { error: microserviceResponse.statusText || errorBody.error };
      }
      console.error(`Microservice responded with status ${microserviceResponse.status}:`, errorBody);
      // Forward the error status and message from the microservice
      return NextResponse.json(
        { error: `Processing service failed: ${errorBody.error}` },
        { status: microserviceResponse.status } // Use the status code from the microservice
      );
    }

    // Case B: Microservice returned success (2xx) - stream the file back

    // Ensure the response body exists
     if (!microserviceResponse.body) {
         console.error("Received empty response body from microservice (status 2xx).");
         return NextResponse.json({ error: "Received empty response body from processing service" }, { status: 500 });
     }

    // Create new headers for the client response, copying relevant ones from the microservice
    const responseHeaders = new Headers();
    const contentType = microserviceResponse.headers.get('Content-Type');
    const contentLength = microserviceResponse.headers.get('Content-Length');
    const contentDisposition = microserviceResponse.headers.get('Content-Disposition');

    // Only forward headers if they exist
    if (contentType) responseHeaders.set('Content-Type', contentType);
    if (contentLength) responseHeaders.set('Content-Length', contentLength);
    if (contentDisposition) responseHeaders.set('Content-Disposition', contentDisposition);
    // Example: Prevent client-side caching if desired
    // responseHeaders.set('Cache-Control', 'no-cache');

    console.log(`Streaming response from microservice with headers:`, Object.fromEntries(responseHeaders.entries()));

    // Return a new NextResponse, streaming the body directly from the microservice response
    // microserviceResponse.body is already a ReadableStream
    return new NextResponse(microserviceResponse.body, {
      status: 200, // Success status
      headers: responseHeaders, // Forward headers from microservice
    });

  } catch (error) {
    console.error('API /api/download - Error calling microservice:', error);
    // Handle network errors connecting to the microservice
    if (error.cause?.code === 'ECONNREFUSED') {
         return NextResponse.json({ error: "Processing service is unavailable." }, { status: 503 }); // Service Unavailable
    }
     if (error.name === 'AbortError') { // Example if using AbortController for timeout
         return NextResponse.json({ error: "Request to processing service timed out." }, { status: 504 }); // Gateway Timeout
     }
    // Generic error for other fetch issues
    return NextResponse.json({ error: `Failed to connect to processing service: ${error.message}` }, { status: 502 }); // Bad Gateway
  }
}

// No cleanup function needed here - the Python microservice handles its own temp files

// /app/api/download/route.js

// Calls the external Python microservice and forwards cookie data.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

// Get the microservice URL from environment variables
const PYTHON_MICROSERVICE_URL = process.env.PYTHON_SERVICE_URL;

export async function POST(request) {
  console.log('--- SINGLE DOWNLOAD (Forwarding Cookies) API ROUTE HIT ---');

  if (!PYTHON_MICROSERVICE_URL) {
      console.error("PYTHON_SERVICE_URL environment variable is not set.");
      return NextResponse.json({ error: "Server configuration error: Processing service URL is missing." }, { status: 500 });
  }

  // Get URL and potentially cookieData from the request body
  let url;
  let cookieData; // Variable to hold cookie data
  try {
      const body = await request.json();
      url = body.url;
      cookieData = body.cookieData; // Get cookie data from body
      if (!url) {
          return NextResponse.json({ error: 'No URL provided in request body' }, { status: 400 });
      }
       // Log presence of cookie data, not the data itself
       console.log(`Received URL: ${url}`);
       console.log(`Received Cookie Data: ${cookieData ? 'Yes (length: ' + cookieData.length + ')' : 'No'}`);

  } catch (e) {
       console.error("Error parsing request body:", e);
       return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const targetUrl = `${PYTHON_MICROSERVICE_URL}/process-single-mp3`;
  console.log(`Forwarding request to microservice at ${targetUrl}`);

  try {
    // Make a POST request to the Python microservice, including cookieData
    const microserviceResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      // *** Send both url and cookieData ***
      body: JSON.stringify({
          url: url,
          cookieData: cookieData // Pass it along (will be null if not provided)
        }),
    });

    // --- Handle the response from the microservice ---
    // (This part remains the same as before)
    if (!microserviceResponse.ok) {
      let errorBody = { error: `Processing service returned status ${microserviceResponse.status}` };
      try { errorBody = await microserviceResponse.json(); }
      catch (e) { errorBody = { error: microserviceResponse.statusText || errorBody.error }; }
      console.error(`Microservice responded with status ${microserviceResponse.status}:`, errorBody);
      return NextResponse.json( { error: `Processing service failed: ${errorBody.error}` }, { status: microserviceResponse.status } );
    }

     if (!microserviceResponse.body) {
         console.error("Received empty response body from microservice (status 2xx).");
         return NextResponse.json({ error: "Received empty response body from processing service" }, { status: 500 });
     }

    const responseHeaders = new Headers();
    const contentType = microserviceResponse.headers.get('Content-Type');
    const contentLength = microserviceResponse.headers.get('Content-Length');
    const contentDisposition = microserviceResponse.headers.get('Content-Disposition');
    if (contentType) responseHeaders.set('Content-Type', contentType);
    if (contentLength) responseHeaders.set('Content-Length', contentLength);
    if (contentDisposition) responseHeaders.set('Content-Disposition', contentDisposition);
    console.log(`Streaming response from microservice with headers:`, Object.fromEntries(responseHeaders.entries()));

    return new NextResponse(microserviceResponse.body, {
      status: 200,
      headers: responseHeaders,
    });

  } catch (error) {
    // (Error handling remains the same)
    console.error('API /api/download - Error calling microservice:', error);
    if (error.cause?.code === 'ECONNREFUSED') {
         return NextResponse.json({ error: "Processing service is unavailable." }, { status: 503 });
    }
     if (error.name === 'AbortError') {
         return NextResponse.json({ error: "Request to processing service timed out." }, { status: 504 });
     }
    return NextResponse.json({ error: `Failed to connect to processing service: ${error.message}` }, { status: 502 });
  }
}

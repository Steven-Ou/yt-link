    // /app/api/convert/route.js

    // Calls the external Python microservice to handle combining videos.
    export const runtime = 'nodejs';

    import { NextResponse } from 'next/server';

    // Get the microservice URL from environment variables
    const PYTHON_MICROSERVICE_URL = process.env.PYTHON_SERVICE_URL;

    export async function POST(request) {
      console.log('--- COMBINE VIDEO (Calling Microservice) API ROUTE HIT ---');

      if (!PYTHON_MICROSERVICE_URL) {
          console.error("PYTHON_SERVICE_URL environment variable is not set.");
          return NextResponse.json({ error: "Server configuration error: Processing service URL is missing." }, { status: 500 });
      }

      let playlistUrl;
      // Add cookieData if you implement cookie handling for combine video
      // let cookieData;
      try {
          const body = await request.json();
          playlistUrl = body.playlistUrl; // Ensure frontend sends 'playlistUrl' key
          // cookieData = body.cookieData; // If implemented
          if (!playlistUrl) {
              return NextResponse.json({ error: 'No playlistUrl provided in request body' }, { status: 400 });
          }
      } catch (e) {
           console.error("Error parsing request body:", e);
           return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
      }

      // Define the target endpoint on your Python service
      const targetUrl = `${PYTHON_MICROSERVICE_URL}/process-combine-video`; // New endpoint
      console.log(`Forwarding request for combine video ${playlistUrl} to microservice at ${targetUrl}`);

      try {
        // Make a POST request to the Python microservice
        const microserviceResponse = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', },
          body: JSON.stringify({
              playlistUrl: playlistUrl
              // cookieData: cookieData // If implemented
            }),
          // NOTE: This request might take a VERY long time.
          // Standard fetch might time out. Vercel function timeout (max 5 min on Pro, less on Hobby)
          // is the real limit here unless using Edge runtime with streaming.
        });

        // Handle the response (same logic as single download route)
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

        // Forward headers and stream body
        const responseHeaders = new Headers();
        const contentType = microserviceResponse.headers.get('Content-Type'); // Should be video/mp4 or similar
        const contentLength = microserviceResponse.headers.get('Content-Length');
        const contentDisposition = microserviceResponse.headers.get('Content-Disposition'); // Should contain video filename
        if (contentType) responseHeaders.set('Content-Type', contentType);
        if (contentLength) responseHeaders.set('Content-Length', contentLength);
        if (contentDisposition) responseHeaders.set('Content-Disposition', contentDisposition);
        console.log(`Streaming video response from microservice with headers:`, Object.fromEntries(responseHeaders.entries()));

        return new NextResponse(microserviceResponse.body, {
          status: 200,
          headers: responseHeaders,
        });

      } catch (error) {
        // (Error handling remains the same)
        console.error('API /api/convert - Error calling microservice:', error);
        if (error.cause?.code === 'ECONNREFUSED') { return NextResponse.json({ error: "Processing service is unavailable." }, { status: 503 }); }
        if (error.name === 'AbortError') { return NextResponse.json({ error: "Request to processing service timed out." }, { status: 504 }); }
        return NextResponse.json({ error: `Failed to connect to processing service: ${error.message}` }, { status: 502 });
      }
    }
    
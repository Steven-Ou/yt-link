// /app/api/start-single-video-job/route.js
export const dynamic = 'force-static';
// Calls the Python microservice to start a single Video download job.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import axios from 'axios';

export async function POST(request) {
  // Static placeholder for the build process.
  // This route is not used by the Electron desktop app.
  return NextResponse.json({ 
    status: 'This is a static build placeholder for the single video download route' 
  });

  /*
    // --- This is the dynamic code for the Electron app ---

    const PYTHON_MICROSERVICE_URL = process.env.PYTHON_SERVICE_URL;
    const AXIOS_REQUEST_TIMEOUT_MS = 10000; // 10 seconds for job initiation

    console.log('--- API /api/start-single-video-job (Start Single Video Job) ---');

    if (!PYTHON_MICROSERVICE_URL) {
        console.error("PYTHON_SERVICE_URL environment variable is not set in /api/start-single-video-job/route.js.");
        return NextResponse.json({ error: "Server configuration error: Processing service URL is missing." }, { status: 500 });
    }

    let url;
    let cookieData;
    let format; // Added format for video quality

    try {
        const body = await request.json();
        url = body.url;
        cookieData = body.cookieData; // Can be null or undefined if not provided
        format = body.format; // Get the selected video format/quality

        if (!url) {
            console.error("No url provided in request body to /api/start-single-video-job");
            return NextResponse.json({ error: 'No URL provided in request body' }, { status: 400 });
        }
        if (!format) {
            console.error("No format provided in request body to /api/start-single-video-job");
            return NextResponse.json({ error: 'No video format provided in request body' }, { status: 400 });
        }
    } catch (e) {
         console.error("Error parsing request body in /api/start-single-video-job:", e.message);
         return NextResponse.json({ error: 'Invalid request body. Ensure it is valid JSON.', details: e.message }, { status: 400 });
    }

    const targetUrl = `${PYTHON_MICROSERVICE_URL}/start-single-video-job`; // Correct Python endpoint
    console.log(`Forwarding request to start single video job for ${url} (Format: ${format}) to ${targetUrl}`);
    if (cookieData) {
      console.log(`Cookie data being sent (length): ${String(cookieData).length}`);
    } else {
      console.log('No cookie data being sent.');
    }

    try {
      const microserviceResponse = await axios.post(targetUrl,
        { 
          url: url, 
          cookieData: cookieData,
          format: format // Pass the format to Python
        },
        {
            headers: { 'Content-Type': 'application/json' },
            timeout: AXIOS_REQUEST_TIMEOUT_MS
        }
      );

      console.log('Response from Python microservice (/start-single-video-job):', microserviceResponse.data);
      return NextResponse.json(microserviceResponse.data, { status: microserviceResponse.status });

    } catch (error) {
      console.error('API /api/start-single-video-job - Error calling Python microservice:', error.message);

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

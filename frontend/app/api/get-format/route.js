// /app/api/get-formats/route.js
export const dynamic = 'force-static';
// Calls the Python microservice to get video formats.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import axios from 'axios';

export async function POST(request) {
  // Static placeholder for the build process.
  // This route is not used by the Electron desktop app.
  // We return an empty array to simulate a successful (but empty) format list.
  return NextResponse.json([]);

  /*
    // --- This is the dynamic code for the Electron app ---

    const PYTHON_MICROSERVICE_URL = process.env.PYTHON_SERVICE_URL;
    const AXIOS_REQUEST_TIMEOUT_MS = 10000; // 10 seconds

    console.log('--- API /api/get-formats ---');

    if (!PYTHON_MICROSERVICE_URL) {
        console.error("PYTHON_SERVICE_URL environment variable is not set in /api/get-formats/route.js.");
        return NextResponse.json({ error: "Server configuration error: Processing service URL is missing." }, { status: 500 });
    }

    let url;
    let cookieData;

    try {
        const body = await request.json();
        url = body.url;
        cookieData = body.cookies; // Get cookies from the request

        if (!url) {
            console.error("No url provided in request body to /api/get-formats");
            return NextResponse.json({ error: 'No URL provided in request body' }, { status: 400 });
        }
    } catch (e) {
         console.error("Error parsing request body in /api/get-formats:", e.message);
         return NextResponse.json({ error: 'Invalid request body. Ensure it is valid JSON.', details: e.message }, { status: 400 });
    }

    const targetUrl = `${PYTHON_MICROSERVICE_URL}/get-formats`; // Correct Python endpoint
    console.log(`Forwarding request to get formats for ${url} to ${targetUrl}`);

    try {
      const microserviceResponse = await axios.post(targetUrl,
        { 
          url: url, 
          cookieData: cookieData 
        },
        {
            headers: { 'Content-Type': 'application/json' },
            timeout: AXIOS_REQUEST_TIMEOUT_MS
        }
      );

      // The Python service should return a list of formats
      console.log('Response from Python microservice (/get-formats):', microserviceResponse.data);
      return NextResponse.json(microserviceResponse.data, { status: microserviceResponse.status });

    } catch (error) {
      console.error('API /api/get-formats - Error calling Python microservice:', error.message);

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
      return NextResponse.json({ error: `Failed to get formats due to an unexpected server error.`, details: error.message }, { status: 500 });
    }
  */
}

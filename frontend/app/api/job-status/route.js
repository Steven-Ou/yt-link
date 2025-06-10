// /app/api/job-status/route.js

export const dynamic = 'force-static';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
// Note: 'axios' is no longer needed for the static build, but we can leave the import.

export async function GET(request) {
  // During `next build` with `output: 'export'`, this route must be static.
  // We return a static placeholder response. This route is not used by the
  // final Electron desktop app, which calls the Python server directly.
  return NextResponse.json({ status: 'This is a static build placeholder for /api/job-status' });

  /*
    // All of your original dynamic code is commented out below to prevent build errors.
    
    const axios = require('axios'); // For clarity, moving this inside the commented block
    const PYTHON_MICROSERVICE_URL = process.env.PYTHON_SERVICE_URL;
    const AXIOS_REQUEST_TIMEOUT_MS = 5000;

    console.log('--- API /api/job-status ---');

    if (!PYTHON_MICROSERVICE_URL) {
      console.error("PYTHON_SERVICE_URL environment variable is not set in /api/job-status/route.js.");
      return NextResponse.json({ error: "Server configuration error: Processing service URL is missing." }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    if (!jobId) {
      console.error("No jobId provided in query parameters to /api/job-status");
      return NextResponse.json({ error: 'jobId query parameter is required' }, { status: 400 });
    }

    const targetUrl = `${PYTHON_MICROSERVICE_URL}/job-status/${jobId}`;
    console.log(`Requesting job status for ${jobId} from ${targetUrl}`);

    try {
      const microserviceResponse = await axios.get(targetUrl, {
          timeout: AXIOS_REQUEST_TIMEOUT_MS
      });

      console.log(`Status for job ${jobId}:`, microserviceResponse.data);
      // The Python service sends back { jobId, status, filename?, downloadUrl?, error?, message? }
      return NextResponse.json(microserviceResponse.data, { status: microserviceResponse.status });

    } catch (error) {
      console.error(`API /api/job-status - Error calling Python microservice for job ${jobId}:`, error.message);

      if (axios.isAxiosError(error)) {
          if (error.response) {
              // The Python service responded with an error status code (4xx or 5xx)
              console.error('Python service error response data:', error.response.data);
              console.error('Python service error response status:', error.response.status);
              
              const pythonErrorData = error.response.data;
              let pythonErrorMessage = "Unknown error from processing service when fetching job status";
              // Check if Python returned its own structured error
              if (typeof pythonErrorData === 'object' && pythonErrorData !== null && pythonErrorData.error) {
                  pythonErrorMessage = pythonErrorData.error;
              } else if (typeof pythonErrorData === 'string' && pythonErrorData.length > 0) { // Handle plain string errors
                  pythonErrorMessage = pythonErrorData;
              } else if (error.response.status === 404) {
                  pythonErrorMessage = `Job with ID ${jobId} not found on the processing service.`;
              } else {
                  pythonErrorMessage = error.response.statusText || pythonErrorMessage;
              }
              
              return NextResponse.json(
                  { error: `Failed to get job status: ${pythonErrorMessage}`, details: pythonErrorData },
                  { status: error.response.status || 500 }
              );
          } else if (error.request) {
              // The request was made but no response was received
              console.error('No response received from Python service (ECONNREFUSED or similar):', error.code);
              return NextResponse.json({ error: "Processing service is unavailable or did not respond while fetching job status.", details: error.code }, { status: 503 });
          }
      }
      // For other types of errors
      return NextResponse.json({ error: `Failed to get job status due to an unexpected server error.`, details: error.message }, { status: 500 });
    }
  */
}
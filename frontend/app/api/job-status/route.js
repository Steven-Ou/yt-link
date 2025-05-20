// /app/api/job-status/route.js

// Calls the Python microservice to get the status of a job.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import axios from 'axios';

const PYTHON_MICROSERVICE_URL = process.env.PYTHON_SERVICE_URL;
const AXIOS_REQUEST_TIMEOUT_MS = 5000; // 5 seconds for status check

export async function GET(request) {
  console.log('--- API /api/job-status ---');

  if (!PYTHON_MICROSERVICE_URL) {
    console.error("PYTHON_SERVICE_URL environment variable is not set.");
    return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'jobId query parameter is required' }, { status: 400 });
  }

  const targetUrl = `${PYTHON_MICROSERVICE_URL}/job-status/${jobId}`;
  console.log(`Requesting job status for ${jobId} from ${targetUrl}`);

  try {
    const microserviceResponse = await axios.get(targetUrl, {
        timeout: AXIOS_REQUEST_TIMEOUT_MS
    });

    console.log(`Status for job ${jobId}:`, microserviceResponse.data);
    // The Python service sends back { jobId, status, filename?, downloadUrl?, error? }
    return NextResponse.json(microserviceResponse.data, { status: microserviceResponse.status });

  } catch (error) {
    console.error(`API /api/job-status - Error calling microservice for job ${jobId}:`, error);
    if (axios.isAxiosError(error) && error.response) {
        console.error('Error data:', error.response.data);
        // If the job is not found on the Python service, it might return a 404
        // The Python service should return JSON for errors too.
        return NextResponse.json(
            { error: `Failed to get job status: ${error.response.data.error || error.response.statusText}` },
            { status: error.response.status }
        );
    } else if (error.code === 'ECONNREFUSED') {
        return NextResponse.json({ error: "Processing service is unavailable." }, { status: 503 });
    }
    return NextResponse.json({ error: `Failed to get job status: ${error.message}` }, { status: 502 });
  }
}

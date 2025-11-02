// /app/api/get-formats/route.js
import { NextResponse } from "next/server";
import axios from "axios";

// Remove 'force-static' to make the route dynamic
// export const dynamic = 'force-static';
export const runtime = "nodejs";

// This is the URL of your Python service.
// Your logs show it running on port 5003.
const PYTHON_MICROSERVICE_URL = "http://127.0.0.1:5003";
const AXIOS_REQUEST_TIMEOUT_MS = 10000; // 10 seconds

export async function POST(request) {
  console.log("--- API /api/get-formats (Node.js Fallback) ---");

  let body;
  try {
    body = await request.json();
    if (!body.url) {
      console.error("No url provided in request body to /api/get-formats");
      return NextResponse.json(
        { error: "No URL provided in request body" },
        { status: 400 }
      );
    }
  } catch (e) {
    console.error("Error parsing request body in /api/get-formats:", e.message);
    return NextResponse.json(
      { error: "Invalid request body.", details: e.message },
      { status: 400 }
    );
  }

  const targetUrl = `${PYTHON_MICROSERVICE_URL}/get-formats`;
  console.log(`Forwarding get-formats request to: ${targetUrl}`);

  try {
    const microserviceResponse = await axios.post(
      targetUrl,
      {
        // Pass the body directly
        url: body.url,
        cookies: body.cookies, // Your Python app expects 'cookies', not 'cookieData'
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: AXIOS_REQUEST_TIMEOUT_MS,
      }
    );

    // Forward the response from Python back to the client
    console.log("Success from Python microservice (/get-formats)");
    return NextResponse.json(microserviceResponse.data, {
      status: microserviceResponse.status,
    });
  } catch (error) {
    console.error(
      "API /api/get-formats - Error calling Python microservice:",
      error.message
    );

    if (axios.isAxiosError(error)) {
      if (error.response) {
        // Forward the Python service's error
        return NextResponse.json(
          {
            error: `Processing service failed: ${
              error.response.data?.error || "Unknown"
            }`,
            details: error.response.data,
          },
          { status: error.response.status || 500 }
        );
      } else if (error.request) {
        // Network error connecting to Python
        return NextResponse.json(
          {
            error: "Processing service is unavailable or did not respond.",
            details: error.code,
          },
          { status: 503 }
        );
      }
    }
    // Generic server error
    return NextResponse.json(
      {
        error: `Failed to get formats due to an unexpected server error.`,
        details: error.message,
      },
      { status: 500 }
    );
  }
}

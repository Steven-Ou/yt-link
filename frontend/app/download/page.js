"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import UpdateStatus from "../components/UpdateStatus";

function DownloadPageContent() {
  const [url, setUrl] = useState("");
  const [jobId, setJobId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const searchParams = useSearchParams();

  useEffect(() => {
    const urlFromParams = searchParams.get("url");
    if (urlFromParams) {
      setUrl(decodeURIComponent(urlFromParams));
    }
  }, [searchParams]);

  const startJob = async (jobType) => {
    setIsLoading(true);
    setJobId(null);
    setError(null);
    try {
      const response = await fetch("http://localhost:5001/start-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, jobType }),
      });
      if (!response.ok) {
        throw new Error("Failed to start job on the backend.");
      }
      const data = await response.json();
      setJobId(data.jobId);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-12 bg-gray-900 text-white">
      <div className="z-10 w-full max-w-5xl items-center justify-between font-mono text-sm lg:flex flex-col">
        <h1 className="text-4xl font-bold mb-8">Download Video</h1>
        <p className="text-gray-400 mb-6">
          The video will be downloaded in the best available MP4 format.
        </p>
        <div className="w-full max-w-xl">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="YouTube URL is passed from the previous page"
            className="w-full px-4 py-3 mb-4 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex justify-center space-x-4">
            <button
              onClick={() => startJob("downloadVideo")}
              disabled={isLoading || !url}
              className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg transition duration-300 ease-in-out disabled:bg-gray-400"
            >
              {isLoading ? "Processing..." : "Download Video as MP4"}
            </button>
          </div>
        </div>

        {error && <p>
          </p>}
      </div>
    </main>
  );
}

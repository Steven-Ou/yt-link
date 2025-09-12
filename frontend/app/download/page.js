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

  return(
    <main className="flex min-h-screen flex-col items-center justify-between p-12 bg-gray-900 text-white">
      <div>
        <h1></h1>
        <p>

        </p>
        <div>
          <input/>
          <div>

          </div>
        </div>
      </div>
    </main>
  )
}

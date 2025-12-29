"use client";

import { useState, useCallback } from "react";

/**
 * @typedef {{
 * post: (endpoint: string, body: Record<string, any>) => Promise<{ data: any, error: string | null }>,
 * isApiLoading: boolean,
 * error: string | null
 * }} UseApiHook
 */

/**
 * @returns {UseApiHook}
 */
export const useApi = () => {
  const [isApiLoading, setIsApiLoading] = useState(false);
  const [error, setError] = useState(null);

  
  const post = useCallback(async (endpoint, body, currentJobs) => {
    setIsApiLoading(true);
    setError(null);

    const url = body.url;
    const jobType = body.jobType;

    if (url && jobType && currentJobs) {
      const isDuplicate = Object.values(currentJobs).some(
        (job) => 
          job.url === url && 
          job.job_type === jobType && 
          ['downloading', 'processing', 'queued'].includes(job.status)
      );

      if (isDuplicate) {
        console.warn(`[useApi] Duplicate job detected for ${jobType}. Intent already processing.`);
        setIsApiLoading(false);
        return { data: null, error: "This download is already in progress." };
      }
    }
    // --- START OF THE FIX ---

    // 1. Check if we are running in the Electron app
    // @ts-ignore
    const isElectron = !!window.electronAPI?.getBackendUrl;

    let baseUrl = "";
    let finalEndpoint = endpoint;

    if (isElectron) {
      // 2. We ARE in the packaged app. Get the Python URL.
      // @ts-ignore
      baseUrl = window.electronAPI.getBackendUrl(); // e.g., "http://127.0.0.1:5003"
      // 3. Remove the "/api" prefix, because the Python service doesn't use it.
      finalEndpoint = endpoint.replace("/api/", "/"); // e.g., "/api/get-formats" -> "/get-formats"
    }

    // 4. Construct the final URL
    // In DEV: baseUrl is "" and finalEndpoint is "/api/get-formats"
    //    -> fullUrl = "/api/get-formats" (Correct for Next.js dev server)
    // In PROD: baseUrl is "http://..." and finalEndpoint is "/get-formats"
    //    -> fullUrl = "http://127.0.0.1:5003/get-formats" (Correct for Python backend)
    const fullUrl = baseUrl + finalEndpoint;

    console.log(`[useApi] Fetching: ${fullUrl}`);

    // --- END OF THE FIX ---

    try {
      const response = await fetch(fullUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          errorData.error ||
          errorData.details ||
          `Server error: ${response.status} ${response.statusText}`;
        console.error(`API Error on ${endpoint}:`, errorMessage);
        throw new Error(errorMessage);
      }

      const data = await response.json();
      return { data, error: null };
    } catch (err) {
      console.error(`API Error on ${endpoint}:`, err.message);
      // @ts-ignore
      setError(err.message);
      // @ts-ignore
      return { data: null, error: err.message };
    } finally {
      setIsApiLoading(false);
    }
  }, []);

  return { post, isApiLoading, error };
};

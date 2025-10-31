"use client";

import { useState, useCallback } from "react";

/**
 * A custom hook to simplify API fetch calls.
 * It manages loading state and error handling.
 */
export const useApi = () => {
  const [isApiLoading, setIsApiLoading] = useState(false);

  /**
   * Performs a POST request.
   * @param {string} url - The API endpoint to call.
   * @param {object} body - The JSON body to send.
   * @returns {Promise<{data: any, error: string | null}>}
   */
  const post = useCallback(async (url, body) => {
    setIsApiLoading(true);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData.error || "API request failed");
      }

      setIsApiLoading(false);
      return { data: responseData, error: null };
    } catch (error) {
      console.error(`API Error on POST ${url}:`, error);
      setIsApiLoading(false);
      return { data: null, error: error.message || "An unknown error occurred" };
    }
  }, []); // useCallback ensures this function doesn't change on re-renders

  // You could add 'get', 'put', 'delete' methods here in the future if needed

  return { post, isApiLoading };
};

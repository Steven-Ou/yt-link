import { useEffect, useRef } from 'react';

/**
 * A non-visual component that polls the backend for job status updates.
 * @param {object} props - The component props.
 * @param {string} props.jobId - The ID of the job to poll.
 * @param {function} props.setJobStatus - The state setter function from the parent component.
 * @param {boolean} props.isJobRunning - A flag to control the polling loop.
 */
export default function UpdateStatus({ jobId, setJobStatus, isJobRunning }) {
  // Use a ref to hold the interval ID so it persists across re-renders
  const intervalRef = useRef(null);

  useEffect(() => {
    // Function to fetch the current job status from the backend
    const checkJobStatus = async () => {
      if (!jobId) return;

      try {
        const response = await fetch(`/api/job-status?jobId=${jobId}`);
        
        // If the server responds with an error, stop polling and update status.
        if (!response.ok) {
          console.error('Failed to fetch job status. Server responded with:', response.status);
          // Keep previous details if available, otherwise set a generic error.
          setJobStatus(prev => ({
              ...prev,
              status: 'failed',
              details: prev.details || 'Error fetching status from server.'
          }));
          if (intervalRef.current) clearInterval(intervalRef.current);
          return;
        }

        const data = await response.json();

        // Update the parent component's state with the new status object
        setJobStatus(data);

        // If the job is finished (completed or failed), stop the polling.
        if (data.status === 'completed' || data.status === 'failed') {
          if (intervalRef.current) clearInterval(intervalRef.current);
        }
      } catch (error) {
        // If there's a network error, stop polling and update status.
        console.error('Network error while checking job status:', error);
        setJobStatus(prev => ({ ...prev, status: 'failed', details: 'Network error checking status.' }));
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    };

    // --- Interval Management ---

    // Clear any existing interval when the component re-renders or unmounts.
    // This is a crucial cleanup step to prevent memory leaks.
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    
    // If there is an active job, start polling.
    if (jobId && isJobRunning) {
        // Fetch status immediately on start, then begin the interval.
        checkJobStatus();
        intervalRef.current = setInterval(checkJobStatus, 2000); // Poll every 2 seconds
    }

    // The return function from useEffect is the cleanup function.
    // It runs when the component unmounts or before the effect runs again.
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [jobId, isJobRunning, setJobStatus]); // Dependencies for the useEffect hook

  // This component does not render any UI elements itself.
  return null;
}

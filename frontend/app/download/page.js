"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Container,
  Typography,
  Box,
  CircularProgress,
  Alert,
  Button,
} from "@mui/material";
import { ArrowBack as ArrowBackIcon } from "@mui/icons-material";
import JobCard from "../components/JobCard"; // --- MODIFIED: Import the new component ---

// This is the main polling logic component
function DownloadPageContent() {
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState(null);
  const [isOnline, setIsOnline] = useState(true);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Utility to start a job
  const startJob = useCallback(async (jobType, url, quality) => {
    try {
      const response = await fetch("/api/start-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobType,
          url,
          quality,
          cookies: localStorage.getItem("youtubeCookies") || "",
        }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to start job");
      }
      const data = await response.json();
      return {
        jobId: data.jobId,
        url: url,
        jobType: jobType,
        status: "queued",
        message: "Job is queued...",
        progress: 0,
      };
    } catch (err) {
      setError(`Failed to start download for ${url}. Error: ${err.message}`);
      return null;
    }
  }, []);

  // Effect to start the initial job from URL parameters
  useEffect(() => {
    const jobType = searchParams.get("jobType");
    const url = searchParams.get("url");
    const quality = searchParams.get("quality");

    if (jobType && url) {
      const newJobId = `temp-${Date.now()}`; // Temporary ID
      const newJob = {
        jobId: newJobId,
        url,
        jobType,
        status: "starting",
        message: "Starting job...",
        progress: 0,
      };
      setJobs([newJob]);

      startJob(jobType, url, quality).then((startedJob) => {
        if (startedJob) {
          // Replace temporary job with real one
          setJobs((prevJobs) =>
            prevJobs.map((j) => (j.jobId === newJobId ? startedJob : j))
          );
        } else {
          // Remove temporary job if starting failed
          setJobs((prevJobs) => prevJobs.filter((j) => j.jobId !== newJobId));
        }
      });
      // Clear URL params after starting
      router.replace("/download");
    }
  }, [searchParams, startJob, router]);

  // Effect for polling job statuses
  useEffect(() => {
    if (jobs.length === 0) return;

    const activeJobs = jobs.filter(
      (j) => !["completed", "failed"].includes(j.status)
    );

    if (activeJobs.length === 0) return;

    const intervalId = setInterval(async () => {
      const updates = await Promise.all(
        activeJobs.map(async (job) => {
          try {
            const response = await fetch(`/api/job-status?jobId=${job.jobId}`);
            if (!response.ok)
              return { ...job, message: "Error fetching status..." };
            const data = await response.json();
            return data;
          } catch (e) {
            return { ...job, message: "Polling failed..." };
          }
        })
      );

      // Update the jobs list with new statuses
      setJobs((prevJobs) =>
        prevJobs.map((oldJob) => {
          const updatedJob = updates.find((u) => u.jobId === oldJob.jobId);
          return updatedJob || oldJob;
        })
      );
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(intervalId);
  }, [jobs]);

  // --- Handlers for Pause/Resume/Close ---

  const handlePauseAll = async () => {
    try {
      await fetch("/api/pause-all-jobs", { method: "POST" });
      // The poller will automatically pick up the 'paused' status
    } catch (e) {
      console.error("Failed to pause jobs:", e);
    }
  };

  const handleResume = async (jobId) => {
    try {
      await fetch(`/api/resume-job/${jobId}`, { method: "POST" });
      // Set status to queued immediately for better UI feedback
      setJobs((prevJobs) =>
        prevJobs.map((job) =>
          job.jobId === jobId
            ? { ...job, status: "queued", message: "Resuming..." }
            : job
        )
      );
    } catch (e) {
      console.error("Failed to resume job:", e);
    }
  };

  // --- NEW: Handler to close/dismiss a job card ---
  const handleCloseJob = (jobId) => {
    setJobs((prevJobs) => prevJobs.filter((job) => job.jobId !== jobId));
  };
  // --- END NEW HANDLER ---

  // Effect for network online/offline status
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => {
      setIsOnline(false);
      handlePauseAll();
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []); // Empty dependency array, so it runs once

  if (jobs.length === 0 && !error) {
    return (
      <Container maxWidth="md" sx={{ textAlign: "center", mt: 10 }}>
        <CircularProgress />
        <Typography variant="h6" sx={{ mt: 2 }}>
          Loading download...
        </Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ pt: 4, pb: 4 }}>
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() => router.push("/")}
        sx={{ mb: 2 }}
      >
        Back to Home
      </Button>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
        Downloads
      </Typography>

      {!isOnline && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          You are offline. All downloads have been paused.
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box>
        {jobs.length === 0 && <Typography>No active downloads.</Typography>}
        {/* --- MODIFIED: Render a JobCard for each job --- */}
        {jobs.map((job) => (
          <JobCard
            key={job.jobId}
            job={job}
            onResume={handleResume}
            onClose={handleCloseJob} // Pass the close handler
          />
        ))}
      </Box>
    </Container>
  );
}

// Suspense wrapper for Next.js
export default function DownloadPage() {
  return (
    <Suspense
      fallback={
        <Container maxWidth="md" sx={{ textAlign: "center", mt: 10 }}>
          <CircularProgress />
        </Container>
      }
    >
      <DownloadPageContent />
    </Suspense>
  );
}

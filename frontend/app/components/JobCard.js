"use client";

import {
  Paper,
  Typography,
  Box,
  LinearProgress,
  Button,
  Alert,
  IconButton,
} from "@mui/material";
import {
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  HourglassTop as HourglassTopIcon,
  Download as DownloadIcon,
  PlayArrow as PlayArrowIcon,
  Close as CloseIcon,
} from "@mui/icons-material";

// Helper function to get the right icon based on status
const getStatusIcon = (status) => {
  switch (status) {
    case "completed":
      return <CheckCircleIcon color="success" />;
    case "failed":
    case "error":
      return <ErrorIcon color="error" />;
    case "queued":
      return <HourglassTopIcon color="action" />;
    case "paused":
      return <PlayArrowIcon color="primary" />;
    default:
      return <DownloadIcon color="primary" />;
  }
};

export default function JobCard({ job, onResume, onClose }) {
  const isDone = job.status === "completed";
  const isFailed = job.status === "failed" || job.status === "error";
  const isPaused = job.status === "paused";

  // --- Playlist Progress Logic ---
  // This logic calculates the *overall* playlist progress,
  // not just the progress of a single file.
  let overallProgress = job.progress || 0;
  
  // Check for the "[1/50]" pattern in the message
  const match = job.message.match(/\[(\d+)\/(\d+)\]/); 

  if (match) {
    try {
      const index = parseFloat(match[1]); // Current file number
      const count = parseFloat(match[2]); // Total files
      const currentFileProgress = (job.progress || 0) / 100; // Progress of current file (0 to 1)

      if (count > 0) {
        // 1. Calculate progress from all *completed* files
        const progressOfCompletedFiles = ((index - 1) / count) * 100;
        // 2. Calculate progress of the *current* file (relative to the total job)
        const progressOfCurrentFile = currentFileProgress * (100 / count);

        // Add them together for the total overall progress
        overallProgress = progressOfCompletedFiles + progressOfCurrentFile;
      }
    } catch (e) {
      console.error("Error parsing progress:", e);
      // Fallback to single file progress if parsing fails
      overallProgress = job.progress || 0;
    }
  }
  // --- End Playlist Progress Logic ---

  return (
    <Paper
      elevation={2}
      sx={{
        p: 2,
        mb: 2,
        backgroundColor: "white",
        borderRadius: "8px",
        position: "relative", // Needed for positioning the close button
      }}
    >
      {/* --- Close Button --- */}
      {(isDone || isFailed) && (
        <IconButton
          aria-label="Close"
          onClick={() => onClose(job.jobId)}
          sx={{
            position: "absolute",
            top: 8,
            right: 8,
            color: (theme) => theme.palette.grey[500],
          }}
        >
          <CloseIcon />
        </IconButton>
      )}
      {/* --- End Close Button --- */}

      <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
        {getStatusIcon(job.status)}
        <Typography variant="h6" sx={{ ml: 1, fontWeight: "500" }}>
          {job.url.length > 50 ? `${job.url.substring(0, 50)}...` : job.url}
        </Typography>
      </Box>

      <Typography
        variant="body2"
        sx={{
          mb: 1,
          fontFamily: "monospace",
          color: "text.secondary",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {job.message}
      </Typography>

      {/* Show progress bar if not done, failed, or paused */}
      {!isDone && !isFailed && !isPaused && (
        <LinearProgress
          variant="determinate"
          value={overallProgress} // Use the new overallProgress
          sx={{ height: "8px", borderRadius: "4px", mb: 2 }}
        />
      )}

      {/* Show error message if failed */}
      {isFailed && job.error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          <strong>Error:</strong> {job.error}
        </Alert>
      )}

      {/* Show action buttons */}
      <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 2 }}>
        {isPaused && (
          <Button
            variant="contained"
            color="primary"
            startIcon={<PlayArrowIcon />}
            onClick={() => onResume(job.jobId)}
          >
            Resume
          </Button>
        )}
        {isDone && (
          <Button
            variant="contained"
            color="success"
            startIcon={<DownloadIcon />}
            href={`/api/download/${job.jobId}`}
          >
            Download File
          </Button>
        )}
      </Box>
    </Paper>
  );
}

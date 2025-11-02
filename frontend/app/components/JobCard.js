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

  let overallProgress = job.progress || 0;
  const match = job.message.match(/\[(\d+)\/(\d+)\]/);
  if (match) {
    try {
      const index = parseFloat(match[1]);
      const count = parseFloat(match[2]);
      const currentFileProgress = (job.progress || 0) / 100;
      if (count > 0) {
        const progressOfCompletedFiles = ((index - 1) / count) * 100;
        const progressOfCurrentFile = currentFileProgress * (100 / count);
        overallProgress = progressOfCompletedFiles + progressOfCurrentFile;
      }
    } catch (e) {
      console.error("Error parsing progress:", e);
      overallProgress = job.progress || 0;
    }
  }
  const displayName = job?.file_name || "Processing...";
  const displayUrl = job?.url || "Starting job...";

  return (
    <Paper
      elevation={2}
      sx={{
        p: 2,
        mb: 2,
        backgroundColor: "white",
        borderRadius: "8px",
        position: "relative",
      }}
    >
      {(job.status === "completed" || job.status === "failed") && (
        <IconButton
          size="small"
          aria-label="Close"
          onClick={() => typeof onClose === "function" && onClose(job.job_id)}
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

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          mb: 1,
          minWidth: 0, 
          maxWidth: "calc(100% - 40px)",
        }}
      >
        {getStatusIcon(job.status)}
        <Typography
          variant="h6"
          sx={{
            ml: 1,
            fontWeight: "500",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={displayName} // Show full filename on hover
        >
          {displayName}
        </Typography>
      </Box>

      <Typography
        variant="body2"
        sx={{
          mb: 2,
          color: "text.secondary",
          overflowWrap: "break-word",
          wordBreak: "break-all",
        }}
        title={displayUrl} // Show full URL on hover
      >
        {displayUrl}
      </Typography>

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

      {!isDone && !isFailed && !isPaused && (
        <LinearProgress
          variant="determinate"
          value={overallProgress} // Use the new overallProgress
          sx={{ height: "8px", borderRadius: "4px", mb: 2 }}
        />
      )}

      {isFailed && job.error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          <strong>Error:</strong> {job.error}
        </Alert>
      )}

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
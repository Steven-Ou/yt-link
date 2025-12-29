"use client";

import {
  Container,
  Typography,
  Paper,
  Stack,
  TextField,
  Button,
  CircularProgress,
  Box,
  Alert,
} from "@mui/material";
import {
  Download as DownloadIcon,
  Search as SearchIcon,
} from "@mui/icons-material";
import JobCard from "../JobCard";


// This component is based on your renderCombineMp3Form() function
export default function CombineMp3View({
  url,
  setUrl,
  isDownloading,
  handleDownload,
  error,
  currentJob,
  handleClearJob,
  jobs,
}) {
  const onCombineClick = () => {
    if (!url) return;

    const isDuplicate = Object.values(jobs || {}).some(
      (job) => 
        job.url === url && 
        job.job_type === "combineMp3" && 
        ["downloading", "processing", "queued"].includes(job.status)
    );

    if (isDuplicate) {
      alert("This combination job is already in progress.");
      return;
    }

    handleDownload("combineMp3");
  };
  return (
    <Container maxWidth="md">
      <Paper elevation={3} sx={{ p: 4, mt: 4 }}>
        <Typography variant="h4" gutterBottom>
          Combine Playlist to Single MP3
        </Typography>
        <Typography variant="body2" color="textSecondary" paragraph>
          This will download all tracks in a playlist and merge them into one
          large MP3 file. Great for albums or long mixes.
        </Typography>
        <Stack spacing={2} sx={{ mt: 2 }}>
          <TextField
            label="YouTube Playlist URL"
            variant="outlined"
            fullWidth
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isDownloading}
          />
          <Button
            variant="contained"
            color="primary"
            startIcon={
              isDownloading ? (
                <CircularProgress size={20} color="inherit" />
              ) : (
                <DownloadIcon />
              )
            }
            disabled={isDownloading || !url}
            onClick={() => handleDownload("combineMp3")}
            sx={{ height: 56 }}
          >
            {isDownloading ? "Starting..." : "Download & Combine"}
          </Button>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
          <Box sx={{ mt: 4 }}>
            {currentJob &&
              typeof currentJob === "object" &&
              Object.values(currentJob).map((job) => (
                <Box key={job.job_id} sx={{ mb: 2 }}>
                  <JobCard
                    job={job}
                    onClose={() => handleClearJob(job.job_id)}
                  />
                </Box>
              ))}
          </Box>
        </Stack>
      </Paper>
    </Container>
  );
}

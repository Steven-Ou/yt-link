"use client";

import {
  Container,
  Typography,
  Paper,
  Stack,
  TextField,
  Button,
  CircularProgress,
  Alert,
  Box,
} from "@mui/material";
import {
  Download as DownloadIcon,
  Search as SearchIcon,
} from "@mui/icons-material";
import JobCard from "../JobCard";

// This component is based on your renderSingleMp3Form() function
export default function SingleMp3View({
  url,
  setUrl,
  isDownloading,
  handleDownload,
  error,
  currentJob,
  handleClearJob,
}) {
  return (
    <Container maxWidth="md">
      <Paper elevation={3} sx={{ p: 4, mt: 4 }}>
        <Typography variant="h4" gutterBottom>
          Download Single MP3
        </Typography>
        <Stack spacing={2} sx={{ mt: 2 }}>
          <TextField
            label="YouTube Video URL"
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
            onClick={() => handleDownload("singleMp3")}
            sx={{ height: 56 }}
          >
            {isDownloading ? "Starting..." : "Download MP3"}
          </Button>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
          <Box sx={{ mt: 4 }}>
            {Object.values(currentJob).map((job) => (
              <Box key={job.job_id} sx={{ mb: 2 }}>
                <JobCard job={job} onClose={() => handleClearJob(job.job_id)} />
              </Box>
            ))}
          </Box>
        </Stack>
      </Paper>
    </Container>
  );
}

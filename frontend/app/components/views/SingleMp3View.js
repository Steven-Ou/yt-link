"use client";

import {
  Box,
  TextField,
  Button,
  Typography,
  Paper,
  Container,
  Stack,
} from "@mui/material";
import { Download as DownloadIcon } from "@mui/icons-material";
import JobCard from "../JobCard";

export default function SingleMp3View({
  url,
  setUrl,
  error,
  currentJob,
  handleDownload,
  handleClearJob,
  isDownloading,
}) {
  return (
    <Container maxWidth="md">
      <Paper elevation={3} sx={{ p: 4, mt: 4, borderRadius: "12px" }}>
        <Typography
          variant="h4"
          gutterBottom
          sx={{ fontWeight: "bold", color: "primary.main", mb: 3 }}
        >
          Download Single MP3
        </Typography>

        <Stack spacing={3}>
          <TextField
            fullWidth
            label="YouTube Video URL"
            variant="outlined"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            error={!!error}
            helperText={error}
          />

          <Button
            fullWidth
            variant="contained"
            size="large"
            startIcon={<DownloadIcon />}
            onClick={() => handleDownload("singleMp3")}
            disabled={isDownloading}
            sx={{ py: 1.5, fontSize: "1.1rem" }}
          >
            {isDownloading ? "Starting..." : "Download MP3"}
          </Button>
        </Stack>

        {/* UPGRADE: Loop through all active jobs */}
        <Box sx={{ mt: 4 }}>
          {currentJob &&
            typeof currentJob === "object" &&
            Object.values(currentJob).map((job) => (
              <Box key={job.job_id} sx={{ mb: 2 }}>
                <JobCard job={job} onClose={() => handleClearJob(job.job_id)} />
              </Box>
            ))}
        </Box>
      </Paper>
    </Container>
  );
}

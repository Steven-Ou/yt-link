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
}) {
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
          {currentJob && (
            <Box sx={{ mt: 3 }}>
              <JobCard job={currentJob} />
            </Box>
          )}
        </Stack>
      </Paper>
    </Container>
  );
}

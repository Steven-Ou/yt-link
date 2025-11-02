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
} from "@mui/material";
import { Download as DownloadIcon } from "@mui/icons-material";

// This component is based on your renderPlaylistZipForm() function
export default function PlaylistZipView({
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
          Download Playlist as .zip
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
            onClick={() => handleDownload("playlistZip")}
            sx={{ height: 56 }}
          >
            {isDownloading ? "Starting..." : "Download as .zip"}
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

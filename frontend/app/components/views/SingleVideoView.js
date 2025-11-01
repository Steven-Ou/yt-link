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
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Box,
} from "@mui/material";
import {
  Download as DownloadIcon,
  Search as SearchIcon,
} from "@mui/icons-material";

// This component is based on your renderSingleVideoForm() function
export default function SingleVideoView({
  url,
  setUrl,
  formats,
  selectedFormat,
  setSelectedFormat,
  isLoadingFormats,
  handleGetFormats,
  isDownloading,
  handleDownload,
  error,
}) {
  return (
    <Container maxWidth="md">
      <Paper elevation={3} sx={{ p: 4, mt: 4 }}>
        <Typography variant="h4" gutterBottom>
          Download Single Video (MP4)
        </Typography>
        <Stack spacing={2} sx={{ mt: 2 }}>
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              label="YouTube Video URL"
              variant="outlined"
              fullWidth
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isDownloading || isLoadingFormats}
            />
            <Button
              variant="outlined"
              onClick={handleGetFormats}
              disabled={isLoadingFormats || !url}
              sx={{ flexShrink: 0, width: "160px" }}
              startIcon={
                isLoadingFormats ? (
                  <CircularProgress size={20} />
                ) : (
                  <SearchIcon />
                )
              }
            >
              Get Formats
            </Button>
          </Box>
          <FormControl
            fullWidth
            disabled={isDownloading || formats.length === 0}
          >
            <InputLabel id="format-select-label">Select Quality</InputLabel>
            <Select
              labelId="format-select-label"
              value={selectedFormat}
              label="Select Quality"
              onChange={(e) => setSelectedFormat(e.target.value)}
            >
              {formats.map((format) => (
                <MenuItem key={format.format_id} value={format.format_id}>
                  {format.resolution} - ({format.note})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
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
            disabled={isDownloading || !url || !selectedFormat}
            onClick={() => handleDownload("singleVideo")}
            sx={{ height: 56 }}
          >
            {isDownloading ? "Starting..." : "Download Video"}
          </Button>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </Stack>
      </Paper>
    </Container>
  );
}

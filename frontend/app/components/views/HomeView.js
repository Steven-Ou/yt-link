"use client";

import {
  Box,
  Button,
  Container,
  Paper,
  Stack,
  Typography,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Alert,
} from "@mui/material";

// This is the "Home" page component.
export default function HomeView({
  url,
  setUrl,
  error,
  isApiLoading,
  handleGetFormats,
  formats,
  setCurrentView, // Added for navigation
}) {
  return (
    // --- MODIFIED: Wrapped in Container and Paper to restore original centered look ---
    <Container maxWidth="md">
      <Paper
        elevation={3}
        sx={{
          p: { xs: 3, sm: 4 }, // Add padding
          textAlign: "center", // Center all content
          borderRadius: "12px",
        }}
      >
        <Typography
          variant="h3"
          component="h1"
          gutterBottom
          sx={{ fontWeight: 700 }}
        >
          YT-Link
        </Typography>
        <Typography variant="h6" color="text.secondary" sx={{ mb: 4 }}>
          Download YouTube Videos and Playlists
        </Typography>

        <Stack spacing={2} sx={{ maxWidth: 600, margin: "0 auto" }}>
          <TextField
            fullWidth
            label="YouTube URL"
            variant="outlined"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
          />

          {error && <Alert severity="error">{error}</Alert>}

          {formats.length > 0 && (
            <FormControl fullWidth>
              <InputLabel id="quality-select-label">Video Quality</InputLabel>
              <Select
                labelId="quality-select-label"
                label="Video Quality"
                value={formats[0].height} // Simplified, assumes formats[0] is 'best'
                disabled
              >
                <MenuItem value={formats[0].height}>
                  {`${formats[0].resolution} (${formats[0].note})`}
                </MenuItem>
              </Select>
            </FormControl>
          )}

          <Button
            variant="contained"
            color="primary"
            size="large"
            onClick={handleGetFormats}
            disabled={isApiLoading || !url}
            startIcon={
              isApiLoading ? (
                <CircularProgress size={20} color="inherit" />
              ) : null
            }
          >
            {isApiLoading ? "Loading..." : "Get Started"}
          </Button>

          {/* --- NEW: Added back the "How to use" button --- */}
          <Button
            variant="outlined"
            color="secondary"
            size="large"
            onClick={() => setCurrentView("cookies")}
          >
            How to use (Get Cookies)
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}

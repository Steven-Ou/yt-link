"use client";

import {
  Box,
  Button,
  Container,
  Paper,
  Stack,
  Typography,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Divider,
} from "@mui/material";
import {
  GitHub as GitHubIcon,
  QueueMusic as QueueMusicIcon,
  Folder as FolderIcon,
  VideoLibrary as VideoLibraryIcon,
  OndemandVideo as OndemandVideoIcon,
} from "@mui/icons-material";

// This is the "Home" page component.
// --- MODIFIED: Removed all download-related props ---
export default function HomeView() {
  return (
    <Container maxWidth="md">
      <Paper
        elevation={3}
        sx={{
          p: { xs: 3, sm: 4 },
          borderRadius: "12px",
        }}
      >
        <Box sx={{ textAlign: "center" }}>
          <Typography
            variant="h3"
            component="h1"
            gutterBottom
            sx={{ fontWeight: 700 }}
          >
            Welcome to YT-Link
          </Typography>
          <Typography variant="h6" color="text.secondary" sx={{ mb: 4 }}>
            Your self-hosted tool for downloading YouTube content.
          </Typography>
        </Box>

        <Typography variant="body1" sx={{ mb: 2 }}>
          This application provides a suite of tools to download videos and
          audio from YouTube. Use the menu on the left to navigate between the
          different downloaders.
        </Typography>

        {/* --- NEW: Feature List --- */}
        <List>
          <ListItem>
            <ListItemIcon>
              <OndemandVideoIcon />
            </ListItemIcon>
            <ListItemText
              primary="Single Video"
              secondary="Download a single video in MP4 format."
            />
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <QueueMusicIcon />
            </ListItemIcon>
            <ListItemText
              primary="Single MP3"
              secondary="Extract and download the audio from a single video as an MP3 file."
            />
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <FolderIcon />
            </ListItemIcon>
            <ListItemText
              primary="Playlist Zip"
              secondary="Download an entire playlist (or a specified range) as a ZIP file of MP3s."
            />
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <VideoLibraryIcon />
            </ListItemIcon>
            <ListItemText
              primary="Combine Playlist MP3"
              secondary="Download a playlist and automatically merge all audio tracks into a single MP3 file."
            />
          </ListItem>
        </List>

        <Divider sx={{ my: 3 }} />

        {/* --- MODIFIED: Replaced download form with GitHub link --- */}
        <Stack
          spacing={2}
          sx={{
            maxWidth: 400,
            margin: "0 auto",
            textAlign: "center",
          }}
        >
          <Typography variant="body2" color="text.secondary">
            This is an open-source project. Check out the GitHub repository for
            updates, documentation, and releases.
          </Typography>
          <Button
            variant="contained"
            color="secondary"
            size="large"
            component="a"
            href="https://github.com/steven-ou/yt-link/releases"
            target="_blank"
            rel="noopener noreferrer"
            startIcon={<GitHubIcon />}
          >
            View GitHub Releases
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}

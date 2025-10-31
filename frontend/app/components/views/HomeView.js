"use client";

import {
  Container,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import {
  CheckCircleOutline as CheckCircleOutlineIcon,
  Apple as AppleIcon,
  Window as WindowsIcon,
} from "@mui/icons-material";

// This component is based on your renderHome() function
export default function HomeView() {
  return (
    <Container maxWidth="md">
      <Paper elevation={3} sx={{ p: 4, mt: 4 }}>
        <Typography variant="h4" gutterBottom>
          Welcome to yt-link!
        </Typography>
        <Typography variant="body1" paragraph>
          This is a simple tool to help you download YouTube videos and
          playlists as MP3 or MP4 files.
        </Typography>
        <Typography variant="h6" gutterBottom>
          Features
        </Typography>
        <List>
          <ListItem>
            <ListItemIcon>
              <CheckCircleOutlineIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary="Download single videos as MP3s" />
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <CheckCircleOutlineIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary="Download entire playlists as a ZIP file of MP3s" />
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <CheckCircleOutlineIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary="Combine an entire playlist into a single MP3 file" />
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <CheckCircleOutlineIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary="Download videos as MP4s at various resolutions" />
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <CheckCircleOutlineIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary="Supports private/members-only videos using cookies" />
          </ListItem>
        </List>
        <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>
          Platform Support
        </Typography>
        <List>
          <ListItem>
            <ListItemIcon>
              <AppleIcon />
            </ListItemIcon>
            <ListItemText primary="macOS (Apple Silicon & Intel)" />
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <WindowsIcon />
            </ListItemIcon>
            <ListItemText primary="Windows (x64)" />
          </ListItem>
        </List>
      </Paper>
    </Container>
  );
}

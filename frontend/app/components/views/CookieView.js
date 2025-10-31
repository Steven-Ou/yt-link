"use client";

import {
  Box,
  Button,
  Container,
  Paper,
  Typography,
  TextField,
  Alert,
  AlertTitle,
  Link,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import { Check as CheckIcon } from "@mui/icons-material";

// This is the "Cookies" page component.
export default function CookieView({
  cookies,
  setCookies,
  cookieStatus, // --- MODIFIED: Now expects 'cookieStatus' object ---
  handleSaveCookies,
}) {
  return (
    <Container maxWidth="md">
      <Paper elevation={3} sx={{ p: { xs: 3, sm: 4 }, borderRadius: "12px" }}>
        <Typography
          variant="h4"
          component="h1"
          gutterBottom
          sx={{ fontWeight: 700, textAlign: "center" }}
        >
          How to Get Your YouTube Cookies
        </Typography>
        <Typography
          variant="body1"
          color="text.secondary"
          sx={{ mb: 3, textAlign: "center" }}
        >
          To download age-restricted or private content, you must be logged in.
          Pasting your cookies here lets the app download on your behalf.
        </Typography>

        <List sx={{ mb: 2 }}>
          <ListItem>
            <ListItemIcon>
              <CheckIcon color="primary" />
            </ListItemIcon>
            <ListItemText
              primary="Install a browser extension"
              secondary={
                <Link
                  href="https://chrome.google.com/webstore/detail/get-cookies-txt-locally/caijnbmfjsonpmnbnkmbkjaopikfdldb"
                  target="_blank"
                  rel="noopener"
                >
                  Get Cookies.txt LOCALLY (Recommended for Chrome)
                </Link>
              }
            />
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <CheckIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary="Go to YouTube.com and make sure you are logged in." />
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <CheckIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary="Click the extension icon and export your cookies." />
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <CheckIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary="Open the downloaded .txt file and paste the contents here." />
          </ListItem>
        </List>

        <TextField
          fullWidth
          label="Paste Cookies Here"
          multiline
          rows={10}
          variant="outlined"
          value={cookies}
          onChange={(e) => setCookies(e.target.value)}
          placeholder="# Netscape HTTP Cookie File..."
          sx={{ mb: 2, fontFamily: "monospace" }}
        />

        <Button
          fullWidth
          variant="contained"
          size="large"
          onClick={handleSaveCookies}
        >
          Save Cookies
        </Button>

        {/* --- MODIFIED: This now reads from the 'cookieStatus' object --- */}
        {cookieStatus.message && (
          <Alert severity={cookieStatus.type} sx={{ mt: 2 }}>
            <AlertTitle>
              {cookieStatus.type === "success" ? "Success" : "Error"}
            </AlertTitle>
            {cookieStatus.message}
          </Alert>
        )}
      </Paper>
    </Container>
  );
}

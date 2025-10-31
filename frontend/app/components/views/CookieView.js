"use client";

import {
  Container,
  Typography,
  Paper,
  Stack,
  TextField,
  Button,
  Alert,
  AlertTitle,
} from "@mui/material";
import { Save as SaveIcon } from "@mui/icons-material";

// This component is based on your renderCookieManager() function
export default function CookieView({
  cookies,
  setCookies,
  saveCookies,
  cookieStatus,
}) {
  return (
    <Container maxWidth="md">
      <Paper elevation={3} sx={{ p: 4, mt: 4 }}>
        <Typography variant="h4" gutterBottom>
          Cookie Manager
        </Typography>
        <Typography variant="body2" color="textSecondary" paragraph>
          To download private or members-only videos, you need to provide your
          YouTube cookies. Use a browser extension like 'Get cookies.txt' to
          export them, then paste the contents here.
        </Typography>
        <Stack spacing={2} sx={{ mt: 2 }}>
          <TextField
            label="YouTube Cookies (Netscape format)"
            variant="outlined"
            fullWidth
            multiline
            rows={10}
            value={cookies}
            onChange={(e) => setCookies(e.target.value)}
          />
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={saveCookies}
            sx={{ height: 56 }}
          >
            Save Cookies
          </Button>
          {cookieStatus.message && (
            <Alert severity={cookieStatus.type}>
              <AlertTitle>
                {cookieStatus.type === "success" ? "Success" : "Error"}
              </AlertTitle>
              {cookieStatus.message}
            </Alert>
          )}
        </Stack>
      </Paper>
    </Container>
  );
}

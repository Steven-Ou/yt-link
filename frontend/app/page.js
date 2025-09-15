"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Box,
  Button,
  Container,
  Divider,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Toolbar,
  Typography,
  CssBaseline,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  createTheme,
  ThemeProvider,
  CircularProgress,
  LinearProgress,
  Paper,
  Stack,
  Alert,
  AlertTitle,
} from "@mui/material";
import {
  Home as HomeIcon,
  Download as DownloadIcon,
  QueueMusic as QueueMusicIcon,
  VideoLibrary as VideoLibraryIcon,
  Coffee as CoffeeIcon,
  Cookie as CookieIcon,
  ExpandMore as ExpandMoreIcon,
  CheckCircleOutline as CheckCircleOutlineIcon,
  ErrorOutline as ErrorOutlineIcon,
  HourglassEmpty as HourglassEmptyIcon,
  Window as WindowsIcon,
  Apple as AppleIcon,
  Folder as FolderIcon,
} from "@mui/icons-material";

const drawerWidth = 240;

// Your customTheme remains unchanged.
const customTheme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#E53935", contrastText: "#FFFFFF" },
    secondary: { main: "#1A1A1A", contrastText: "#FFFFFF" },
    warning: { main: "#FFB300", contrastText: "#1A1A1A" },
    background: { default: "#F5F5F5", paper: "#FFFFFF" },
    text: { primary: "#1A1A1A", secondary: "#616161", disabled: "#BDBDBD" },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: { body: { backgroundColor: "#F5F5F5" } },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: { backgroundColor: "#1A1A1A", color: "#F5F5F5" },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          "&.Mui-selected": {
            backgroundColor: "rgba(229, 57, 53, 0.2)",
            "&:hover": { backgroundColor: "rgba(229, 57, 53, 0.3)" },
          },
          "&:hover": { backgroundColor: "rgba(255, 255, 255, 0.08)" },
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          "& .MuiInputBase-input": { color: "#1A1A1A" },
          "& .MuiInputLabel-root": { color: "#616161" },
          "& .MuiOutlinedInput-notchedOutline": { borderColor: "#BDBDBD" },
          "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: "#E53935",
          },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
            borderColor: "#E53935",
          },
        },
      },
    },
    MuiAccordion: {
      styleOverrides: {
        root: {
          backgroundColor: "#1A1A1A",
          color: "#F5F5F5",
          boxShadow: "none",
          "&:before": { display: "none" },
        },
      },
    },
    MuiAccordionSummary: {
      styleOverrides: {
        root: { "&:hover": { backgroundColor: "rgba(255, 255, 255, 0.08)" } },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: { backgroundColor: "rgba(255, 255, 255, 0.12)" },
      },
    },
  },
});

// Your WelcomePage component remains unchanged.
function WelcomePage({ isElectron }) {
  const downloadUrl = "https://github.com/Steven-Ou/yt-link/releases/latest";
  return (
    <Container maxWidth="md" sx={{ textAlign: "center" }}>
      {!isElectron && (
        <Alert severity="warning" sx={{ mb: 4, textAlign: "left" }}>
          <AlertTitle>Web Version Notice</AlertTitle>
          This web interface is for demonstration only. For full functionality,
          please <strong>download the desktop application.</strong>
        </Alert>
      )}
      <Typography variant="h3" component="h1" gutterBottom fontWeight="bold">
        YT Link Converter
      </Typography>
      <Typography variant="h6" color="text.secondary" sx={{ mb: 2 }}>
        Welcome!
      </Typography>
      <Typography
        variant="body1"
        color="text.secondary"
        sx={{ mt: 2, mb: 4, maxWidth: "600px", mx: "auto" }}
      >
        Please download the app if you're on the Website! The web version does
        not support downloads. Select a download option and the files will be
        saved to your default Downloads folder.
      </Typography>
      <Paper
        elevation={0}
        variant="outlined"
        sx={{
          mt: 4,
          p: { xs: 2, sm: 4 },
          borderRadius: 4,
          backgroundColor: "#fafafa",
        }}
      >
        <Typography
          variant="h5"
          component="h2"
          gutterBottom
          align="center"
          fontWeight="bold"
        >
          Download the Desktop App
        </Typography>
        <Typography
          variant="body1"
          color="text.secondary"
          align="center"
          sx={{ mb: 4, maxWidth: "500px", mx: "auto" }}
        >
          Get the full-featured desktop application for a seamless, local
          experience. (For Windows users, make sure to extract the zip after
          downloading.)
        </Typography>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          justifyContent="center"
        >
          <Button
            variant="contained"
            color="secondary"
            size="large"
            startIcon={<AppleIcon />}
            href={downloadUrl}
            sx={{ textTransform: "none", fontWeight: "bold" }}
          >
            Download for macOS
          </Button>
          <Button
            variant="contained"
            color="primary"
            size="large"
            startIcon={<WindowsIcon />}
            href={downloadUrl}
            sx={{ textTransform: "none", fontWeight: "bold" }}
          >
            Download for Windows
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}

const JobStatusDisplay = ({ jobInfo }) => {
  if (!jobInfo || !jobInfo.status || jobInfo.status === "idle") return null;
  let icon = <HourglassEmptyIcon />;
  let color = "text.secondary";
  let showProgressBar = false;

  switch (jobInfo.status) {
    case "completed":
      icon = <CheckCircleOutlineIcon color="success" />;
      color = "success.main";
      break;
    case "failed":
      icon = <ErrorOutlineIcon color="error" />;
      color = "error.main";
      break;
    case "queued":
    case "downloading":
    case "processing":
      icon = <CircularProgress size={20} sx={{ mr: 1 }} color="inherit" />;
      color = "primary.main";
      showProgressBar = true;
      break;
    default:
      break;
  }

  const handleOpenFolder = () => {
    if (window.electron && jobInfo.savedFilePath) {
      window.electron.openFolder(jobInfo.savedFilePath);
    } else {
      console.error("Could not determine the download folder or file path.");
    }
  };

  return (
    <Box
      sx={{
        mt: 2,
        p: 2,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        backgroundColor: "background.paper",
      }}
    >
      <Typography
        variant="subtitle1"
        sx={{
          display: "flex",
          alignItems: "center",
          color: color,
          fontWeight: "medium",
        }}
      >
        {icon}
        <Box component="span" sx={{ ml: 1 }}>
          {jobInfo.message || `Status: ${jobInfo.status}`}
        </Box>
      </Typography>
      {showProgressBar && (
        <LinearProgress
          variant={jobInfo.progress ? "determinate" : "indeterminate"}
          value={jobInfo.progress ? parseFloat(jobInfo.progress) : 0}
          color="primary"
          sx={{ mt: 1, mb: 1 }}
        />
      )}
      {jobInfo.status === "completed" && jobInfo.savedFilePath && (
        <Button
          variant="contained"
          color="success"
          onClick={handleOpenFolder}
          sx={{ mt: 1, textTransform: "none" }}
          startIcon={<FolderIcon />}
        >
          Show File in Folder
        </Button>
      )}
    </Box>
  );
};

const CookieInputField = ({ value, onChange, disabled }) => (
  <TextField
    label="Paste YouTube Cookies Here (Optional)"
    helperText="Needed for age-restricted or private videos."
    variant="outlined"
    fullWidth
    multiline
    rows={4}
    value={value}
    onChange={onChange}
    style={{ marginBottom: 16 }}
    placeholder="Begins with '# Netscape HTTP Cookie File...'"
    disabled={disabled}
    InputProps={{
      startAdornment: (
        <ListItemIcon sx={{ minWidth: "40px", color: "action.active", mr: 1 }}>
          <CookieIcon />
        </ListItemIcon>
      ),
    }}
  />
);

const cleanUrl = (urlString) => {
  try {
    const url = new URL(urlString);
    if (url.searchParams.has("v")) {
      const videoId = url.searchParams.get("v");
      const cleanedUrl = new URL(url.origin + url.pathname);
      cleanedUrl.searchParams.set("v", videoId);
      return cleanedUrl.toString();
    }
    return urlString;
  } catch (error) {
    console.error("Invalid URL for cleaning:", urlString, error);
    return urlString;
  }
};

/**
 * --- FIX FOR INVALID PLAYLIST URLS ---
 * Validates and corrects a YouTube playlist URL.
 * It can handle full URLs, partial URLs, or just the playlist ID.
 * @param {string} urlString - The user-provided URL or ID.
 * @returns {string} A full, valid YouTube playlist URL, or the original string if it can't be parsed.
 */
const validateAndFixPlaylistUrl = (urlString) => {
  if (!urlString || typeof urlString !== "string") return "";

  // Regex to find a YouTube playlist ID (PL...). It's more reliable than parsing the whole URL string.
  const playlistIdRegex = /(PL[a-zA-Z0-9_-]{16,})/;
  const match = urlString.match(playlistIdRegex);

  if (match && match[1]) {
    // If we found a valid playlist ID, construct the correct, minimal URL.
    return `https://www.youtube.com/playlist?list=${match[1]}`;
  }

  // If no valid playlist ID can be found, return the original string and let the backend handle it.
  // This provides a fallback in case yt-dlp can still parse it.
  return urlString;
};

export default function Home() {
  const [currentView, setCurrentView] = useState("welcome");
  const [url, setUrl] = useState("");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [combineVideoUrl, setCombineVideoUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [cookieData, setCookieData] = useState("");
  const [activeJobs, setActiveJobs] = useState({});
  const pollingIntervals = useRef({});
  const [isElectron, setIsElectron] = useState(false);
  const [expandedDownloads, setExpandedDownloads] = useState(true);

  useEffect(() => {
    setIsElectron(!!(window && window.electron));

    if (window.electron && typeof window.electron.onBackendLog === "function") {
      const removeListener = window.electron.onBackendLog((logMessage) => {
        console.log(logMessage);
      });
      return () => removeListener();
    }
  }, []);

  const isAnyJobLoading = () =>
    Object.values(activeJobs).some((job) =>
      ["queued", "downloading", "processing"].includes(job.status)
    );

  const pollJobStatus = useCallback((jobId, jobType) => {
    if (pollingIntervals.current[jobId]) {
      clearInterval(pollingIntervals.current[jobId]);
    }

    pollingIntervals.current[jobId] = setInterval(async () => {
      try {
        if (!window.electron) {
          clearInterval(pollingIntervals.current[jobId]);
          return;
        }
        const data = await window.electron.getJobStatus(jobId);

        if (data.error) {
          throw new Error(data.error);
        }

        if (data.status === "completed") {
          clearInterval(pollingIntervals.current[jobId]);
          delete pollingIntervals.current[jobId];

          setActiveJobs((prev) => ({
            ...prev,
            [jobType]: {
              ...prev[jobType],
              status: "completed",
              message: "Download successful. Saving file...",
            },
          }));

          const downloadResult = await window.electron.downloadFile(jobId);

          if (downloadResult.error) {
            throw new Error(downloadResult.error);
          }

          setActiveJobs((prev) => ({
            ...prev,
            [jobType]: {
              ...prev[jobType],
              status: "completed",
              message: "File saved successfully!",
              savedFilePath: downloadResult.path,
            },
          }));
        } else if (data.status === "failed" || data.status === "not_found") {
          clearInterval(pollingIntervals.current[jobId]);
          delete pollingIntervals.current[jobId];
          setActiveJobs((prev) => ({
            ...prev,
            [jobType]: {
              ...prev[jobType],
              ...data,
              message: data.error || `Job ${data.status}.`,
            },
          }));
        } else {
          setActiveJobs((prev) => ({
            ...prev,
            [jobType]: { ...prev[jobType], ...data },
          }));
        }
      } catch (error) {
        clearInterval(pollingIntervals.current[jobId]);
        delete pollingIntervals.current[jobId];
        setActiveJobs((prev) => ({
          ...prev,
          [jobType]: {
            ...prev[jobType],
            status: "failed",
            message: `Error: ${error.message}`,
          },
        }));
      }
    }, 2000);
  }, []);

  const startJob = async (jobType, urlValue, operationName) => {
    setActiveJobs((prev) => ({
      ...prev,
      [jobType]: {
        id: null,
        status: "queued",
        message: `Initiating ${operationName}...`,
      },
    }));
    try {
      const payload = { jobType, url: urlValue, cookies: cookieData || null };
      const result = await window.electron.startJob(payload);

      if (result.error) {
        throw new Error(result.error);
      }

      if (result.jobId) {
        setActiveJobs((prev) => ({
          ...prev,
          [jobType]: {
            id: result.jobId,
            status: "queued",
            message: "Job started, waiting for worker...",
          },
        }));
        pollJobStatus(result.jobId, jobType);
      } else {
        throw new Error("Failed to get Job ID from the backend.");
      }
    } catch (error) {
      setActiveJobs((prev) => ({
        ...prev,
        [jobType]: { status: "failed", message: `Error: ${error.message}` },
      }));
    }
  };

  useEffect(() => {
    const intervals = pollingIntervals.current;
    return () => {
      Object.values(intervals).forEach(clearInterval);
    };
  }, []);

  const handleJobRequest = (urlValue, jobType, operationName) => {
    if (!urlValue) {
      alert(`Please enter a YouTube URL for: ${operationName}`);
      return;
    }
    if (!isElectron) {
      alert("This feature is only available in the desktop application.");
      return;
    }

    let finalUrl = urlValue;
    // Apply the correct URL cleaning/validation based on job type
    if (jobType === "playlistZip" || jobType === "combineMp3") {
      finalUrl = validateAndFixPlaylistUrl(urlValue);
    } else if (jobType === "singleMp3") {
      finalUrl = cleanUrl(urlValue);
    }

    startJob(jobType, finalUrl, operationName);
  };

  const downloadMP3 = () =>
    handleJobRequest(url, "singleMp3", "Single MP3 Download");
  const downloadPlaylistZip = () =>
    handleJobRequest(playlistUrl, "playlistZip", "Playlist Zip Download");
  const downloadCombinedPlaylistMp3 = () =>
    handleJobRequest(combineVideoUrl, "combineMp3", "Combine Playlist to MP3");

  const isLoading = (jobType) => {
    const status = activeJobs[jobType]?.status;
    return (
      status === "queued" || status === "downloading" || status === "processing"
    );
  };

  const renderContent = () => {
    const anyJobLoading = isAnyJobLoading();
    switch (currentView) {
      case "welcome":
        return <WelcomePage isElectron={isElectron} />;
      case "single":
        return (
          <Container maxWidth="sm" sx={{ mt: 4 }}>
            <Typography variant="h6" gutterBottom>
              Convert Single Video to MP3
            </Typography>
            <TextField
              label="YouTube Video URL"
              variant="outlined"
              fullWidth
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              style={{ marginBottom: 16 }}
              disabled={anyJobLoading}
            />
            <CookieInputField
              value={cookieData}
              onChange={(e) => setCookieData(e.target.value)}
              disabled={anyJobLoading}
            />
            <Button
              variant="contained"
              color="primary"
              fullWidth
              onClick={downloadMP3}
              disabled={
                isLoading("singleMp3") ||
                (anyJobLoading && !isLoading("singleMp3"))
              }
            >
              {isLoading("singleMp3") && (
                <CircularProgress size={24} sx={{ mr: 1 }} />
              )}
              {isLoading("singleMp3") ? "Processing..." : "Download MP3"}
            </Button>
            <JobStatusDisplay jobInfo={activeJobs["singleMp3"]} />
          </Container>
        );
      case "zip":
        return (
          <Container maxWidth="sm" sx={{ mt: 4 }}>
            <Typography variant="h6" gutterBottom>
              Download Playlist as Zip
            </Typography>
            <TextField
              label="YouTube Playlist URL"
              variant="outlined"
              fullWidth
              value={playlistUrl}
              onChange={(e) => setPlaylistUrl(e.target.value)}
              style={{ marginBottom: 16 }}
              disabled={anyJobLoading}
            />
            <CookieInputField
              value={cookieData}
              onChange={(e) => setCookieData(e.target.value)}
              disabled={anyJobLoading}
            />
            <Button
              variant="contained"
              color="secondary"
              onClick={downloadPlaylistZip}
              fullWidth
              style={{ marginBottom: 16 }}
              disabled={
                isLoading("playlistZip") ||
                (anyJobLoading && !isLoading("playlistZip"))
              }
            >
              {isLoading("playlistZip") && (
                <CircularProgress size={24} sx={{ mr: 1 }} />
              )}
              {isLoading("playlistZip")
                ? "Processing..."
                : "Download Playlist As Zip"}
            </Button>
            <JobStatusDisplay jobInfo={activeJobs["playlistZip"]} />
          </Container>
        );
      case "combine":
        return (
          <Container maxWidth="sm" sx={{ mt: 4 }}>
            <Typography variant="h6" gutterBottom>
              Convert Playlist to Single MP3
            </Typography>
            <TextField
              label="YouTube Playlist URL"
              variant="outlined"
              fullWidth
              value={combineVideoUrl}
              onChange={(e) => setCombineVideoUrl(e.target.value)}
              style={{ marginBottom: 16 }}
              disabled={anyJobLoading}
            />
            <CookieInputField
              value={cookieData}
              onChange={(e) => setCookieData(e.target.value)}
              disabled={anyJobLoading}
            />
            <Button
              variant="contained"
              color="warning"
              onClick={downloadCombinedPlaylistMp3}
              fullWidth
              style={{ marginBottom: 16 }}
              disabled={
                isLoading("combineMp3") ||
                (anyJobLoading && !isLoading("combineMp3"))
              }
            >
              {isLoading("combineMp3") && (
                <CircularProgress size={24} sx={{ mr: 1 }} />
              )}
              {isLoading("combineMp3")
                ? "Processing..."
                : "Download Playlist As Single MP3"}
            </Button>
            <JobStatusDisplay jobInfo={activeJobs["combineMp3"]} />
          </Container>
        );
      default:
        return <Typography>Select an option from the menu.</Typography>;
    }
  };

  return (
    <ThemeProvider theme={customTheme}>
      <Box sx={{ display: "flex" }}>
        <CssBaseline />
        <Drawer
          variant="permanent"
          sx={{
            width: drawerWidth,
            flexShrink: 0,
            [`& .MuiDrawer-paper`]: {
              width: drawerWidth,
              boxSizing: "border-box",
            },
          }}
        >
          <Toolbar />
          <Box sx={{ overflow: "auto" }}>
            <List>
              <ListItem disablePadding>
                <ListItemButton
                  selected={currentView === "welcome"}
                  onClick={() => setCurrentView("welcome")}
                >
                  <ListItemIcon>
                    <HomeIcon />
                  </ListItemIcon>
                  <ListItemText primary="Welcome" />
                </ListItemButton>
              </ListItem>
              <Divider sx={{ my: 1 }} />
              <Accordion
                expanded={expandedDownloads}
                onChange={(e, isExpanded) => setExpandedDownloads(isExpanded)}
              >
                <AccordionSummary
                  expandIcon={<ExpandMoreIcon sx={{ color: "white" }} />}
                  aria-controls="downloads-content"
                  id="downloads-header"
                >
                  <ListItemIcon sx={{ minWidth: "40px", color: "white" }}>
                    <DownloadIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary="Download Options"
                    primaryTypographyProps={{ fontWeight: "medium" }}
                  />
                </AccordionSummary>
                <AccordionDetails sx={{ p: 0 }}>
                  <List component="div" disablePadding>
                    <ListItem disablePadding sx={{ pl: 4 }}>
                      <ListItemButton
                        selected={currentView === "single"}
                        onClick={() => setCurrentView("single")}
                      >
                        <ListItemIcon>
                          <DownloadIcon />
                        </ListItemIcon>
                        <ListItemText primary="Single MP3" />
                      </ListItemButton>
                    </ListItem>
                    <ListItem disablePadding sx={{ pl: 4 }}>
                      <ListItemButton
                        selected={currentView === "zip"}
                        onClick={() => setCurrentView("zip")}
                      >
                        <ListItemIcon>
                          <QueueMusicIcon />
                        </ListItemIcon>
                        <ListItemText primary="Playlist Zip" />
                      </ListItemButton>
                    </ListItem>
                    <ListItem disablePadding sx={{ pl: 4 }}>
                      <ListItemButton
                        selected={currentView === "combine"}
                        onClick={() => setCurrentView("combine")}
                      >
                        <ListItemIcon>
                          <VideoLibraryIcon />
                        </ListItemIcon>
                        <ListItemText primary="Combine Playlist MP3" />
                      </ListItemButton>
                    </ListItem>
                  </List>
                </AccordionDetails>
              </Accordion>
              <Divider sx={{ my: 1 }} />
              <ListItem disablePadding sx={{ mt: 2 }}>
                <ListItemButton
                  component="a"
                  href="https://www.buymeacoffee.com/stevenou"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ListItemIcon>
                    <CoffeeIcon />
                  </ListItemIcon>
                  <ListItemText primary="Buy Me A Coffee" />
                </ListItemButton>
              </ListItem>
            </List>
          </Box>
        </Drawer>
        <Box component="main" sx={{ flexGrow: 1, p: 3 }}>
          <Toolbar />
          {renderContent()}
        </Box>
      </Box>
    </ThemeProvider>
  );
}

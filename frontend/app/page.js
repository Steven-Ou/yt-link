"use client";

import { useState, useEffect } from "react";
import {
  Box,
  Drawer,
  Toolbar,
  CssBaseline, // Restored for background color
  createTheme, // Restored for custom theme
  ThemeProvider, // Restored for custom theme
} from "@mui/material";
import { useApi } from "./hooks/useApi"; // This path is now correct

// --- MODIFIED: Fixed all component import paths ---
import Sidebar from "./components/Sidebar";
import HomeView from "./components/views/HomeView";
import CookieView from "./components/views/CookieView";
import SingleMp3View from "./components/views/SingleMp3View";
import PlaylistZipView from "./components/views/PlaylistZipView";
import CombineMp3View from "./components/views/CombineMp3View";
import SingleVideoView from "./components/views/SingleVideoView";
import JobCard from "./components/JobCard";

const drawerWidth = 240;

// --- Your original custom theme... (Theme object unchanged) ---
const customTheme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#E53935", contrastText: "#FFFFFF" },
    secondary: { main: "#1A1A1A", contrastText: "#FFFFFF" },
    warning: { main: "#FFB300" },
    background: {
      default: "#fafafa", // Light grey background
      paper: "#ffffff",
    },
    text: {
      primary: "rgba(0, 0, 0, 0.87)",
      secondary: "rgba(0, 0, 0, 0.6)",
      disabled: "rgba(0, 0, 0, 0.38)",
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          textTransform: "none",
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            borderRadius: 8,
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 8,
        },
      },
    },
    MuiAccordion: {
      styleOverrides: {
        root: {
          boxShadow: "none",
          "&:before": {
            display: "none",
          },
          "&.Mui-expanded": {
            margin: 0,
          },
        },
      },
    },
    MuiAccordionSummary: {
      styleOverrides: {
        root: {
          "&.Mui-expanded": {
            minHeight: 48,
          },
        },
        content: {
          "&.Mui-expanded": {
            margin: "12px 0",
          },
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: "#ffffff",
        },
      },
    },
  },
});
// --- End Theme ---

export default function Home() {
  const [currentView, setCurrentView] = useState("home");
  const [url, setUrl] = useState("");
  const [error, setError] = useState(null);
  const [formats, setFormats] = useState([]);
  const [selectedQuality, setSelectedQuality] = useState("");
  const [cookies, setCookies] = useState("");
  const [pollingJobId, setPollingJobId] = useState(null);
  const [currentJob,setCurrentJob]= useState(null);
  const [cookieStatus, setCookieStatus] = useState({
    message: null,
    type: null,
  });

  const { post: postGetFormats, isApiLoading: isLoadingFormats } = useApi();
  const { post: postDownload, isApiLoading: isDownloading } = useApi();

  useEffect(() => {
    const savedCookies = localStorage.getItem("youtubeCookies") || "";
    setCookies(savedCookies);
  }, []);

  useEffect(() => {
    if (!pollingJobId) return;

    // Start polling every 2 seconds
    const intervalId = setInterval(async () => {
      try {
        // Get the base URL from the Electron API (same logic as useApi)
        let baseUrl = "";
        // @ts-ignore
        if (window.electronAPI?.getBackendUrl) {
          // @ts-ignore
          baseUrl = window.electronAPI.getBackendUrl(); // e.g., "http://127.0.0.1:5003"
        }

        // We must build the URL manually for fetch
        // In dev: /api/job-status?jobId=...
        // In prod: http://127.0.0.1:5003/job-status?jobId=...
        const statusUrl = baseUrl
          ? `${baseUrl}/job-status?jobId=${pollingJobId}`
          : `/api/job-status?jobId=${pollingJobId}`;

        const response = await fetch(statusUrl);
        if (!response.ok) {
          throw new Error("Failed to fetch job status");
        }

        const job = await response.json();

        setCurrentJob(job);

        // 1. Job is done!
        if (job.status === "completed") {
          console.log("Job completed. Full payload:", job); // Added full logging

          // Stop polling
          clearInterval(intervalId);
          setPollingJobId(null);

          // Sanitize the filename on the frontend as a fallback
          const fileName =
            job.file_name ||
            job.file_path || // Try file_path as a backup
            `${pollingJobId}-download`; // Use Job ID as last resort

          console.log("Triggering download. Filename:", fileName);

          // Trigger the download!
          const downloadUrl = `${baseUrl}/download/${job.job_id}`;

          window.location.href=downloadUrl;
          // Create an invisible link to trigger the browser's download prompt
          const link = document.createElement("a");
          link.href = downloadUrl;
          link.setAttribute("download", fileName);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          // 2. Job failed!
        } else if (job.status === "failed") {
          console.error("Job failed:", job.error);
          setError(job.message || job.error); // Show the error from the backend

          // Stop polling
          clearInterval(intervalId);
          setPollingJobId(null);

          setTimeout(()=>setCurrentJob(null),10000);
        }

        // 3. Job is still processing...
        // (do nothing, the interval will run again)
      } catch (err) {
        console.error("Polling error:", err);
        setError("Lost connection to backend.");
        clearInterval(intervalId);
        setPollingJobId(null);
        setCurrentJob(null);
      }
    }, 2000); // Poll every 2 seconds

    // Cleanup function to stop polling if the component unmounts
    return () => {
      clearInterval(intervalId);
    };
  }, [pollingJobId]); // This effect re-runs ONLY when pollingJobId changes

  const handleSaveCookies = () => {
    try {
      localStorage.setItem("youtubeCookies", cookies);
      setCookieStatus({
        message: "Cookies saved successfully!",
        type: "success",
      });
      setTimeout(() => setCookieStatus({ message: null, type: null }), 3000);
    } catch (e) {
      setCookieStatus({
        message: "Failed to save cookies. Storage might be full.",
        type: "error",
      });
      console.error(e);
    }
  };

  const handleGetFormats = async () => {
    setError(null);
    setFormats([]);
    if (!url) {
      setError("Please enter a YouTube URL.");
      return;
    }
    const cookies = localStorage.getItem("youtubeCookies") || "";

    const { data, error } = await postGetFormats("/api/get-formats", {
      url,
      cookies,
    });
    if (error) {
      setError(error);
    } else {
      console.log("Formats data from backend:", data);
      const videoFormats = data.filter((f) => f.resolution);
      setFormats(videoFormats || []);
      if (videoFormats && videoFormats.length > 0) {
        setSelectedQuality(videoFormats[0].format_id);
      }
    }
  };

  const handleDownload = async (type) => {
    setError(null);
    if (!url) {
      setError("Please enter a YouTube URL.");
      return;
    }

    // The API endpoint is ALWAYS /api/start-job
    const apiEndpoint = "/api/start-job";
    const cookies = localStorage.getItem("youtubeCookies") || "";

    // We build the body dynamically based on the job type
    let body = {
      jobType: type, // Pass the 'type' as 'jobType' in the body
      url: url,
      cookies: cookies,
    };

    // Special case for 'singleVideo', add the quality to the body
    if (type === "singleVideo") {
      if (!selectedQuality) {
        setError("Please fetch and select a video quality first.");
        return;
      }
      body.quality = selectedQuality; // Add 'quality' to the body
    }

    setCurrentJob({
      job_id: "new",
      status: "queued",
      message: "Job is starting...",
      file_name: "Resolving video...", // Placeholder name
      progress: 0,
    });
    
    const { data, error } = await postDownload(apiEndpoint, body);
    if (error) {
      setError(error);
    } else {
      console.log("Job started:", data); // Or whatever you do on success
      setPollingJobId(data.jobId); // <-- ADD THIS LINE
      setUrl(""); // <-- Optional: Clears the URL bar
    }
  };

  const renderContent = () => {
    const baseProps = {
      url,
      setUrl,
      error,
      setError,
      setCurrentView,
    };

    switch (currentView) {
      case "home":
        return <HomeView />;
      case "singleMp3":
        return (
          <SingleMp3View
            {...baseProps}
            isDownloading={isDownloading}
            handleDownload={handleDownload}
          />
        );
      case "playlistZip":
        return (
          <PlaylistZipView
            {...baseProps}
            isDownloading={isDownloading}
            handleDownload={handleDownload}
          />
        );
      case "combine":
        return (
          <CombineMp3View
            {...baseProps}
            isDownloading={isDownloading}
            handleDownload={handleDownload}
          />
        );
      case "singleVideo":
        return (
          <SingleVideoView
            {...baseProps}
            formats={formats}
            selectedFormat={selectedQuality}
            setSelectedFormat={setSelectedQuality}
            isLoadingFormats={isLoadingFormats}
            handleGetFormats={handleGetFormats}
            isDownloading={isDownloading}
            handleDownload={handleDownload}
          />
        );
      case "cookies":
        return (
          <CookieView
            cookies={cookies}
            setCookies={setCookies}
            cookieStatus={cookieStatus}
            handleSaveCookies={handleSaveCookies}
          />
        );
      default:
        return <HomeView />;
    }
  };

  return (
    <ThemeProvider theme={customTheme}>
      <CssBaseline />
      <Box sx={{ display: "flex" }}>
        <Sidebar
          drawerWidth={drawerWidth}
          currentView={currentView}
          setCurrentView={setCurrentView}
        />
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            p: 3,
            width: { sm: `calc(100% - ${drawerWidth}px)` },
            backgroundColor: "background.default",
            minHeight: "100vh",
          }}
        >
          <Toolbar />
          {renderContent()}
        </Box>
      </Box>
    </ThemeProvider>
  );
}

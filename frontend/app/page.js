"use client";

import { useState, useEffect } from "react";
import {
  Box,
  Drawer,
  Toolbar,
  CssBaseline,
  createTheme,
  ThemeProvider,
} from "@mui/material";
import { useApi } from "./hooks/useApi";

import Sidebar from "./components/Sidebar";
import HomeView from "./components/views/HomeView";
import CookieView from "./components/views/CookieView";
import SingleMp3View from "./components/views/SingleMp3View";
import PlaylistZipView from "./components/views/PlaylistZipView";
import CombineMp3View from "./components/views/CombineMp3View";
import SingleVideoView from "./components/views/SingleVideoView";

const drawerWidth = 240;

const customTheme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#E53935", contrastText: "#FFFFFF" },
    secondary: { main: "#1A1A1A", contrastText: "#FFFFFF" },
    warning: { main: "#FFB300" },
    background: {
      default: "#fafafa",
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

export default function Home() {
  const [currentView, setCurrentView] = useState("home");
  const [url, setUrl] = useState("");
  const [error, setError] = useState(null);
  const [formats, setFormats] = useState([]);
  const [selectedQuality, setSelectedQuality] = useState("");
  const [cookies, setCookies] = useState("");

  // --- UPGRADE 1: Initialize states to handle collections ---
  const [pollingJobId, setPollingJobId] = useState([]); // Array of IDs
  const [currentJob, setCurrentJob] = useState({}); // Object of job data

  const [cookieStatus, setCookieStatus] = useState({
    message: null,
    type: null,
  });
  const [activeJobs, setActiveJobs] = useState({});
  const { post: postGetFormats, isApiLoading: isLoadingFormats } = useApi();
  const { post: postDownload, isApiLoading: isDownloading } = useApi();

  useEffect(() => {
    const savedCookies = localStorage.getItem("youtubeCookies") || "";
    setCookies(savedCookies);
  }, []);

  // --- UPGRADE 2: Multi-job Polling Logic (Preserving your Electron logic) ---
  useEffect(() => {
    if (pollingJobId.length === 0) return;

    const intervalId = setInterval(async () => {
      // Loop through every job ID in your array
      for (const jobId of pollingJobId) {
        try {
          let baseUrl = "";
          // @ts-ignore
          if (window.electronAPI?.getBackendUrl) {
            // @ts-ignore
            baseUrl = window.electronAPI.getBackendUrl();
          }

          const statusUrl = baseUrl
            ? `${baseUrl}/job-status?jobId=${jobId}`
            : `/api/job-status?jobId=${jobId}`;

          const response = await fetch(statusUrl);
          if (!response.ok) {
            throw new Error("Failed to fetch job status");
          }

          const job = await response.json();

          // Update specifically that job in your collection
          setCurrentJob((prev) => ({ ...prev, [jobId]: job }));

          if (job.status === "completed") {
            console.log("Job completed. Full payload:", job);

            // Remove from polling list
            setPollingJobId((prev) => prev.filter((id) => id !== jobId));

            const fileName =
              job.file_name || job.file_path || `${jobId}-download`;
            console.log("Triggering download. Filename:", fileName);

            const downloadUrl = `${baseUrl}/download/${job.job_id}`;
            window.location.href = downloadUrl;

            const link = document.createElement("a");
            link.href = downloadUrl;
            link.setAttribute("download", fileName);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          } else if (job.status === "failed") {
            console.error("Job failed:", job.error);
            setError(job.message || job.error);
            setPollingJobId((prev) => prev.filter((id) => id !== jobId));

            // Auto-clear failed job after 10s
            setTimeout(() => handleClearJob(jobId), 10000);
          }
        } catch (err) {
          console.error("Polling error:", err);
          setError("Lost connection to backend.");
          setPollingJobId((prev) => prev.filter((id) => id !== jobId));
        }
      }
    }, 2000);

    return () => clearInterval(intervalId);
  }, [pollingJobId]);

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

    const apiEndpoint = "/api/start-job";
    const cookies = localStorage.getItem("youtubeCookies") || "";

    let body = {
      jobType: type,
      url: url,
      cookies: cookies,
    };

    if (type === "singleVideo") {
      if (!selectedQuality) {
        setError("Please fetch and select a video quality first.");
        return;
      }
      body.quality = selectedQuality;
    }

    // --- UPGRADE 3: Set placeholder for specific job ---
    const placeholderId = `pending-${Date.now()}`;
    setCurrentJob((prev) => ({
      ...prev,
      [placeholderId]: {
        job_id: placeholderId,
        status: "queued",
        message: "Job is starting...",
        file_name: "Resolving video...",
        progress: 0,
        url: url,
      },
    }));

    const { data, error } = await postDownload(apiEndpoint, body);
    if (error) {
      setError(error);
      handleClearJob(placeholderId);
    } else {
      console.log("Job started:", data);
      // Remove placeholder, add real Job ID to polling and collection
      handleClearJob(placeholderId);
      setPollingJobId((prev) => [...prev, data.jobId]);
      setCurrentJob((prev) => ({
        ...prev,
        [data.jobId]: {
          job_id: data.jobId,
          status: "queued",
          progress: 0,
          url: url,
        },
      }));
      setUrl("");
    }
  };

  // MODIFIED: Accepts jobId to clear specific box
  const handleClearJob = (jobId) => {
    setCurrentJob((prev) => {
      const newState = { ...prev };
      delete newState[jobId];
      return newState;
    });
  };

  const renderContent = () => {
    const baseProps = {
      url,
      setUrl,
      error,
      setError,
      setCurrentView,
      currentJob, // Passing the full collection object
      handleClearJob,
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

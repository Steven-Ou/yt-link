"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Toolbar,
  CssBaseline,
  createTheme,
  ThemeProvider,
  Container,
} from "@mui/material";
import { useRouter } from "next/navigation";

// --- NEW: Import all the components ---
import Sidebar from "./components/Sidebar";
import HomeView from "./components/views/HomeView";
import SingleMp3View from "./components/views/SingleMp3View";
import PlaylistZipView from "./components/views/PlaylistZipView";
import CombineMp3View from "./components/views/CombineMp3View";
import SingleVideoView from "./components/views/SingleVideoView";
import CookieView from "./components/views/CookieView";

// Your customTheme remains unchanged.
const customTheme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#E53935", contrastText: "#FFFFFF" },
    secondary: { main: "#1A1A1A", contrastText: "#FFFFFF" },
    warning: { main: "#FFB300" },
    background: { default: "#FAFAFA", paper: "#FFFFFF" },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h4: { fontWeight: 700 },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          textTransform: "none",
          fontWeight: 600,
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
          borderRadius: 12,
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: "#FFFFFF",
          borderRight: "1px solid #E0E0E0",
        },
      },
    },
  },
});

export default function MainPage() {
  const [currentView, setCurrentView] = useState("home");
  const [url, setUrl] = useState("");
  const [formats, setFormats] = useState([]);
  const [selectedFormat, setSelectedFormat] = useState("");
  const [isLoadingFormats, setIsLoadingFormats] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState("");
  const [cookies, setCookies] = useState("");
  const [cookieStatus, setCookieStatus] = useState({ type: "", message: "" });
  const router = useRouter();

  // Load cookies from localStorage on mount
  useEffect(() => {
    const savedCookies = localStorage.getItem("youtubeCookies") || "";
    setCookies(savedCookies);
  }, []);

  const saveCookies = () => {
    localStorage.setItem("youtubeCookies", cookies);
    setCookieStatus({ type: "success", message: "Cookies saved successfully!" });
    setTimeout(() => setCookieStatus({ type: "", message: "" }), 3000);
  };

  // Clear state when view changes
  const handleSetCurrentView = (view) => {
    setUrl("");
    setError("");
    setFormats([]);
    setSelectedFormat("");
    setIsLoadingFormats(false);
    setCurrentView(view);
  };

  const handleGetFormats = useCallback(async () => {
    if (!url) return;
    setIsLoadingFormats(true);
    setError("");
    setFormats([]);
    setSelectedFormat("");
    try {
      const response = await fetch("/api/get-formats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to get formats");
      }
      const data = await response.json();
      setFormats(data);
      if (data.length > 0) {
        setSelectedFormat(data[0].resolution); // Default to best
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoadingFormats(false);
    }
  }, [url]);

  const handleDownload = useCallback(
    (jobType) => {
      if (!url) {
        setError("URL is required.");
        return;
      }
      // Check for cookies before any download
      const savedCookies = localStorage.getItem("youtubeCookies");
      if (!savedCookies) {
        setError(
          "Cookies are not set. Please add them in the Cookie Manager first."
        );
        handleSetCurrentView("cookies"); // Redirect to cookie page
        return;
      }

      setIsDownloading(true);
      setError("");

      const params = new URLSearchParams();
      params.set("url", url);
      params.set("jobType", jobType);

      if (jobType === "singleVideo") {
        if (!selectedFormat) {
          setError("Please select a video quality first.");
          setIsDownloading(false);
          return;
        }
        params.set("quality", selectedFormat);
      }

      router.push(`/download?${params.toString()}`);

      // Reset state *after* navigation has been initiated
      setTimeout(() => {
        setUrl("");
        setFormats([]);
        setSelectedFormat("");
        setIsDownloading(false);
      }, 500);
    },
    [url, router, selectedFormat]
  );

  // This function now just selects which component to render
  const renderContent = () => {
    switch (currentView) {
      case "home":
        return <HomeView />;
      case "singleVideo":
        return (
          <SingleVideoView
            url={url}
            setUrl={setUrl}
            formats={formats}
            selectedFormat={selectedFormat}
            setSelectedFormat={setSelectedFormat}
            isLoadingFormats={isLoadingFormats}
            handleGetFormats={handleGetFormats}
            isDownloading={isDownloading}
            handleDownload={() => handleDownload("singleVideo")}
            error={error}
          />
        );
      case "singleMp3":
        return (
          <SingleMp3View
            url={url}
            setUrl={setUrl}
            isDownloading={isDownloading}
            handleDownload={() => handleDownload("singleMp3")}
            error={error}
          />
        );
      case "playlistZip":
        return (
          <PlaylistZipView
            url={url}
            setUrl={setUrl}
            isDownloading={isDownloading}
            handleDownload={() => handleDownload("playlistZip")}
            error={error}
          />
        );
      case "combine":
        return (
          <CombineMp3View
            url={url}
            setUrl={setUrl}
            isDownloading={isDownloading}
            handleDownload={() => handleDownload("combineMp3")}
            error={error}
          />
        );
      case "cookies":
        return (
          <CookieView
            cookies={cookies}
            setCookies={setCookies}
            saveCookies={saveCookies}
            cookieStatus={cookieStatus}
          />
        );
      default:
        return <HomeView />;
    }
  };

  return (
    <ThemeProvider theme={customTheme}>
      <Box sx={{ display: "flex" }}>
        <CssBaseline />
        <Sidebar
          currentView={currentView}
          setCurrentView={handleSetCurrentView}
        />
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            p: 3,
            bgcolor: "background.default",
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


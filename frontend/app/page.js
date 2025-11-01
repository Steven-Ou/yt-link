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
// --- MODIFIED: Fixed the import path ---
import { useApi } from "./hooks/useApi"; // Was "../hooks/useApi"

// --- Import all the view components ---
import Sidebar from "../components/Sidebar";
import HomeView from "../components/views/HomeView";
import CookieView from "../components/views/CookieView";
import SingleMp3View from "../components/views/SingleMp3View";
import PlaylistZipView from "../components/views/PlaylistZipView";
import CombineMp3View from "../components/views/CombineMp3View";
import SingleVideoView from "../components/views/SingleVideoView";

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
  // --- MODIFIED: Changed default to empty string for the Select component ---
  const [selectedQuality, setSelectedQuality] = useState("");
  const [cookies, setCookies] = useState("");

  const [cookieStatus, setCookieStatus] = useState({
    message: null,
    type: null,
  });

  // --- NEW: Create two separate useApi instances ---
  // One for fetching formats (for SingleVideoView)
  const { post: postGetFormats, isApiLoading: isLoadingFormats } = useApi();
  // One for handling all downloads
  const { post: postDownload, isApiLoading: isDownloading } = useApi();

  // Load cookies from localStorage on mount
  useEffect(() => {
    const savedCookies = localStorage.getItem("youtubeCookies") || "";
    setCookies(savedCookies);
  }, []);

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

    // --- MODIFIED: Use the correct 'post' function ---
    const { data, error } = await postGetFormats("/api/get-formats", { url });
    if (error) {
      setError(error);
    } else {
      // --- MODIFIED: Filter for actual video formats and set default quality ---
      const videoFormats = data.filter((f) => f.resolution);
      setFormats(videoFormats || []);
      if (videoFormats && videoFormats.length > 0) {
        setSelectedQuality(videoFormats[0].resolution); // Set default to best
      }
    }
  };

  // --- NEW: Add the missing handleDownload function ---
  const handleDownload = async (type) => {
    setError(null);
    if (!url) {
      setError("Please enter a YouTube URL.");
      return;
    }

    let apiEndpoint = "";
    // Get cookies from localStorage, as the backend APIs need them
    const cookies = localStorage.getItem("youtubeCookies") || "";
    let body = { url, cookies };

    switch (type) {
      case "singleMp3":
        apiEndpoint = "/api/start-single-mp3-job";
        break;
      case "playlistZip":
        apiEndpoint = "/api/start-playlist-zip-job";
        break;
      case "combineMp3":
        apiEndpoint = "/api/start-combine-playlist-mp3-job";
        break;
      case "singleVideo":
        if (!selectedQuality) {
          setError("Please fetch and select a video quality first.");
          return;
        }
        // NOTE: This API route doesn't seem to exist in your file list.
        // You will need to create 'frontend/app/api/start-single-video-job/route.js'
        // for this download to work.
        apiEndpoint = "/api/start-single-video-job";
        body = { ...body, format: selectedQuality };
        break;
      default:
        setError(`Invalid download type: ${type}`);
        return;
    }

    // --- NEW: Call the download post function ---
    const { data, error } = await postDownload(apiEndpoint, body);
    if (error) {
      setError(error);
    } else {
      // Job started successfully, UpdateStatus component will take over
      // You could clear the URL here if you want:
      // setUrl("");
    }
  };

  // --- MODIFIED: This function is completely rewritten to pass the correct props ---
  const renderContent = () => {
    const baseProps = {
      url,
      setUrl,
      error,
      setError,
      setCurrentView, // Pass this for navigation
    };

    switch (currentView) {
      case "home":
        // HomeView was changed last time to take no props
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
            selectedFormat={selectedQuality} // Pass state as prop
            setSelectedFormat={setSelectedQuality} // Pass setter as prop
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
    // --- Wrapped in ThemeProvider to restore your colors ---
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
            backgroundColor: "background.default", // This will apply the light grey
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

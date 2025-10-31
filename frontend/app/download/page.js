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
import { useApi } from "../hooks/useApi"; // Corrected path

// --- Import all the view components ---
import Sidebar from "../components/Sidebar";
import HomeView from "../components/views/HomeView";
import CookieView from "../components/views/CookieView";
import SingleMp3View from "../components/views/SingleMp3View";
import PlaylistZipView from "../components/views/PlaylistZipView";
import CombineMp3View from "../components/views/CombineMp3View";
import SingleVideoView from "../components/views/SingleVideoView";

const drawerWidth = 240;

// --- Your original custom theme to fix the colors ---
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
  const [selectedQuality, setSelectedQuality] = useState("best");
  const [cookies, setCookies] = useState("");

  // --- MODIFIED: Changed to a single state object to fix the bug ---
  const [cookieStatus, setCookieStatus] = useState({
    message: null,
    type: null,
  });

  const { post, isApiLoading } = useApi();

  // Load cookies from localStorage on mount
  useEffect(() => {
    const savedCookies = localStorage.getItem("youtubeCookies") || "";
    setCookies(savedCookies);
  }, []);

  const handleSaveCookies = () => {
    try {
      localStorage.setItem("youtubeCookies", cookies);
      // --- MODIFIED: Set the new state object ---
      setCookieStatus({
        message: "Cookies saved successfully!",
        type: "success",
      });
      setTimeout(() => setCookieStatus({ message: null, type: null }), 3000);
    } catch (e) {
      // --- MODIFIED: Set the new state object ---
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

    const { data, error } = await post("/api/get-formats", { url });
    if (error) {
      setError(error);
    } else {
      setFormats(data || []);
      if (data && data.length > 0) {
        setSelectedQuality(data[0].height.toString()); // Set default to best
      }
    }
  };

  const renderContent = () => {
    const props = {
      url,
      setUrl,
      error,
      setError,
      isApiLoading,
      handleGetFormats,
      formats,
      selectedQuality,
      setSelectedQuality,
      setCurrentView, // Pass this for navigation
    };

    switch (currentView) {
      case "home":
        return <HomeView {...props} />;
      case "singleMp3":
        return <SingleMp3View {...props} />;
      case "playlistZip":
        return <PlaylistZipView {...props} />;
      case "combine":
        return <CombineMp3View {...props} />;
      case "singleVideo":
        return <SingleVideoView {...props} />;
      case "cookies":
        return (
          <CookieView
            cookies={cookies}
            setCookies={setCookies}
            // --- MODIFIED: Pass the new state object ---
            cookieStatus={cookieStatus}
            handleSaveCookies={handleSaveCookies}
          />
        );
      default:
        return <HomeView {...props} />;
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

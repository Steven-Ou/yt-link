"use client";

import { useState, useEffect, useRef } from "react";
import {
  Box,
  Drawer,
  Toolbar,
  CssBaseline, // --- NEW: Added back ---
  createTheme, // --- NEW: Added back ---
  ThemeProvider, // --- NEW: Added back ---
} from "@mui/material";
import {
  Home as HomeIcon,
  Download as DownloadIcon,
  QueueMusic as QueueMusicIcon,
  VideoLibrary as VideoLibraryIcon,
  Coffee as CoffeeIcon,
  Cookie as CookieIcon,
  ExpandMore as ExpandMoreIcon,
  OndemandVideo as OndemandVideoIcon,
} from "@mui/icons-material";

// --- NEW: Importing all the new components ---
import Sidebar from "./components/Sidebar";
import HomeView from "./components/views/HomeView";
import CookieView from "./components/views/CookieView";
import SingleMp3View from "./components/views/SingleMp3View";
import PlaylistZipView from "./components/views/PlaylistZipView";
import CombineMp3View from "./components/views/CombineMp3View";
import SingleVideoView from "./components/views/SingleVideoView";
import { useApi } from "./hooks/useApi"; // Assuming you'll create this hook

const drawerWidth = 240;

// --- NEW: Added your original theme back ---
const customTheme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#E53935", contrastText: "#FFFFFF" },
    secondary: { main: "#1A1A1A", contrastText: "#FFFFFF" },
    warning: { main: "#FFB300" },
    background: {
      default: "#fafafa", // This is the light grey background
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
// --- END THEME ---

export default function Home() {
  const [currentView, setCurrentView] = useState("home");
  const [url, setUrl] = useState("");
  const [error, setError] = useState(null);
  const [formats, setFormats] = useState([]);
  const [selectedQuality, setSelectedQuality] = useState("best");
  const [cookies, setCookies] = useState("");
  const [cookieError, setCookieError] = useState(null);
  const [cookieSuccess, setCookieSuccess] = useState(false);
  const { post, isApiLoading } = useApi();

  // Load cookies from localStorage on mount
  useEffect(() => {
    const savedCookies = localStorage.getItem("youtubeCookies") || "";
    setCookies(savedCookies);
  }, []);

  const handleSaveCookies = () => {
    try {
      localStorage.setItem("youtubeCookies", cookies);
      setCookieSuccess(true);
      setCookieError(null);
      setTimeout(() => setCookieSuccess(false), 3000);
    } catch (e) {
      setCookieError("Failed to save cookies. Storage might be full.");
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
            cookieError={cookieError}
            cookieSuccess={cookieSuccess}
            handleSaveCookies={handleSaveCookies}
          />
        );
      default:
        return <HomeView {...props} />;
    }
  };

  return (
    // --- WRAPPED IN THEME PROVIDER ---
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

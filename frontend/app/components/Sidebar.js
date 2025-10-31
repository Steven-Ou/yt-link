"use client";

import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
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
  Folder as FolderIcon,
} from "@mui/icons-material";

const drawerWidth = 240;

export default function Sidebar({ currentView, setCurrentView }) {
  return (
    <Drawer
      variant="permanent"
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        [`& .MuiDrawer-paper`]: {
          width: drawerWidth,
          boxSizing: "border-box",
          backgroundColor: "#FFFFFF",
          borderRight: "1px solid #E0E0E0",
        },
      }}
    >
      <Toolbar />
      <Box sx={{ overflow: "auto" }}>
        <List>
          <ListItem disablePadding>
            <ListItemButton
              selected={currentView === "home"}
              onClick={() => setCurrentView("home")}
            >
              <ListItemIcon>
                <HomeIcon />
              </ListItemIcon>
              <ListItemText primary="Home" />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton
              selected={currentView === "cookies"}
              onClick={() => setCurrentView("cookies")}
            >
              <ListItemIcon>
                <CookieIcon />
              </ListItemIcon>
              <ListItemText primary="Cookie Manager" />
            </ListItemButton>
          </ListItem>

          <Accordion
            defaultExpanded
            sx={{
              boxShadow: "none",
              "&:before": { display: "none" },
              "&.Mui-expanded": { margin: 0 },
            }}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon />}
              sx={{ paddingLeft: "16px" }}
            >
              <ListItemIcon sx={{ minWidth: "56px" }}>
                <DownloadIcon />
              </ListItemIcon>
              <Typography>Download Tools</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ padding: 0 }}>
              <List component="div" disablePadding>
                <ListItem disablePadding sx={{ pl: 4 }}>
                  <ListItemButton
                    selected={currentView === "singleVideo"}
                    onClick={() => setCurrentView("singleVideo")}
                  >
                    <ListItemIcon>
                      <OndemandVideoIcon />
                    </ListItemIcon>
                    <ListItemText primary="Single Video" />
                  </ListItemButton>
                </ListItem>
                <ListItem disablePadding sx={{ pl: 4 }}>
                  <ListItemButton
                    selected={currentView === "singleMp3"}
                    onClick={() => setCurrentView("singleMp3")}
                  >
                    <ListItemIcon>
                      <QueueMusicIcon />
                    </ListItemIcon>
                    <ListItemText primary="Single MP3" />
                  </ListItemButton>
                </ListItem>
                <ListItem disablePadding sx={{ pl: 4 }}>
                  <ListItemButton
                    selected={currentView === "playlistZip"}
                    onClick={() => setCurrentView("playlistZip")}
                  >
                    <ListItemIcon>
                      <FolderIcon />
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
  );
}

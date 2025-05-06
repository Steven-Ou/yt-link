'use client';
import { useState } from 'react';
import {Box, Button, Container, Divider, Drawer, List, ListItem,
ListItemButton, ListItemIcon, ListItemText, TextField, Toolbar,
Typography, CssBaseline}from '@mui/material';
import {
    Home as HomeIcon, Download as DownloadIcon, QueueMusic as QueueMusicIcon,
    VideoLibrary as VideoLibraryIcon, Coffee as CoffeeIcon
 } from '@mui/icons-material';

// Helper function to parse Content-Disposition header (keep this)
function getFilenameFromHeaders(headers) {
    const disposition = headers.get('Content-Disposition');
    let filename = 'downloaded_file';
    if (disposition) {
        const utf8FilenameRegex = /filename\*=UTF-8''([\w%.-]+)(?:; ?|$)/i;
        const utf8Match = disposition.match(utf8FilenameRegex);
        if (utf8Match && utf8Match[1]) {
            try { filename = decodeURIComponent(utf8Match[1]); return filename; }
            catch (e) { console.error("Error decoding filename*:", e); }
        }
        const asciiFilenameRegex = /filename=(?:(")([^"]*)\1|([^;\n]*))/i;
        const asciiMatch = disposition.match(asciiFilenameRegex);
        if (asciiMatch && (asciiMatch[2] || asciiMatch[3])) {
            filename = asciiMatch[2] || asciiMatch[3];
            filename = filename.replace(/[\\/]/g, '_');
            return filename;
        }
    }
    return filename;
}

const drawerWidth = 240;

export default function Home() {
    const [currentView, setCurrentView] = useState('welcome');
    const [url, setUrl] = useState('');
    const [playlistUrl, setPlaylistUrl] = useState('');
    const [combineVideoUrl, setCombineVideoUrl] = useState('');
    // *** NEW STATE for cookie data ***
    const [cookieData, setCookieData] = useState('');

    const [isLoadingMp3, setIsLoadingMp3] = useState(false);
    const [isLoadingZip, setIsLoadingZip] = useState(false);
    const [isLoadingVideo, setIsLoadingVideo] = useState(false);

    // Single video download
    const downloadMP3 = async () => {
        if (!url) return alert('Enter video URL');
        setIsLoadingMp3(true);
        try {
            console.log("Sending URL:", url);
            console.log("Sending Cookie Data Length:", cookieData?.length || 0); // Log length, not content

            const res = await fetch('/api/download', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              // *** Include cookieData in the body ***
              body: JSON.stringify({
                  url: url,
                  cookieData: cookieData.trim() || null // Send trimmed data or null if empty/whitespace
                }),
            });

             if (!res.ok) {
                const errorBody = await res.json().catch(() => ({ error: 'Unknown server error' }));
                throw new Error(errorBody.error || res.statusText);
            }
            const filename = getFilenameFromHeaders(res.headers);
            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
            // Optionally clear cookie field after successful download
            // setCookieData('');
        } catch (error) {
            console.error("Client-side download error:", error);
            alert(`Error downloading MP3: ${error.message}`);
        } finally {
             setIsLoadingMp3(false); 
        }
      };

      // --- Playlist download as ZIP (Does NOT include cookie handling yet) ---
      const downloadPlaylistZip = async () => {
        // ... (Keep existing code - add cookie handling here if needed later) ...
        if (!playlistUrl) return alert('Enter playlist URL for Zip download');
        setIsLoadingZip(true);
        try {
            const res = await fetch('/api/download-playlist', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ playlistUrl }), // Only sends URL for now
            });
             if (!res.ok) {
                 const errorBody = await res.json().catch(() => ({ error: 'Unknown server error' }));
                 throw new Error(errorBody.error || res.statusText);
            }
            const filename = getFilenameFromHeaders(res.headers) || 'playlist.zip';
            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        } catch (error) {
             console.error("Client-side playlist zip download error:", error);
             alert(`Error downloading playlist zip: ${error.message}`);
        } finally {
            setIsLoadingZip(false);
        }
      };

      // --- Playlist download as single combined VIDEO (Does NOT include cookie handling yet) ---
      const downloadCombinedVideo = async () => {
        // ... (Keep existing code - add cookie handling here if needed later) ...
         if (!combineVideoUrl) return alert('Enter playlist URL for Single Video download');
        alert('Combining videos can take a long time, especially for long playlists. Please be patient.');
        setIsLoadingVideo(true);
        try {
            const res = await fetch('/api/convert', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ playlistUrl: combineVideoUrl }), // Only sends URL for now
            });
             if (!res.ok) {
                 const errorBody = await res.json().catch(() => ({ error: 'Unknown server error' }));
                 throw new Error(errorBody.error || res.statusText);
            }
            const filename = getFilenameFromHeaders(res.headers) || 'combined_video.mp4';
            const blob = await res.blob();
            console.log("Received blob type:", blob.type);
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        } catch (error) {
             console.error("Client-side combined video download error:", error);
             alert(`Error downloading combined video: ${error.message}`);
        } finally {
            setIsLoadingVideo(false);
        }
      };

    // Function to render the main content based on currentView
    const renderContent = () => {
        switch (currentView) {
            case 'welcome':
                // ... (welcome message remains the same) ...
                 return (
                    <Box sx={{ textAlign: 'center', mt: 8 }}>
                        <Typography variant="h2" component="h1" gutterBottom>
                            YT Link V2 {/* Your Project Title */}
                        </Typography>
                        <Typography variant="h5" color="text.secondary">
                            Welcome! Select an option from the menu to get started.
                        </Typography>
                         <Typography variant="body1" color="text.secondary" sx={{mt: 2, maxWidth: '600px', mx: 'auto'}}>
                            Note: Some videos (age-restricted, private, etc.) may require you to paste your YouTube cookies (exported via a browser extension) into the designated field in the 'Single MP3' section for the download to work. This is optional and advanced.
                        </Typography>
                    </Box>
                );
            case 'single':
                return (
                    <Container maxWidth="sm" sx={{ mt: 4 }}>
                        <Typography variant='h6' gutterBottom>
                            Convert a Single Video to MP3
                        </Typography>
                        <TextField
                            label="YouTube Video URL"
                            variant='outlined' fullWidth value={url}
                            onChange={(e)=> setUrl(e.target.value)}
                            style={{marginBottom: 16}}
                            disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo}
                        />
                        {/* *** NEW Cookie Text Area *** */}
                        <TextField
                            label="Paste YouTube Cookies Here (Optional)"
                            helperText="Export cookies using a browser extension (e.g., 'Get cookies.txt') and paste the content here if needed for restricted videos."
                            variant='outlined' fullWidth multiline rows={4}
                            value={cookieData}
                            onChange={(e) => setCookieData(e.target.value)}
                            style={{marginBottom: 16}}
                            placeholder="Starts with # Netscape HTTP Cookie File..."
                            disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo}
                        />
                        <Button
                            variant='contained' color='primary' fullWidth
                            onClick={downloadMP3}
                            disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo}
                        >
                            {isLoadingMp3 ? 'Downloading MP3...' : 'Download MP3'}
                        </Button>
                    </Container>
                );
            case 'zip':
                 // ... (zip download form remains the same) ...
                 return (
                    <Container maxWidth="sm" sx={{ mt: 4 }}>
                        <Typography variant='h6' gutterBottom>
                            Download Playlist as Zip
                        </Typography>
                        <TextField
                            label="YouTube Playlist URL (for Zip)"
                            variant='outlined' fullWidth value={playlistUrl}
                            onChange={(e)=> setPlaylistUrl(e.target.value)}
                            style={{marginBottom: 16}}
                            disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo}
                        />
                        <Button
                            variant='contained' color='secondary' onClick={downloadPlaylistZip}
                            fullWidth style={{marginBottom: 16}}
                            disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo}
                        >
                             {isLoadingZip ? 'Downloading Zip...' : 'Download Playlist As Zip'}
                        </Button>
                    </Container>
                );
            case 'combine':
                 // ... (combine video form remains the same) ...
                 return (
                     <Container maxWidth="sm" sx={{ mt: 4 }}>
                        <Typography variant='h6' gutterBottom>
                            Convert Playlist to Single Video
                        </Typography>
                        <TextField
                            label="YouTube Playlist URL (for Single Video)"
                            variant='outlined' fullWidth value={combineVideoUrl}
                            onChange={(e)=> setCombineVideoUrl(e.target.value)}
                            style={{marginBottom: 16}}
                            disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo}
                        />
                        <Button
                            variant='contained' color='warning' onClick={downloadCombinedVideo}
                            fullWidth style={{marginBottom: 16}}
                            disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo}
                        >
                             {isLoadingVideo ? 'Combining Video...' : 'Download Playlist As Single Video'}
                        </Button>
                    </Container>
                );
            default:
                return <Typography>Select an option</Typography>;
        }
    };

    // Main component structure
    return (
        <Box sx={{ display: 'flex' }}>
            <CssBaseline />
            {/* Sidebar Drawer */}
            <Drawer variant="permanent" sx={{ /* ... drawer styles ... */
                 width: drawerWidth, flexShrink: 0,
                 [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: 'border-box' },
             }}>
                <Toolbar />
                <Box sx={{ overflow: 'auto' }}>
                    <List>
                        {/* Menu Items */}
                        <ListItem disablePadding>
                            <ListItemButton selected={currentView === 'welcome'} onClick={() => setCurrentView('welcome')}>
                                <ListItemIcon><HomeIcon /></ListItemIcon><ListItemText primary="Welcome" />
                            </ListItemButton>
                        </ListItem>
                        <Divider />
                         <ListItem disablePadding>
                            <ListItemButton selected={currentView === 'single'} onClick={() => setCurrentView('single')}>
                                <ListItemIcon><DownloadIcon /></ListItemIcon><ListItemText primary="Single MP3" />
                            </ListItemButton>
                        </ListItem>
                        <ListItem disablePadding>
                            <ListItemButton selected={currentView === 'zip'} onClick={() => setCurrentView('zip')}>
                                <ListItemIcon><QueueMusicIcon /></ListItemIcon><ListItemText primary="Playlist Zip" />
                            </ListItemButton>
                        </ListItem>
                        <ListItem disablePadding>
                            <ListItemButton selected={currentView === 'combine'} onClick={() => setCurrentView('combine')}>
                                <ListItemIcon><VideoLibraryIcon /></ListItemIcon><ListItemText primary="Combine Video" />
                            </ListItemButton>
                        </ListItem>
                        <Divider />
                        {/* Donation Link */}
                        <ListItem disablePadding sx={{ mt: 2 }}>
                            <ListItemButton component="a" href="https://www.buymeacoffee.com/yourlink" target="_blank" rel="noopener noreferrer">
                                <ListItemIcon><CoffeeIcon /></ListItemIcon><ListItemText primary="Buy Me A Coffee" />
                            </ListItemButton>
                        </ListItem>
                    </List>
                </Box>
            </Drawer>

            {/* Main Content Area */}
            <Box component="main" sx={{ flexGrow: 1, bgcolor: 'background.default', p: 3 }}>
                <Toolbar />
                {renderContent()}
            </Box>
        </Box>
    );
};

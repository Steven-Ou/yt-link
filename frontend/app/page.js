'use client';
import { useState } from 'react';
import {
    Box, Button, Container, Divider, Drawer, List, ListItem,
    ListItemButton, ListItemIcon, ListItemText, TextField, Toolbar,
    Typography, CssBaseline
} from '@mui/material';
import {
    Home as HomeIcon, Download as DownloadIcon, QueueMusic as QueueMusicIcon,
    VideoLibrary as VideoLibraryIcon, Coffee as CoffeeIcon,
    Cookie as CookieIcon // Optional: Icon for cookie field
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
    const [playlistUrl, setPlaylistUrl] = useState(''); // Used for Zip download
    const [combineVideoUrl, setCombineVideoUrl] = useState(''); // Used for Combine download
    // *** Single state for cookie data, used by all sections ***
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
            console.log("Sending Cookie Data Length:", cookieData?.length || 0);
            const res = await fetch('/api/download', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  url: url,
                  cookieData: cookieData.trim() || null // Send cookie data
                }),
            });
             if (!res.ok) { /* ... error handling ... */ throw new Error((await res.json().catch(()=>({error:res.statusText}))).error); }
            const filename = getFilenameFromHeaders(res.headers);
            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = filename;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        } catch (error) { /* ... error handling ... */ alert(`Error downloading MP3: ${error.message}`); }
        finally { setIsLoadingMp3(false); }
      };

      // Playlist download as ZIP
      const downloadPlaylistZip = async () => {
        if (!playlistUrl) return alert('Enter playlist URL for Zip download');
        setIsLoadingZip(true);
        try {
             console.log("Sending Playlist URL (Zip):", playlistUrl);
             console.log("Sending Cookie Data Length (Zip):", cookieData?.length || 0);
            const res = await fetch('/api/download-playlist', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              // *** Include cookieData in the body ***
              body: JSON.stringify({
                  playlistUrl: playlistUrl,
                  cookieData: cookieData.trim() || null // Send cookie data
                }),
            });
             if (!res.ok) { /* ... error handling ... */ throw new Error((await res.json().catch(()=>({error:res.statusText}))).error); }
            const filename = getFilenameFromHeaders(res.headers) || 'playlist.zip';
            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = filename;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        } catch (error) { /* ... error handling ... */ alert(`Error downloading playlist zip: ${error.message}`); }
        finally { setIsLoadingZip(false); }
      };

      // Playlist download as single combined VIDEO
      const downloadCombinedVideo = async () => {
         if (!combineVideoUrl) return alert('Enter playlist URL for Single Video download');
        alert('Combining videos can take a long time, especially for long playlists. Please be patient.');
        setIsLoadingVideo(true);
        try {
            console.log("Sending Playlist URL (Combine):", combineVideoUrl);
            console.log("Sending Cookie Data Length (Combine):", cookieData?.length || 0);
            const res = await fetch('/api/convert', { // Or your combine endpoint
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              // *** Include cookieData in the body ***
              body: JSON.stringify({
                  playlistUrl: combineVideoUrl,
                  cookieData: cookieData.trim() || null // Send cookie data
                }),
            });
             if (!res.ok) { /* ... error handling ... */ throw new Error((await res.json().catch(()=>({error:res.statusText}))).error); }
            const filename = getFilenameFromHeaders(res.headers) || 'combined_video.mp4';
            const blob = await res.blob();
            console.log("Received blob type:", blob.type);
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = filename;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        } catch (error) { /* ... error handling ... */ alert(`Error downloading combined video: ${error.message}`); }
        finally { setIsLoadingVideo(false); }
      };

    // --- Cookie Text Field Component ---
    // Extracted for reusability
    const CookieInputField = () => (
        <TextField
            label="Paste YouTube Cookies Here (Optional)"
            helperText="Needed for age-restricted/private videos. Export using a browser extension (e.g., 'Get cookies.txt')."
            variant='outlined' fullWidth multiline rows={4}
            value={cookieData}
            onChange={(e) => setCookieData(e.target.value)}
            style={{marginBottom: 16}}
            placeholder="Starts with # Netscape HTTP Cookie File..."
            disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo}
            InputProps={{ // Optional: Add an icon
                startAdornment: (
                <ListItemIcon sx={{minWidth: '40px', color: 'action.active', mr: 1}}>
                    <CookieIcon />
                </ListItemIcon>
                ),
            }}
        />
    );

    // Function to render the main content based on currentView
    const renderContent = () => {
        switch (currentView) {
            case 'welcome':
                 return ( /* ... welcome message ... */
                    <Box sx={{ textAlign: 'center', mt: 8 }}>
                        <Typography variant="h2" component="h1" gutterBottom>YT Link V2</Typography>
                        <Typography variant="h5" color="text.secondary">Welcome!</Typography>
                         <Typography variant="body1" color="text.secondary" sx={{mt: 2, maxWidth: '600px', mx: 'auto'}}>
                            Select an option from the menu. Note: Some videos/playlists may require pasting YouTube cookies (exported via a browser extension) into the optional field for the download to work.
                        </Typography>
                    </Box>
                );
            case 'single':
                return (
                    <Container maxWidth="sm" sx={{ mt: 4 }}>
                        <Typography variant='h6' gutterBottom>Convert Single Video to MP3</Typography>
                        <TextField label="YouTube Video URL" variant='outlined' fullWidth value={url} onChange={(e)=> setUrl(e.target.value)} style={{marginBottom: 16}} disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo} />
                        <CookieInputField /> {/* Use reusable component */}
                        <Button variant='contained' color='primary' fullWidth onClick={downloadMP3} disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo}>
                            {isLoadingMp3 ? 'Downloading MP3...' : 'Download MP3'}
                        </Button>
                    </Container>
                );
            case 'zip':
                 return (
                    <Container maxWidth="sm" sx={{ mt: 4 }}>
                        <Typography variant='h6' gutterBottom>Download Playlist as Zip</Typography>
                        <TextField label="YouTube Playlist URL (for Zip)" variant='outlined' fullWidth value={playlistUrl} onChange={(e)=> setPlaylistUrl(e.target.value)} style={{marginBottom: 16}} disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo} />
                        <CookieInputField /> {/* Use reusable component */}
                        <Button variant='contained' color='secondary' onClick={downloadPlaylistZip} fullWidth style={{marginBottom: 16}} disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo}>
                             {isLoadingZip ? 'Downloading Zip...' : 'Download Playlist As Zip'}
                        </Button>
                    </Container>
                );
            case 'combine':
                 return (
                     <Container maxWidth="sm" sx={{ mt: 4 }}>
                        <Typography variant='h6' gutterBottom>Convert Playlist to Single Video</Typography>
                        <TextField label="YouTube Playlist URL (for Single Video)" variant='outlined' fullWidth value={combineVideoUrl} onChange={(e)=> setCombineVideoUrl(e.target.value)} style={{marginBottom: 16}} disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo} />
                        <CookieInputField /> {/* Use reusable component */}
                        <Button variant='contained' color='warning' onClick={downloadCombinedVideo} fullWidth style={{marginBottom: 16}} disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo}>
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
                        {/* ... (ListItems remain the same) ... */}
                         <ListItem disablePadding><ListItemButton selected={currentView === 'welcome'} onClick={() => setCurrentView('welcome')}><ListItemIcon><HomeIcon /></ListItemIcon><ListItemText primary="Welcome" /></ListItemButton></ListItem>
                        <Divider />
                         <ListItem disablePadding><ListItemButton selected={currentView === 'single'} onClick={() => setCurrentView('single')}><ListItemIcon><DownloadIcon /></ListItemIcon><ListItemText primary="Single MP3" /></ListItemButton></ListItem>
                        <ListItem disablePadding><ListItemButton selected={currentView === 'zip'} onClick={() => setCurrentView('zip')}><ListItemIcon><QueueMusicIcon /></ListItemIcon><ListItemText primary="Playlist Zip" /></ListItemButton></ListItem>
                        <ListItem disablePadding><ListItemButton selected={currentView === 'combine'} onClick={() => setCurrentView('combine')}><ListItemIcon><VideoLibraryIcon /></ListItemIcon><ListItemText primary="Combine Video" /></ListItemButton></ListItem>
                        <Divider />
                        <ListItem disablePadding sx={{ mt: 2 }}><ListItemButton component="a" href="https://www.buymeacoffee.com/yourlink" target="_blank" rel="noopener noreferrer"><ListItemIcon><CoffeeIcon /></ListItemIcon><ListItemText primary="Buy Me A Coffee" /></ListItemButton></ListItem>

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

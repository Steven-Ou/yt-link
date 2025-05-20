'use client';
import { useState, useEffect, useRef } from 'react'; // Added useEffect, useRef
import {
    Box, Button, Container, Divider, Drawer, List, ListItem,
    ListItemButton, ListItemIcon, ListItemText, TextField, Toolbar,
    Typography, CssBaseline,
    // Import Accordion components
    Accordion, AccordionSummary, AccordionDetails,
    // Import for custom theme
    createTheme, ThemeProvider,
    // Progress indicators
    CircularProgress, LinearProgress
} from '@mui/material';
import {
    Home as HomeIcon, Download as DownloadIcon, QueueMusic as QueueMusicIcon,
    VideoLibrary as VideoLibraryIcon, Coffee as CoffeeIcon,
    Cookie as CookieIcon,
    ExpandMore as ExpandMoreIcon,
    CheckCircleOutline as CheckCircleOutlineIcon,
    ErrorOutline as ErrorOutlineIcon,
    HourglassEmpty as HourglassEmptyIcon
 } from '@mui/icons-material';

// Helper function to parse Content-Disposition header
function getFilenameFromHeaders(headers) {
    const disposition = headers.get('Content-Disposition');
    let filename = 'downloaded_file'; // Generic default
    if (disposition) {
        console.log("Parsing Content-Disposition for filename:", disposition);
        // Try filename*=UTF-8''...
        const utf8FilenameRegex = /filename\*=UTF-8''([\w%.-]+)(?:; ?|$)/i;
        const utf8Match = disposition.match(utf8FilenameRegex);
        if (utf8Match && utf8Match[1]) {
            try {
                filename = decodeURIComponent(utf8Match[1]);
                console.log(`Parsed filename* (decoded): ${filename}`);
                return filename;
            } catch (e) { console.error("Error decoding filename*:", e); }
        }
        // Fallback: Try filename="..."
        const asciiFilenameRegex = /filename=(?:(")([^"]*)\1|([^;\n]*))/i;
        const asciiMatch = disposition.match(asciiFilenameRegex);
        if (asciiMatch && (asciiMatch[2] || asciiMatch[3])) {
            filename = asciiMatch[2] || asciiMatch[3];
            filename = filename.replace(/[\\/]/g, '_'); // Basic sanitization
            console.log(`Parsed simple filename= parameter: ${filename}`);
            return filename;
        }
    }
    console.log(`Could not parse filename from headers, using default: ${filename}`);
    return filename;
}

const drawerWidth = 240;

// Define your custom theme (from your code)
const customTheme = createTheme({
    palette: {
        mode: 'light',
        primary: { main: '#E53935', contrastText: '#FFFFFF', },
        secondary: { main: '#1A1A1A', contrastText: '#FFFFFF', },
        warning: { main: '#FFB300', contrastText: '#1A1A1A', },
        background: { default: '#000000', paper: '#FFFFFF', },
        text: { primary: '#1A1A1A', secondary: '#616161', disabled: '#BDBDBD', },
    },
    components: { /* ... Your Mui component styleOverrides ... */
        MuiCssBaseline: { styleOverrides: { body: { backgroundColor: '#000000', }, }, },
        MuiDrawer: { styleOverrides: { paper: { backgroundColor: '#1A1A1A', color: '#F5F5F5', }, }, },
        MuiListItemButton: { styleOverrides: { root: { '&.Mui-selected': { backgroundColor: 'rgba(229, 57, 53, 0.2)', '&:hover': { backgroundColor: 'rgba(229, 57, 53, 0.3)', }, }, '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.08)', }, }, }, },
        MuiTextField: { styleOverrides: { root: { '& .MuiInputBase-input': { color: '#1A1A1A', }, '& .MuiInputLabel-root': { color: '#616161', }, '& .MuiOutlinedInput-notchedOutline': { borderColor: '#BDBDBD', }, '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#E53935', }, '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#E53935', }, }, }, },
        MuiAccordion: { styleOverrides: { root: { backgroundColor: '#1A1A1A', color: '#F5F5F5', boxShadow: 'none', '&:before': { display: 'none' }, }, }, },
        MuiAccordionSummary: { styleOverrides: { root: { '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.08)', }, }, } },
        MuiDivider: { styleOverrides: { root: { backgroundColor: 'rgba(255, 255, 255, 0.12)', } } }
    },
});

// For constructing final download URLs from Python service
// Ensure this is set in .env.local as NEXT_PUBLIC_PYTHON_SERVICE_URL=http://localhost:8080
// and in Vercel environment variables as NEXT_PUBLIC_PYTHON_SERVICE_URL=https://your-render-service-url.onrender.com
const PYTHON_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_PYTHON_SERVICE_URL || '';

export default function Home() {
    const [currentView, setCurrentView] = useState('welcome');
    const [url, setUrl] = useState('');
    const [playlistUrl, setPlaylistUrl] = useState('');
    const [combineVideoUrl, setCombineVideoUrl] = useState(''); // For combine playlist MP3/Video
    const [cookieData, setCookieData] = useState('');

    // --- Job Status States ---
    const [activeJobs, setActiveJobs] = useState({});
    const pollingIntervals = useRef({});

    // --- Loading State Helpers ---
    const getJobStatus = (jobType) => activeJobs[jobType]?.status;
    const isLoading = (jobType) => {
        const status = getJobStatus(jobType);
        return status === 'queued' || status?.startsWith('processing');
    };
    const isAnyJobLoading = () => Object.values(activeJobs).some(job => job.status === 'queued' || job.status?.startsWith('processing'));

    // --- Function to Start a Job ---
    const startJob = async (jobType, endpoint, payload, operationName) => {
        setActiveJobs(prev => ({ ...prev, [jobType]: { id: null, status: 'queued', message: `Initiating ${operationName}...`, type: jobType } }));
        try {
            const res = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) { throw new Error(data.error || `Failed to start ${operationName} (status ${res.status})`); }
            if (data.jobId) {
                setActiveJobs(prev => ({ ...prev, [jobType]: { ...prev[jobType], id: data.jobId, status: 'queued', message: data.message || 'Job started, waiting for progress...' } }));
                pollJobStatus(data.jobId, jobType);
            } else { throw new Error(data.error || "Failed to get Job ID from server."); }
        } catch (error) {
            console.error(`Client-side error starting ${jobType} job:`, error);
            setActiveJobs(prev => ({ ...prev, [jobType]: { ...prev[jobType], status: 'failed', message: `Error starting ${operationName}: ${error.message}` } }));
        }
    };

    // --- Function to Poll Job Status ---
    const pollJobStatus = (jobId, jobType) => {
        if (pollingIntervals.current[jobId]) { clearInterval(pollingIntervals.current[jobId]); }
        pollingIntervals.current[jobId] = setInterval(async () => {
            try {
                const res = await fetch(`/api/job-status?jobId=${jobId}`);
                if (!res.ok) {
                    const errorData = await res.json().catch(() => ({ error: `Status check failed with ${res.status}`}));
                    throw new Error(errorData.error);
                }
                const data = await res.json();
                console.log(`Job [${jobId}] status:`, data);
                setActiveJobs(prev => {
                    const currentJob = prev[jobType];
                    // Only update if the job ID matches, to prevent race conditions if a new job of same type starts
                    if (currentJob && currentJob.id === jobId) {
                        return {
                            ...prev,
                            [jobType]: {
                                ...currentJob,
                                status: data.status,
                                message: data.status === 'completed' ? `Completed: ${data.filename || 'File ready'}` :
                                         data.status === 'failed' ? `Failed: ${data.error || 'Unknown error'}` :
                                         data.message || `Status: ${data.status}`, // Use message from server if available
                                downloadUrl: data.status === 'completed' ? data.downloadUrl : null,
                                filename: data.status === 'completed' ? data.filename : null,
                                error: data.status === 'failed' ? data.error : null,
                            }
                        };
                    }
                    return prev; // No change if job ID doesn't match current active job for this type
                });
                if (data.status === 'completed' || data.status === 'failed') {
                    clearInterval(pollingIntervals.current[jobId]);
                    delete pollingIntervals.current[jobId];
                }
            } catch (error) {
                console.error(`Error polling job ${jobId} status:`, error);
                setActiveJobs(prev => {
                     const currentJob = prev[jobType];
                     if (currentJob && currentJob.id === jobId) {
                        return { ...prev, [jobType]: { ...currentJob, status: 'failed', message: `Error checking status: ${error.message}` } };
                     }
                     return prev;
                });
                clearInterval(pollingIntervals.current[jobId]);
                delete pollingIntervals.current[jobId];
            }
        }, 5000); // Poll every 5 seconds
    };

    useEffect(() => { // Cleanup intervals on component unmount
        const intervals = pollingIntervals.current;
        return () => { Object.values(intervals).forEach(clearInterval); };
    }, []);

    // --- Download Functions (Call startJob) ---
    const downloadMP3 = () => { // Kept original name
        if (!url) return alert('Enter video URL');
        startJob('singleMp3', '/api/download', { url, cookieData: cookieData.trim() || null }, 'single MP3 download');
    };
    const downloadPlaylistZip = () => { // Kept original name
        if (!playlistUrl) return alert('Enter playlist URL for Zip download');
        startJob('playlistZip', '/api/download-playlist', { playlistUrl, cookieData: cookieData.trim() || null }, 'playlist zip');
    };
    const downloadCombinedPlaylistMp3 = () => { // Renamed in previous step, keeping it for clarity
        if (!combineVideoUrl) return alert('Enter playlist URL for Combine MP3');
        startJob('combineMp3', '/api/convert', { playlistUrl: combineVideoUrl, cookieData: cookieData.trim() || null }, 'combine playlist to MP3');
    };

    // --- Cookie Text Field Component ---
    const CookieInputField = () => ( /* ... Same as your version ... */
        <TextField
            label="Paste YouTube Cookies Here (Optional)"
            helperText="Needed for age-restricted/private videos. Export using a browser extension (e.g., 'Get cookies.txt')."
            variant='outlined' fullWidth multiline rows={4}
            value={cookieData}
            onChange={(e) => setCookieData(e.target.value)}
            style={{marginBottom: 16}}
            placeholder="Starts with # Netscape HTTP Cookie File..."
            disabled={isAnyJobLoading()}
            InputProps={{ startAdornment: ( <ListItemIcon sx={{minWidth: '40px', color: 'action.active', mr: 1}}><CookieIcon /></ListItemIcon> ), }}
        />
    );

    // --- Job Status Display Component ---
    const JobStatusDisplay = ({ jobInfo }) => {
        if (!jobInfo || !jobInfo.status || jobInfo.status === 'idle') return null; // Don't show if idle

        let icon = <HourglassEmptyIcon />;
        let color = "text.secondary";
        let showProgressBar = false;

        if (jobInfo.status === 'completed') {
            icon = <CheckCircleOutlineIcon color="success" />;
            color = "success.main";
        } else if (jobInfo.status === 'failed') {
            icon = <ErrorOutlineIcon color="error" />;
            color = "error.main";
        } else if (jobInfo.status === 'queued' || jobInfo.status?.startsWith('processing')) {
            icon = <CircularProgress size={20} sx={{ mr: 1}} color="inherit" />;
            showProgressBar = true;
        }
        
        const fullDownloadUrl = jobInfo.downloadUrl && jobInfo.filename ? `${PYTHON_SERVICE_BASE_URL}${jobInfo.downloadUrl}` : null;

        return (
            <Box sx={{ mt: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Typography variant="subtitle1" sx={{display: 'flex', alignItems: 'center', color: color}}>
                    {icon} <Box component="span" sx={{ml:1}}>{jobInfo.message || `Status: ${jobInfo.status}`}</Box>
                </Typography>
                {showProgressBar && <LinearProgress sx={{mt:1, mb:1}}/>}
                {jobInfo.status === 'completed' && fullDownloadUrl && (
                    <Button variant="contained" color="success" href={fullDownloadUrl} sx={{ mt: 1 }}>
                        Download: {jobInfo.filename}
                    </Button>
                )}
            </Box>
        );
    };

    // Function to render the main content based on currentView
    const renderContent = () => {
        switch (currentView) {
            case 'welcome':
                 return (
                    <Box sx={{ textAlign: 'center', mt: 8 }}>
                        <Typography variant="h2" component="h1" gutterBottom>YT Link V2</Typography>
                        <Typography variant="h5" color="text.secondary">Welcome!</Typography>
                         <Typography variant="body1" color="text.secondary" sx={{mt: 2, maxWidth: '600px', mx: 'auto'}}>
                            Select an option from the menu. Downloads will be processed in the background. You can monitor progress here. Note: Some videos/playlists may require pasting YouTube cookies.
                        </Typography>
                    </Box>
                );
            case 'single':
                return (
                    <Container maxWidth="sm" sx={{ mt: 4 }}>
                        <Typography variant='h6' gutterBottom>Convert Single Video to MP3</Typography>
                        <TextField label="YouTube Video URL" variant='outlined' fullWidth value={url} onChange={(e)=> setUrl(e.target.value)} style={{marginBottom: 16}} disabled={isAnyJobLoading()} />
                        <CookieInputField />
                        <Button variant='contained' color='primary' fullWidth onClick={downloadMP3} disabled={isLoading('singleMp3') || (isAnyJobLoading() && !isLoading('singleMp3'))}>
                            {isLoading('singleMp3') && <CircularProgress size={24} sx={{mr:1}} />}
                            {isLoading('singleMp3') ? 'Processing...' : 'Download MP3'}
                        </Button>
                        <JobStatusDisplay jobInfo={activeJobs['singleMp3']} />
                    </Container>
                );
            case 'zip':
                 return (
                    <Container maxWidth="sm" sx={{ mt: 4 }}>
                        <Typography variant='h6' gutterBottom>Download Playlist as Zip</Typography>
                        <TextField label="YouTube Playlist URL (for Zip)" variant='outlined' fullWidth value={playlistUrl} onChange={(e)=> setPlaylistUrl(e.target.value)} style={{marginBottom: 16}} disabled={isAnyJobLoading()} />
                        <CookieInputField />
                        <Button variant='contained' color='secondary' onClick={downloadPlaylistZip} fullWidth style={{marginBottom: 16}} disabled={isLoading('playlistZip') || (isAnyJobLoading() && !isLoading('playlistZip'))}>
                             {isLoading('playlistZip') && <CircularProgress size={24} sx={{mr:1}} />}
                             {isLoading('playlistZip') ? 'Processing...' : 'Download Playlist As Zip'}
                        </Button>
                        <JobStatusDisplay jobInfo={activeJobs['playlistZip']} />
                    </Container>
                );
            case 'combine': // This is for "Combine Playlist to Single MP3"
                 return (
                     <Container maxWidth="sm" sx={{ mt: 4 }}>
                        <Typography variant='h6' gutterBottom>Convert Playlist to Single MP3</Typography>
                        <TextField label="YouTube Playlist URL (for Single MP3)" variant='outlined' fullWidth value={combineVideoUrl} onChange={(e)=> setCombineVideoUrl(e.target.value)} style={{marginBottom: 16}} disabled={isAnyJobLoading()} />
                        <CookieInputField />
                        <Button variant='contained' color='warning' onClick={downloadCombinedPlaylistMp3} fullWidth style={{marginBottom: 16}} disabled={isLoading('combineMp3') || (isAnyJobLoading() && !isLoading('combineMp3'))}>
                             {isLoading('combineMp3') && <CircularProgress size={24} sx={{mr:1}} />}
                             {isLoading('combineMp3') ? 'Processing...' : 'Download Playlist As Single MP3'}
                        </Button>
                        <JobStatusDisplay jobInfo={activeJobs['combineMp3']} />
                    </Container>
                );
            default:
                return <Typography>Select an option</Typography>;
        }
    };

    // Main component structure (Your layout with Drawer, Accordion etc.)
    return (
        <ThemeProvider theme={customTheme}>
            <Box sx={{ display: 'flex' }}>
                <CssBaseline />
                <Drawer variant="permanent" sx={{ width: drawerWidth, flexShrink: 0, [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: 'border-box' }, }}>
                    <Toolbar />
                    <Box sx={{ overflow: 'auto' }}>
                        <List>
                            <ListItem disablePadding>
                                <ListItemButton selected={currentView === 'welcome'} onClick={() => setCurrentView('welcome')}>
                                    <ListItemIcon><HomeIcon /></ListItemIcon><ListItemText primary="Welcome" />
                                </ListItemButton>
                            </ListItem>
                            <Divider sx={{ my: 1 }} />
                            <Accordion expanded={expandedDownloads} onChange={(event, isExpanded) => setExpandedDownloads(isExpanded)} sx={{ boxShadow: 'none', '&:before': { display: 'none' } }}>
                                <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-controls="panel1a-content" id="panel1a-header" sx={{ minHeight: '48px', '& .MuiAccordionSummary-content': { my: '12px' } }}>
                                    <ListItemIcon sx={{ minWidth: '40px' }}><DownloadIcon /></ListItemIcon>
                                    <ListItemText primary="Download Options" primaryTypographyProps={{ fontWeight: 'medium' }} />
                                </AccordionSummary>
                                <AccordionDetails sx={{ p: 0 }}>
                                    <List component="div" disablePadding>
                                        <ListItem disablePadding sx={{ pl: 4 }}>
                                            <ListItemButton selected={currentView === 'single'} onClick={() => setCurrentView('single')}>
                                                <ListItemIcon><DownloadIcon /></ListItemIcon><ListItemText primary="Single MP3" />
                                            </ListItemButton>
                                        </ListItem>
                                        <ListItem disablePadding sx={{ pl: 4 }}>
                                            <ListItemButton selected={currentView === 'zip'} onClick={() => setCurrentView('zip')}>
                                                <ListItemIcon><QueueMusicIcon /></ListItemIcon><ListItemText primary="Playlist Zip" />
                                            </ListItemButton>
                                        </ListItem>
                                        <ListItem disablePadding sx={{ pl: 4 }}>
                                            {/* This button now corresponds to "Combine Playlist to Single MP3" */}
                                            <ListItemButton selected={currentView === 'combine'} onClick={() => setCurrentView('combine')}>
                                                <ListItemIcon><VideoLibraryIcon /></ListItemIcon> {/* Consider changing icon if it's now audio */}
                                                <ListItemText primary="Combine Playlist MP3" /> {/* Updated text */}
                                            </ListItemButton>
                                        </ListItem>
                                    </List>
                                </AccordionDetails>
                            </Accordion>
                            <Divider sx={{ my: 1 }} />
                            <ListItem disablePadding sx={{ mt: 2 }}>
                                <ListItemButton component="a" href="https://www.buymeacoffee.com/yourlink" target="_blank" rel="noopener noreferrer">
                                    <ListItemIcon><CoffeeIcon /></ListItemIcon><ListItemText primary="Buy Me A Coffee" />
                                </ListItemButton>
                            </ListItem>
                        </List>
                    </Box>
                </Drawer>
                <Box component="main" sx={{ flexGrow: 1, p: 3, mt: 4, mb: 4, mr: 4, ml: `${drawerWidth + 32}px`, bgcolor: 'background.paper', borderRadius: 4, boxShadow: 3, overflow: 'hidden' }}>
                    <Toolbar />
                    {renderContent()}
                </Box>
            </Box>
        </ThemeProvider>
    );
};

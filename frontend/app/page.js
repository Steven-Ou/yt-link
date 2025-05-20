'use client';
import { useState, useEffect, useRef }g from 'react'; // Added useEffect, useRef
import {
    Box, Button, Container, Divider, Drawer, List, ListItem,
    ListItemButton, ListItemIcon, ListItemText, TextField, Toolbar,
    Typography, CssBaseline, CircularProgress, LinearProgress // Added Progress indicators
} from '@mui/material';
import {
    Home as HomeIcon, Download as DownloadIcon, QueueMusic as QueueMusicIcon,
    VideoLibrary as VideoLibraryIcon, Coffee as CoffeeIcon,
    Cookie as CookieIcon, // Optional: Icon for cookie field
    CheckCircleOutline as CheckCircleOutlineIcon, // For completed status
    ErrorOutline as ErrorOutlineIcon, // For failed status
    HourglassEmpty as HourglassEmptyIcon // For processing status
 } from '@mui/icons-material';

// Helper function to parse Content-Disposition header (keep this)
function getFilenameFromHeaders(headers) {
    const disposition = headers.get('Content-Disposition');
    let filename = 'downloaded_file'; // More generic default
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

// Base URL for your deployed Python microservice (from environment variable)
// This is needed on the client-side to construct the final download link.
// In a real app, you might pass this from the server or have it in Next.js public env vars.
// For now, let's assume it's the same as what the Next.js API routes use.
// IMPORTANT: For this to work directly from the browser, your Python service
// needs to have CORS configured if it's on a different domain than your Vercel app.
// A simpler approach is to have a Next.js API route proxy the download.
const PYTHON_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_PYTHON_SERVICE_URL || ''; // See .env.local or Vercel env vars

export default function Home() {
    const [currentView, setCurrentView] = useState('welcome');
    const [url, setUrl] = useState('');
    const [playlistUrl, setPlaylistUrl] = useState('');
    const [combineVideoUrl, setCombineVideoUrl] = useState('');
    const [cookieData, setCookieData] = useState('');

    // --- Job Status States ---
    // Store job info: { id: string, status: string, message: string, downloadUrl?: string, filename?: string, type: string }
    const [activeJobs, setActiveJobs] = useState({});
    const pollingIntervals = useRef({}); // To store interval IDs for cleanup

    const isLoading = (type) => Object.values(activeJobs).some(job => job.type === type && (job.status === 'queued' || job.status?.startsWith('processing')));
    const isAnyJobLoading = () => Object.values(activeJobs).some(job => job.status === 'queued' || job.status?.startsWith('processing'));


    // --- Function to Start a Job ---
    const startJob = async (jobType, endpoint, payload) => {
        // Clear any previous messages for this job type
        setActiveJobs(prev => ({ ...prev, [jobType]: { ...prev[jobType], message: 'Initiating job...', error: null, downloadUrl: null, status: 'queued', type: jobType } }));

        try {
            const res = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || `Failed to start job (status ${res.status})`);
            }

            if (data.jobId) {
                setActiveJobs(prev => ({
                    ...prev,
                    [jobType]: {
                        id: data.jobId,
                        status: 'queued', // Or server might return initial status
                        message: data.message || 'Job started. Waiting for progress...',
                        type: jobType,
                        downloadUrl: null,
                        filename: null
                    }
                }));
                pollJobStatus(data.jobId, jobType);
            } else {
                throw new Error(data.error || "Failed to get Job ID from server.");
            }
        } catch (error) {
            console.error(`Client-side error starting ${jobType} job:`, error);
            setActiveJobs(prev => ({ ...prev, [jobType]: { ...prev[jobType], status: 'failed', message: `Error starting job: ${error.message}`, error: error.message } }));
        }
    };

    // --- Function to Poll Job Status ---
    const pollJobStatus = (jobId, jobType) => {
        if (pollingIntervals.current[jobId]) {
            clearInterval(pollingIntervals.current[jobId]); // Clear existing interval for this job
        }

        pollingIntervals.current[jobId] = setInterval(async () => {
            try {
                const res = await fetch(`/api/job-status?jobId=${jobId}`);
                if (!res.ok) {
                    // If status check fails, stop polling for this job
                    const errorData = await res.json().catch(() => ({ error: `Status check failed with ${res.status}`}));
                    throw new Error(errorData.error || `Status check failed`);
                }
                const data = await res.json();
                console.log(`Job [${jobId}] status:`, data);

                setActiveJobs(prev => ({
                    ...prev,
                    [jobType]: {
                        ...prev[jobType],
                        id: jobId,
                        status: data.status,
                        message: data.status === 'completed' ? `Completed: ${data.filename}` :
                                 data.status === 'failed' ? `Failed: ${data.error}` :
                                 `Status: ${data.status}`,
                        downloadUrl: data.status === 'completed' ? data.downloadUrl : null,
                        filename: data.status === 'completed' ? data.filename : null,
                        error: data.status === 'failed' ? data.error : null,
                    }
                }));

                if (data.status === 'completed' || data.status === 'failed') {
                    clearInterval(pollingIntervals.current[jobId]);
                    delete pollingIntervals.current[jobId];
                }
            } catch (error) {
                console.error(`Error polling job ${jobId} status:`, error);
                setActiveJobs(prev => ({
                    ...prev,
                    [jobType]: {
                        ...prev[jobType],
                        id: jobId,
                        status: 'failed',
                        message: `Error checking status: ${error.message}`,
                        error: error.message
                    }
                }));
                clearInterval(pollingIntervals.current[jobId]);
                delete pollingIntervals.current[jobId];
            }
        }, 5000); // Poll every 5 seconds
    };

    // Cleanup intervals on component unmount
    useEffect(() => {
        const intervals = pollingIntervals.current;
        return () => {
            Object.values(intervals).forEach(clearInterval);
        };
    }, []);


    // --- Download Functions (now call startJob) ---
    const downloadMP3 = () => {
        if (!url) return alert('Enter video URL');
        startJob('singleMp3', '/api/download', { url, cookieData: cookieData.trim() || null });
    };

    const downloadPlaylistZip = () => {
        if (!playlistUrl) return alert('Enter playlist URL for Zip download');
        startJob('playlistZip', '/api/download-playlist', { playlistUrl, cookieData: cookieData.trim() || null });
    };

    const downloadCombinedPlaylistMp3 = () => { // Renamed for clarity
         if (!combineVideoUrl) return alert('Enter playlist URL for Combine MP3');
        // alert('Combining playlist audio can take a long time. Please be patient.'); // Alert can be annoying with polling
        startJob('combineMp3', '/api/convert', { playlistUrl: combineVideoUrl, cookieData: cookieData.trim() || null });
    };


    // --- Cookie Text Field Component ---
    const CookieInputField = () => ( /* ... same as before ... */
        <TextField
            label="Paste YouTube Cookies Here (Optional)"
            helperText="Needed for age-restricted/private videos. Export using a browser extension (e.g., 'Get cookies.txt')."
            variant='outlined' fullWidth multiline rows={4}
            value={cookieData}
            onChange={(e) => setCookieData(e.target.value)}
            style={{marginBottom: 16}}
            placeholder="Starts with # Netscape HTTP Cookie File..."
            disabled={isAnyJobLoading()}
            InputProps={{
                startAdornment: (
                <ListItemIcon sx={{minWidth: '40px', color: 'action.active', mr: 1}}>
                    <CookieIcon />
                </ListItemIcon>
                ),
            }}
        />
    );

    // --- Job Status Display Component ---
    const JobStatusDisplay = ({ jobInfo }) => {
        if (!jobInfo || !jobInfo.status) return null;

        let icon = <HourglassEmptyIcon />;
        let color = "text.secondary";
        if (jobInfo.status === 'completed') {
            icon = <CheckCircleOutlineIcon color="success" />;
            color = "success.main";
        } else if (jobInfo.status === 'failed') {
            icon = <ErrorOutlineIcon color="error" />;
            color = "error.main";
        }

        // Construct full download URL if available
        // This assumes PYTHON_SERVICE_BASE_URL is correctly set for the client
        // and that your Python service's /download-file endpoint is publicly accessible.
        const fullDownloadUrl = jobInfo.downloadUrl ? `${PYTHON_SERVICE_BASE_URL}${jobInfo.downloadUrl}` : null;

        return (
            <Box sx={{ mt: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Typography variant="subtitle1" sx={{display: 'flex', alignItems: 'center', color: color}}>
                    {icon} <Box component="span" sx={{ml:1}}>{jobInfo.message || `Status: ${jobInfo.status}`}</Box>
                </Typography>
                {(jobInfo.status === 'queued' || jobInfo.status?.startsWith('processing')) && <LinearProgress sx={{mt:1}}/>}
                {jobInfo.status === 'completed' && fullDownloadUrl && (
                    <Button
                        variant="contained"
                        color="success"
                        href={fullDownloadUrl} // Direct download link
                        // target="_blank" // Optional: open in new tab
                        // download // This attribute might not work reliably with cross-origin if not proxied
                        sx={{ mt: 1 }}
                    >
                        Download: {jobInfo.filename || 'File'}
                    </Button>
                )}
                 {jobInfo.status === 'failed' && jobInfo.error && (
                    <Typography color="error" variant="body2" sx={{mt:1}}>Error: {jobInfo.error}</Typography>
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
                        <Button variant='contained' color='primary' fullWidth onClick={downloadMP3} disabled={isLoading('singleMp3') || isAnyJobLoading() && !isLoading('singleMp3')}>
                            {isLoading('singleMp3') ? <CircularProgress size={24} sx={{mr:1}} /> : null}
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
                        <Button variant='contained' color='secondary' onClick={downloadPlaylistZip} fullWidth style={{marginBottom: 16}} disabled={isLoading('playlistZip') || isAnyJobLoading() && !isLoading('playlistZip')}>
                             {isLoading('playlistZip') ? <CircularProgress size={24} sx={{mr:1}} /> : null}
                             {isLoading('playlistZip') ? 'Processing...' : 'Download Playlist As Zip'}
                        </Button>
                        <JobStatusDisplay jobInfo={activeJobs['playlistZip']} />
                    </Container>
                );
            case 'combine': // Changed to combine MP3
                 return (
                     <Container maxWidth="sm" sx={{ mt: 4 }}>
                        <Typography variant='h6' gutterBottom>Convert Playlist to Single MP3</Typography> {/* Changed title */}
                        <TextField label="YouTube Playlist URL (for Single MP3)" variant='outlined' fullWidth value={combineVideoUrl} onChange={(e)=> setCombineVideoUrl(e.target.value)} style={{marginBottom: 16}} disabled={isAnyJobLoading()} />
                        <CookieInputField />
                        <Button variant='contained' color='warning' onClick={downloadCombinedPlaylistMp3} fullWidth style={{marginBottom: 16}} disabled={isLoading('combineMp3') || isAnyJobLoading() && !isLoading('combineMp3')}>
                             {isLoading('combineMp3') ? <CircularProgress size={24} sx={{mr:1}} /> : null}
                             {isLoading('combineMp3') ? 'Processing...' : 'Download Playlist As Single MP3'} {/* Changed button text */}
                        </Button>
                        <JobStatusDisplay jobInfo={activeJobs['combineMp3']} />
                    </Container>
                );
            default:
                return <Typography>Select an option</Typography>;
        }
    };

    // Main component structure
    return ( /* ... (Drawer and main Box structure remains the same) ... */
        <Box sx={{ display: 'flex' }}>
            <CssBaseline />
            <Drawer variant="permanent" sx={{ width: drawerWidth, flexShrink: 0, [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: 'border-box' }, }}>
                <Toolbar />
                <Box sx={{ overflow: 'auto' }}>
                    <List>
                         <ListItem disablePadding><ListItemButton selected={currentView === 'welcome'} onClick={() => setCurrentView('welcome')}><ListItemIcon><HomeIcon /></ListItemIcon><ListItemText primary="Welcome" /></ListItemButton></ListItem>
                        <Divider />
                         <ListItem disablePadding><ListItemButton selected={currentView === 'single'} onClick={() => setCurrentView('single')}><ListItemIcon><DownloadIcon /></ListItemIcon><ListItemText primary="Single MP3" /></ListItemButton></ListItem>
                        <ListItem disablePadding><ListItemButton selected={currentView === 'zip'} onClick={() => setCurrentView('zip')}><ListItemIcon><QueueMusicIcon /></ListItemIcon><ListItemText primary="Playlist Zip" /></ListItemButton></ListItem>
                        <ListItem disablePadding><ListItemButton selected={currentView === 'combine'} onClick={() => setCurrentView('combine')}><ListItemIcon><VideoLibraryIcon /></ListItemIcon><ListItemText primary="Combine Playlist MP3" /></ListItemButton></ListItem> {/* Updated text */}
                        <Divider />
                        <ListItem disablePadding sx={{ mt: 2 }}><ListItemButton component="a" href="https://www.buymeacoffee.com/yourlink" target="_blank" rel="noopener noreferrer"><ListItemIcon><CoffeeIcon /></ListItemIcon><ListItemText primary="Buy Me A Coffee" /></ListItemButton></ListItem>
                    </List>
                </Box>
            </Drawer>
            <Box component="main" sx={{ flexGrow: 1, bgcolor: 'background.default', p: 3 }}>
                <Toolbar />
                {renderContent()}
            </Box>
        </Box>
    );
};

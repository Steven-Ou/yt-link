'use client';
import { useState, useEffect, useRef } from 'react';
import { // React component for the main page
    Box, Button, Container, Divider, Drawer, List, ListItem,
    ListItemButton, ListItemIcon, ListItemText, TextField, Toolbar,
    Typography, CssBaseline,
    Accordion, AccordionSummary, AccordionDetails,
    createTheme, ThemeProvider,
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

const drawerWidth = 240;

const customTheme = createTheme({
    palette: {
        mode: 'light',
        primary: { main: '#E53935', contrastText: '#FFFFFF', },
        secondary: { main: '#1A1A1A', contrastText: '#FFFFFF', },
        warning: { main: '#FFB300', contrastText: '#1A1A1A', },
        background: { default: '#000000', paper: '#FFFFFF', },
        text: { primary: '#1A1A1A', secondary: '#616161', disabled: '#BDBDBD', },
    },
    components: {
        MuiCssBaseline: { styleOverrides: { body: { backgroundColor: '#000000', }, }, },
        MuiDrawer: { styleOverrides: { paper: { backgroundColor: '#1A1A1A', color: '#F5F5F5', }, }, },
        MuiListItemButton: { styleOverrides: { root: { '&.Mui-selected': { backgroundColor: 'rgba(229, 57, 53, 0.2)', '&:hover': { backgroundColor: 'rgba(229, 57, 53, 0.3)', }, }, '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.08)', }, }, }, },
        MuiTextField: { styleOverrides: { root: { '& .MuiInputBase-input': { color: '#1A1A1A', }, '& .MuiInputLabel-root': { color: '#616161', }, '& .MuiOutlinedInput-notchedOutline': { borderColor: '#BDBDBD', }, '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#E53935', }, '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#E53935', }, }, }, },
        MuiAccordion: { styleOverrides: { root: { backgroundColor: '#1A1A1A', color: '#F5F5F5', boxShadow: 'none', '&:before': { display: 'none' }, }, }, },
        MuiAccordionSummary: { styleOverrides: { root: { '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.08)', }, }, } },
        MuiDivider: { styleOverrides: { root: { backgroundColor: 'rgba(255, 255, 255, 0.12)', } } }
    },
});

const PYTHON_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_PYTHON_SERVICE_URL || '';
console.log('PYTHON_SERVICE_BASE_URL on client (page load):', PYTHON_SERVICE_BASE_URL); // ADDED FOR DEBUGGING

export default function Home() {
    const [currentView, setCurrentView] = useState('welcome');
    const [url, setUrl] = useState('');
    const [playlistUrl, setPlaylistUrl] = useState('');
    const [combineVideoUrl, setCombineVideoUrl] = useState('');
    const [cookieData, setCookieData] = useState('');

    const [activeJobs, setActiveJobs] = useState({});
    const pollingIntervals = useRef({});

    const getJobStatus = (jobType) => activeJobs[jobType]?.status;
    const isLoading = (jobType) => {
        const status = getJobStatus(jobType);
        return status === 'queued' || status?.startsWith('processing');
    };
    const isAnyJobLoading = () => Object.values(activeJobs).some(job => job.status === 'queued' || job.status?.startsWith('processing'));

    const startJob = async (jobType, endpoint, payload, operationName) => {
        setActiveJobs(prev => ({ ...prev, [jobType]: { id: null, status: 'queued', message: `Initiating ${operationName}...`, type: jobType } }));
        console.log(`Client: Starting jobType "${jobType}" to endpoint "${endpoint}" with payload:`, payload);
        try {
            const res = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            if (!res.ok) {
                let errorData;
                try {
                    errorData = await res.json();
                } catch (parseError) {
                    console.error(`Client-side error: Received non-JSON response from ${endpoint} (status ${res.status}). Response text might be HTML.`);
                    throw new Error(`Server responded with ${res.status}. The API endpoint "${endpoint}" might be missing or there's a server error.`);
                }
                console.error(`Client-side error: Server responded with ${res.status} for ${endpoint}. Error data:`, errorData);
                throw new Error(errorData.error || `Failed to start ${operationName} (status ${res.status})`);
            }
            const data = await res.json();
            if (data.jobId) {
                setActiveJobs(prev => ({ ...prev, [jobType]: { ...prev[jobType], id: data.jobId, status: 'queued', message: data.message || 'Job started, waiting for progress...' } }));
                pollJobStatus(data.jobId, jobType);
            } else {
                throw new Error(data.error || "Failed to get Job ID from server, but server responded OK.");
            }
        } catch (error) {
            console.error(`Client-side error starting ${jobType} job:`, error);
            setActiveJobs(prev => ({ ...prev, [jobType]: { ...prev[jobType], status: 'failed', message: `Error starting ${operationName}: ${error.message}` } }));
        }
    };

    const pollJobStatus = (jobId, jobType) => {
        if (pollingIntervals.current[jobId]) { clearInterval(pollingIntervals.current[jobId]); }
        const jobStatusEndpoint = `/api/job-status?jobId=${jobId}`;
        pollingIntervals.current[jobId] = setInterval(async () => {
            try {
                // console.log(`Client: Polling job status for ${jobId} from ${jobStatusEndpoint}`); // Can be verbose
                const res = await fetch(jobStatusEndpoint);
                if (!res.ok) {
                    let errorData;
                    try { errorData = await res.json(); } catch (parseError) {
                         console.error(`Client-side error: Received non-JSON response from ${jobStatusEndpoint} (status ${res.status}).`);
                         throw new Error(`Status check failed with ${res.status}. API endpoint for job status might be missing.`);
                    }
                    throw new Error(errorData.error || `Status check failed with ${res.status}`);
                }
                const data = await res.json();
                console.log(`Job [${jobId}] status update:`, data); // Log the full data object
                setActiveJobs(prev => {
                    const currentJob = prev[jobType];
                    if (currentJob && currentJob.id === jobId) {
                        return {
                            ...prev,
                            [jobType]: {
                                ...currentJob,
                                status: data.status,
                                message: data.message ||
                                         (data.status === 'completed' ? `Completed: ${data.filename || 'File ready'}` :
                                         data.status === 'failed' ? `Failed: ${data.error || 'Unknown error'}` :
                                         `Status: ${data.status}`),
                                downloadUrl: data.status === 'completed' ? data.downloadUrl : null,
                                filename: data.status === 'completed' ? data.filename : null,
                                error: data.status === 'failed' ? data.error : null,
                            }
                        };
                    }
                    return prev;
                });
                if (data.status === 'completed' || data.status === 'failed' || data.status === 'not_found') {
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
        }, 5000);
    };

    useEffect(() => {
        const intervals = pollingIntervals.current;
        return () => { Object.values(intervals).forEach(clearInterval); };
    }, []);

    const downloadMP3 = () => {
        if (!url) { alert('Please enter a YouTube video URL.'); return; }
        startJob('singleMp3', '/api/start-single-mp3-job', { url, cookieData: cookieData.trim() || null }, 'single MP3 download');
    };
    const downloadPlaylistZip = () => {
        if (!playlistUrl) { alert('Please enter a YouTube playlist URL for Zip download.'); return; }
        startJob('playlistZip', '/api/start-playlist-zip-job', { playlistUrl, cookieData: cookieData.trim() || null }, 'playlist zip');
    };
    const downloadCombinedPlaylistMp3 = () => {
        if (!combineVideoUrl) { alert('Please enter a YouTube playlist URL to combine into a single MP3.'); return; }
        startJob('combineMp3', '/api/start-combine-playlist-mp3-job', { playlistUrl: combineVideoUrl, cookieData: cookieData.trim() || null }, 'combine playlist to MP3');
    };

    const CookieInputField = () => (
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

    const JobStatusDisplay = ({ jobInfo }) => {
        if (!jobInfo || !jobInfo.status || jobInfo.status === 'idle') return null;

        let icon = <HourglassEmptyIcon />;
        let color = "text.secondary";
        let showProgressBar = false;
        let messageToDisplay = jobInfo.message || `Status: ${jobInfo.status}`;

        if (jobInfo.status === 'completed') {
            icon = <CheckCircleOutlineIcon color="success" />;
            color = "success.main";
        } else if (jobInfo.status === 'failed') {
            icon = <ErrorOutlineIcon color="error" />;
            color = "error.main";
        } else if (jobInfo.status === 'queued' || jobInfo.status?.startsWith('processing')) {
            icon = <CircularProgress size={20} sx={{ mr: 1}} color="inherit" />;
            color = "info.main";
            showProgressBar = true;
        } else if (jobInfo.status === 'not_found') {
            icon = <ErrorOutlineIcon color="warning" />;
            color = "warning.main";
            messageToDisplay = `Job with ID ${jobInfo.id || 'unknown'} not found. It might have expired or an error occurred.`;
        }
        
        // Log values used for fullDownloadUrl calculation when job is completed
        let fullDownloadUrl = null;
        if (jobInfo.status === 'completed') {
            console.log('JobStatusDisplay - Job completed. Checking conditions for download button:');
            console.log('  jobInfo.downloadUrl:', jobInfo.downloadUrl);
            console.log('  jobInfo.filename:', jobInfo.filename);
            console.log('  PYTHON_SERVICE_BASE_URL (in component):', PYTHON_SERVICE_BASE_URL);
            if (jobInfo.downloadUrl && jobInfo.filename && PYTHON_SERVICE_BASE_URL) {
                fullDownloadUrl = `${PYTHON_SERVICE_BASE_URL}${jobInfo.downloadUrl}`;
                console.log('  Calculated fullDownloadUrl:', fullDownloadUrl);
            } else {
                console.log('  Could not calculate fullDownloadUrl due to missing parts.');
            }
        }


        return (
            <Box sx={{ mt: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Typography variant="subtitle1" sx={{display: 'flex', alignItems: 'center', color: color}}>
                    {icon} <Box component="span" sx={{ml:1}}>{messageToDisplay}</Box>
                </Typography>
                {showProgressBar && <LinearProgress color="info" sx={{mt:1, mb:1}}/>}
                
                {jobInfo.status === 'completed' && fullDownloadUrl && (
                    <Button variant="contained" color="success" href={fullDownloadUrl} download={jobInfo.filename} sx={{ mt: 1 }}>
                        Download: {jobInfo.filename}
                    </Button>
                )}
                {jobInfo.status === 'completed' && jobInfo.downloadUrl && jobInfo.filename && !PYTHON_SERVICE_BASE_URL && (
                    <Typography color="error.main" sx={{mt:1}}>
                        Download unavailable: Python service URL (NEXT_PUBLIC_PYTHON_SERVICE_URL) is not configured in the frontend. Please check .env.local and restart the Next.js server.
                    </Typography>
                )}
                 {jobInfo.status === 'completed' && !fullDownloadUrl && PYTHON_SERVICE_BASE_URL && !(jobInfo.downloadUrl && jobInfo.filename && !PYTHON_SERVICE_BASE_URL) && (
                    <Typography color="error.main" sx={{mt:1}}>
                        Download link seems malformed. Backend might not have provided a valid download URL or filename.
                    </Typography>
                )}
            </Box>
        );
    };

    const [expandedDownloads, setExpandedDownloads] = useState(true);

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
            case 'combine':
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
                                            <ListItemButton selected={currentView === 'combine'} onClick={() => setCurrentView('combine')}>
                                                <ListItemIcon><VideoLibraryIcon /></ListItemIcon>
                                                <ListItemText primary="Combine Playlist MP3" />
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

'use client';
import { useState, useEffect, useRef } from 'react'; // Importing React hooks
import { // Importing Material-UI components
    Box, Button, Container, Divider, Drawer, List, ListItem,
    ListItemButton, ListItemIcon, ListItemText, TextField, Toolbar,
    Typography, CssBaseline,
    Accordion, AccordionSummary, AccordionDetails,
    createTheme, ThemeProvider,
    CircularProgress, LinearProgress,
    Paper, Stack // Added for the Download Section
} from '@mui/material';
import { // Importing Material-UI icons
    Home as HomeIcon, Download as DownloadIcon, QueueMusic as QueueMusicIcon,
    VideoLibrary as VideoLibraryIcon, Coffee as CoffeeIcon,
    Cookie as CookieIcon,
    ExpandMore as ExpandMoreIcon,
    CheckCircleOutline as CheckCircleOutlineIcon,
    ErrorOutline as ErrorOutlineIcon,
    HourglassEmpty as HourglassEmptyIcon,
    Window as WindowsIcon, Apple as AppleIcon // Added for the Download Section
 } from '@mui/icons-material';

const drawerWidth = 240;// Define the width of the drawer

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


function DownloadSection() {
    const macDownloadUrl = "https://github.com/Steven-Ou/yt-link/releases/download/v1.1.7/YT.Link.Final-1.1.5-arm64.dmg";
    const windowsDownloadUrl = "https://github.com/Steven-Ou/yt-link/releases/download/v1.1.6/YT.Link.Final-1.1.5-win.zip";

    return (
        <Paper elevation={3} sx={{ mt: 8, p: { xs: 2, sm: 4 }, borderRadius: 4 }}>
            <Typography variant="h4" component="h2" gutterBottom align="center" fontWeight="bold"> Download the Desktop App </Typography>
            <Typography variant="body1" color="text.secondary" align="center" sx={{ mb: 4, maxWidth: '500px', mx: 'auto' }}> Get the full-featured desktop application for a seamless, local experience. Includes background processing and auto-updates. </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="center">
                <Button variant="contained" color="secondary" size="large" startIcon={<AppleIcon />} href={macDownloadUrl} sx={{ textTransform: 'none', fontWeight: 'bold' }}> Download for macOS </Button>
                <Button variant="contained" color="primary" size="large" startIcon={<WindowsIcon />} href={windowsDownloadUrl} sx={{ textTransform: 'none', fontWeight: 'bold' }}> Download for Windows </Button>
            </Stack>
        </Paper>
    );
}

export default function Home() {
    const [currentView, setCurrentView] = useState('welcome');
    const [url, setUrl] = useState('');
    const [playlistUrl, setPlaylistUrl] = useState('');
    const [combineVideoUrl, setCombineVideoUrl] = useState('');
    const [cookieData, setCookieData] = useState('');
    const [activeJobs, setActiveJobs] = useState({});
    const pollingIntervals = useRef({});

    // --- START: NEW LOGIC TO DETECT ELECTRON ---
    const [isElectron, setIsElectron] = useState(false);

    useEffect(() => {
        // This check runs when the component mounts. 
        // window.electronAPI is only defined if the preload script in Electron has run.
        const runningInElectron = !!window.electronAPI;
        setIsElectron(runningInElectron);
        console.log(`Running in Electron environment: ${runningInElectron}`);
    }, []);
    // --- END: NEW LOGIC TO DETECT ELECTRON ---
    
    // This now correctly points to the local Flask server when inside Electron
    const PYTHON_SERVICE_BASE_URL = 'http://127.0.0.1:8080';

    const getJobStatus = (jobType) => activeJobs[jobType]?.status;
    const isLoading = (jobType) => {
        const status = getJobStatus(jobType);
        return status === 'queued' || status?.startsWith('processing');
    };
    const isAnyJobLoading = () => Object.values(activeJobs).some(job => job.status === 'queued' || job.status?.startsWith('processing'));

    // --- UPDATED startJob FUNCTION ---
    const startJob = async (jobType, endpoint, payload, operationName) => {
        // If in Electron, build the full URL. If on the web, use the relative API path.
        const fullEndpoint = isElectron ? `${PYTHON_SERVICE_BASE_URL}/${endpoint}` : `/api/${endpoint}`;

        setActiveJobs(prev => ({ ...prev, [jobType]: { id: null, status: 'queued', message: `Initiating ${operationName}...`, type: jobType } }));
        console.log(`Client: Starting jobType "${jobType}" to endpoint "${fullEndpoint}"`);
        try {
            const res = await fetch(fullEndpoint, { // Use the constructed fullEndpoint
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            if (!res.ok) {
                let errorData;
                try {
                    errorData = await res.json();
                } catch (parseError) {
                    console.error(`Client-side error: Received non-JSON response from ${fullEndpoint} (status ${res.status}).`);
                    throw new Error(`Server responded with ${res.status}.`);
                }
                console.error(`Client-side error: Server responded with ${res.status} for ${fullEndpoint}. Error data:`, errorData);
                throw new Error(errorData.error || `Failed to start ${operationName} (status ${res.status})`);
            }
            const data = await res.json();
            if (data.jobId) {
                setActiveJobs(prev => ({ ...prev, [jobType]: { ...prev[jobType], id: data.jobId, status: 'queued', message: data.message || 'Job started...' } }));
                pollJobStatus(data.jobId, jobType);
            } else {
                throw new Error(data.error || "Failed to get Job ID from server.");
            }
        } catch (error) {
            console.error(`Client-side error starting ${jobType} job:`, error);
            setActiveJobs(prev => ({ ...prev, [jobType]: { ...prev[jobType], status: 'failed', message: `Error: ${error.message}` } }));
        }
    };

    // --- UPDATED pollJobStatus FUNCTION ---
    const pollJobStatus = (jobId, jobType) => {
        if (pollingIntervals.current[jobId]) { clearInterval(pollingIntervals.current[jobId]); }
        
        pollingIntervals.current[jobId] = setInterval(async () => {
            // If in Electron, build the full URL. If on the web, use the relative API path.
            const jobStatusEndpoint = isElectron ? `${PYTHON_SERVICE_BASE_URL}/job-status/${jobId}` : `/api/job-status?jobId=${jobId}`;
            try {
                const res = await fetch(jobStatusEndpoint);
                if (!res.ok) {
                    let errorData;
                    try { errorData = await res.json(); } catch (parseError) {
                         console.error(`Client-side error: Received non-JSON response from ${jobStatusEndpoint} (status ${res.status}).`);
                         throw new Error(`Status check failed with ${res.status}.`);
                    }
                    throw new Error(errorData.error || `Status check failed with ${res.status}`);
                }
                const data = await res.json();
                console.log(`Job [${jobId}] status update:`, data);
                setActiveJobs(prev => {
                    const currentJob = prev[jobType];
                    if (currentJob && currentJob.id === jobId) {
                        return { ...prev, [jobType]: { ...currentJob, ...data } };
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

    const downloadMP3 = () => { if (!url) { alert('Please enter a YouTube video URL.'); return; } startJob('singleMp3', 'start-single-mp3-job', { url, cookieData: cookieData.trim() || null }, 'single MP3 download'); };
    const downloadPlaylistZip = () => { if (!playlistUrl) { alert('Please enter a YouTube playlist URL for Zip download.'); return; } startJob('playlistZip', 'start-playlist-zip-job', { playlistUrl, cookieData: cookieData.trim() || null }, 'playlist zip'); };
    const downloadCombinedPlaylistMp3 = () => { if (!combineVideoUrl) { alert('Please enter a YouTube playlist URL to combine into a single MP3.'); return; } startJob('combineMp3', 'start-combine-playlist-mp3-job', { playlistUrl: combineVideoUrl, cookieData: cookieData.trim() || null }, 'combine playlist to MP3'); };

    const CookieInputField = () => ( <TextField label="Paste YouTube Cookies Here (Optional)" helperText="Needed for age-restricted/private videos." variant='outlined' fullWidth multiline rows={4} value={cookieData} onChange={(e) => setCookieData(e.target.value)} style={{marginBottom: 16}} placeholder="Starts with # Netscape HTTP Cookie File..." disabled={isAnyJobLoading()} InputProps={{ startAdornment: ( <ListItemIcon sx={{minWidth: '40px', color: 'action.active', mr: 1}}><CookieIcon /></ListItemIcon> ), }} /> );

    // This component now uses the full PYTHON_SERVICE_BASE_URL for the download link
    const JobStatusDisplay = ({ jobInfo }) => {
        if (!jobInfo || !jobInfo.status || jobInfo.status === 'idle') return null;
        let icon = <HourglassEmptyIcon />; let color = "text.secondary"; let showProgressBar = false;
        if (jobInfo.status === 'completed') { icon = <CheckCircleOutlineIcon color="success" />; color = "success.main"; }
        else if (jobInfo.status === 'failed') { icon = <ErrorOutlineIcon color="error" />; color = "error.main"; }
        else if (jobInfo.status === 'queued' || jobInfo.status?.startsWith('processing')) { icon = <CircularProgress size={20} sx={{ mr: 1}} color="inherit" />; color = "info.main"; showProgressBar = true; }
        
        const fullDownloadUrl = jobInfo.downloadUrl ? `${PYTHON_SERVICE_BASE_URL}${jobInfo.downloadUrl}` : null;

        return ( <Box sx={{ mt: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}><Typography variant="subtitle1" sx={{display: 'flex', alignItems: 'center', color: color}}>{icon} <Box component="span" sx={{ml:1}}>{jobInfo.message || `Status: ${jobInfo.status}`}</Box></Typography>{showProgressBar && <LinearProgress color="info" sx={{mt:1, mb:1}}/>} {jobInfo.status === 'completed' && fullDownloadUrl && (<Button variant="contained" color="success" href={fullDownloadUrl} download={jobInfo.filename} sx={{ mt: 1 }}>Download: {jobInfo.filename}</Button>)}</Box> );
    };

    const [expandedDownloads, setExpandedDownloads] = useState(true);

    const renderContent = () => {
        switch (currentView) {
            case 'welcome':
                 return (
                    <Box sx={{ textAlign: 'center', mt: 4 }}>
                        <Typography variant="h2" component="h1" gutterBottom>YT Link V2</Typography>
                        <Typography variant="h5" color="text.secondary">Welcome!</Typography>
                         <Typography variant="body1" color="text.secondary" sx={{mt: 2, maxWidth: '600px', mx: 'auto'}}> Select an option from the menu. Downloads will be processed in the background. Or, download the desktop app for a better experience. </Typography>
                        <DownloadSection />
                    </Box>
                );
            case 'single': return ( <Container maxWidth="sm" sx={{ mt: 4 }}><Typography variant='h6' gutterBottom>Convert Single Video to MP3</Typography><TextField label="YouTube Video URL" variant='outlined' fullWidth value={url} onChange={(e)=> setUrl(e.target.value)} style={{marginBottom: 16}} disabled={isAnyJobLoading()} /><CookieInputField /><Button variant='contained' color='primary' fullWidth onClick={downloadMP3} disabled={isLoading('singleMp3') || (isAnyJobLoading() && !isLoading('singleMp3'))}>{isLoading('singleMp3') && <CircularProgress size={24} sx={{mr:1}} />} {isLoading('singleMp3') ? 'Processing...' : 'Download MP3'}</Button><JobStatusDisplay jobInfo={activeJobs['singleMp3']} /></Container> );
            case 'zip': return ( <Container maxWidth="sm" sx={{ mt: 4 }}><Typography variant='h6' gutterBottom>Download Playlist as Zip</Typography><TextField label="YouTube Playlist URL (for Zip)" variant='outlined' fullWidth value={playlistUrl} onChange={(e)=> setPlaylistUrl(e.target.value)} style={{marginBottom: 16}} disabled={isAnyJobLoading()} /><CookieInputField /><Button variant='contained' color='secondary' onClick={downloadPlaylistZip} fullWidth style={{marginBottom: 16}} disabled={isLoading('playlistZip') || (isAnyJobLoading() && !isLoading('playlistZip'))}>{isLoading('playlistZip') && <CircularProgress size={24} sx={{mr:1}} />} {isLoading('playlistZip') ? 'Processing...' : 'Download Playlist As Zip'}</Button><JobStatusDisplay jobInfo={activeJobs['playlistZip']} /></Container> );
            case 'combine': return ( <Container maxWidth="sm" sx={{ mt: 4 }}><Typography variant='h6' gutterBottom>Convert Playlist to Single MP3</Typography><TextField label="YouTube Playlist URL (for Single MP3)" variant='outlined' fullWidth value={combineVideoUrl} onChange={(e)=> setCombineVideoUrl(e.target.value)} style={{marginBottom: 16}} disabled={isAnyJobLoading()} /><CookieInputField /><Button variant='contained' color='warning' onClick={downloadCombinedPlaylistMp3} fullWidth style={{marginBottom: 16}} disabled={isLoading('combineMp3') || (isAnyJobLoading() && !isLoading('combineMp3'))}>{isLoading('combineMp3') && <CircularProgress size={24} sx={{mr:1}} />} {isLoading('combineMp3') ? 'Processing...' : 'Download Playlist As Single MP3'}</Button><JobStatusDisplay jobInfo={activeJobs['combineMp3']} /></Container> );
            default: return <Typography>Select an option</Typography>;
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
                            <ListItem disablePadding> <ListItemButton selected={currentView === 'welcome'} onClick={() => setCurrentView('welcome')}> <ListItemIcon><HomeIcon /></ListItemIcon><ListItemText primary="Welcome" /> </ListItemButton> </ListItem>
                            <Divider sx={{ my: 1 }} />
                            <Accordion expanded={expandedDownloads} onChange={(event, isExpanded) => setExpandedDownloads(isExpanded)} sx={{ boxShadow: 'none', '&:before': { display: 'none' } }}>
                                <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-controls="panel1a-content" id="panel1a-header" sx={{ minHeight: '48px', '& .MuiAccordionSummary-content': { my: '12px' } }}>
                                    <ListItemIcon sx={{ minWidth: '40px' }}><DownloadIcon /></ListItemIcon>
                                    <ListItemText primary="Download Options" primaryTypographyProps={{ fontWeight: 'medium' }} />
                                </AccordionSummary>
                                <AccordionDetails sx={{ p: 0 }}>
                                    <List component="div" disablePadding>
                                        <ListItem disablePadding sx={{ pl: 4 }}> <ListItemButton selected={currentView === 'single'} onClick={() => setCurrentView('single')}> <ListItemIcon><DownloadIcon /></ListItemIcon><ListItemText primary="Single MP3" /> </ListItemButton> </ListItem>
                                        <ListItem disablePadding sx={{ pl: 4 }}> <ListItemButton selected={currentView === 'zip'} onClick={() => setCurrentView('zip')}> <ListItemIcon><QueueMusicIcon /></ListItemIcon><ListItemText primary="Playlist Zip" /> </ListItemButton> </ListItem>
                                        <ListItem disablePadding sx={{ pl: 4 }}> <ListItemButton selected={currentView === 'combine'} onClick={() => setCurrentView('combine')}> <ListItemIcon><VideoLibraryIcon /></ListItemIcon><ListItemText primary="Combine Playlist MP3" /> </ListItemButton> </ListItem>
                                    </List>
                                </AccordionDetails>
                            </Accordion>
                            <Divider sx={{ my: 1 }} />
                            <ListItem disablePadding sx={{ mt: 2 }}> <ListItemButton component="a" href="https://www.buymeacoffee.com/yourlink" target="_blank" rel="noopener noreferrer"> <ListItemIcon><CoffeeIcon /></ListItemIcon><ListItemText primary="Buy Me A Coffee" /> </ListItemButton> </ListItem>
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

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
    const macDownloadUrl = "https://github.com/Steven-Ou/yt-link/releases/download/v0.0.0/YT.Link.Final-1.2.0-arm64.dmg";
    const windowsDownloadUrl = "https://github.com/Steven-Ou/yt-link/releases/download/v0.0.0/YT.Link.Final-1.2.0-win.zip";

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

    const [isElectron, setIsElectron] = useState(false);

    useEffect(() => {
        const runningInElectron = !!window.electronAPI;
        setIsElectron(runningInElectron);
        console.log(`Running in Electron environment: ${runningInElectron}`);
    }, []);
    
    const PYTHON_SERVICE_BASE_URL = 'http://127.0.0.1:8080';

    const getJobStatus = (jobType) => activeJobs[jobType]?.status;
    const isLoading = (jobType) => {
        const status = getJobStatus(jobType);
        return status === 'queued' || status === 'processing';
    };
    const isAnyJobLoading = () => Object.values(activeJobs).some(job => isLoading(job.type));

    const startJob = async (jobType, endpoint, payload, operationName) => {
        const fullEndpoint = isElectron ? `${PYTHON_SERVICE_BASE_URL}/${endpoint}` : `/api/${endpoint}`;

        setActiveJobs(prev => ({ ...prev, [jobType]: { id: null, status: 'queued', message: `Initiating ${operationName}...`, type: jobType } }));
        console.log(`Client: Starting jobType "${jobType}" to endpoint "${fullEndpoint}"`);
        try {
            const res = await fetch(fullEndpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({ error: `Server responded with ${res.status}.` }));
                throw new Error(errorData.error || `Failed to start ${operationName} (status ${res.status})`);
            }
            const data = await res.json();
            if (data.jobId) {
                setActiveJobs(prev => ({ ...prev, [jobType]: { ...prev[jobType], id: data.jobId, status: 'processing', message: 'Job started...' } }));
                pollJobStatus(data.jobId, jobType);
            } else {
                throw new Error(data.error || "Failed to get Job ID from server.");
            }
        } catch (error) {
            console.error(`Client-side error starting ${jobType} job:`, error);
            setActiveJobs(prev => ({ ...prev, [jobType]: { ...prev[jobType], status: 'failed', message: `Error: ${error.message}` } }));
        }
    };

    const pollJobStatus = (jobId, jobType) => {
        if (pollingIntervals.current[jobId]) { clearInterval(pollingIntervals.current[jobId]); }
        
        pollingIntervals.current[jobId] = setInterval(async () => {
            const jobStatusEndpoint = isElectron ? `${PYTHON_SERVICE_BASE_URL}/job-status/${jobId}` : `/api/job-status?jobId=${jobId}`;
            try {
                const res = await fetch(jobStatusEndpoint);
                if (!res.ok) throw new Error(`Status check failed with ${res.status}`);

                const data = await res.json();
                console.log(`Job [${jobId}] status update:`, data);
                setActiveJobs(prev => ({ ...prev, [jobType]: { ...prev[jobType], ...data } }));
                if (data.status === 'completed' || data.status === 'failed') {
                    clearInterval(pollingIntervals.current[jobId]);
                    delete pollingIntervals.current[jobId];
                }
            } catch (error) {
                console.error(`Error polling job ${jobId} status:`, error);
                setActiveJobs(prev => ({ ...prev, [jobType]: { ...prev[jobType], status: 'failed', message: `Error checking status: ${error.message}` } }));
                clearInterval(pollingIntervals.current[jobId]);
                delete pollingIntervals.current[jobId];
            }
        }, 3000);
    };

    useEffect(() => {
        const intervals = pollingIntervals.current;
        return () => { Object.values(intervals).forEach(clearInterval); };
    }, []);

    const downloadMP3 = () => startJob('singleMp3', 'start-single-mp3-job', { url, cookieData: cookieData.trim() || null }, 'single MP3 download');
    const downloadPlaylistZip = () => startJob('playlistZip', 'start-playlist-zip-job', { playlistUrl, cookieData: cookieData.trim() || null }, 'playlist zip');
    const downloadCombinedPlaylistMp3 = () => startJob('combineMp3', 'start-combine-playlist-mp3-job', { playlistUrl: combineVideoUrl, cookieData: cookieData.trim() || null }, 'combine playlist to MP3');

    const CookieInputField = () => ( <TextField label="Paste YouTube Cookies Here (Optional)" helperText="Needed for age-restricted/private videos." variant='outlined' fullWidth multiline rows={4} value={cookieData} onChange={(e) => setCookieData(e.target.value)} style={{marginBottom: 16}} placeholder="Starts with # Netscape HTTP Cookie File..." disabled={isAnyJobLoading()} /> );

    const JobStatusDisplay = ({ jobInfo }) => {
        if (!jobInfo || !jobInfo.status || jobInfo.status === 'idle') return null;
        let icon = <HourglassEmptyIcon />; let color = "text.secondary"; let showProgressBar = false;
        if (jobInfo.status === 'completed') { icon = <CheckCircleOutlineIcon color="success" />; color = "success.main"; }
        else if (jobInfo.status === 'failed') { icon = <ErrorOutlineIcon color="error" />; color = "error.main"; }
        else if (isLoading(jobInfo.type)) { icon = <CircularProgress size={20} sx={{ mr: 1}} color="inherit" />; color = "info.main"; showProgressBar = true; }
        
        const fullDownloadUrl = jobInfo.filepath ? `${PYTHON_SERVICE_BASE_URL}/download-file/${jobInfo.id}/${jobInfo.filename}` : null;

        return ( <Box sx={{ mt: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}><Typography variant="subtitle1" sx={{display: 'flex', alignItems: 'center', color: color}}>{icon} <Box component="span" sx={{ml:1}}>{jobInfo.message || `Status: ${jobInfo.status}`}</Box></Typography>{showProgressBar && <LinearProgress color="info" sx={{mt:1, mb:1}}/>} {jobInfo.status === 'completed' && fullDownloadUrl && (<Button variant="contained" color="success" href={fullDownloadUrl} download={jobInfo.filename} sx={{ mt: 1 }}>Download: {jobInfo.filename}</Button>)}</Box> );
    };

    const renderContent = () => {
        switch (currentView) {
            case 'welcome':
                 return (
                    <Box sx={{ textAlign: 'center', mt: 4 }}>
                        <Typography variant="h2" component="h1" gutterBottom>YT Link V2</Typography>
                        <Typography variant="h5" color="text.secondary">Welcome!</Typography>
                        <Typography variant="body1" color="text.secondary" sx={{mt: 2, maxWidth: '600px', mx: 'auto'}}>Please select a download option from the menu. For the best experience, download the desktop app.</Typography>
                        <DownloadSection />
                    </Box>
                );
            case 'single': return ( <Container maxWidth="sm" sx={{ mt: 4 }}><Typography variant='h6' gutterBottom>Convert Single Video to MP3</Typography><TextField label="YouTube Video URL" variant='outlined' fullWidth value={url} onChange={(e)=> setUrl(e.target.value)} disabled={isAnyJobLoading()} /><CookieInputField /><Button variant='contained' color='primary' fullWidth onClick={downloadMP3} disabled={isLoading('singleMp3') || (isAnyJobLoading() && !isLoading('singleMp3'))}>{isLoading('singleMp3') ? 'Processing...' : 'Download MP3'}</Button><JobStatusDisplay jobInfo={activeJobs['singleMp3']} /></Container> );
            case 'zip': return ( <Container maxWidth="sm" sx={{ mt: 4 }}><Typography variant='h6' gutterBottom>Download Playlist as Zip</Typography><TextField label="YouTube Playlist URL" variant='outlined' fullWidth value={playlistUrl} onChange={(e)=> setPlaylistUrl(e.target.value)} disabled={isAnyJobLoading()} /><CookieInputField /><Button variant='contained' color='secondary' onClick={downloadPlaylistZip} fullWidth disabled={isLoading('playlistZip') || (isAnyJobLoading() && !isLoading('playlistZip'))}>{isLoading('playlistZip') ? 'Processing...' : 'Download Playlist As Zip'}</Button><JobStatusDisplay jobInfo={activeJobs['playlistZip']} /></Container> );
            // --- FIX: Combine playlist button is now disabled ---
            case 'combine': return ( <Container maxWidth="sm" sx={{ mt: 4 }}><Typography variant='h6' gutterBottom>Convert Playlist to Single MP3</Typography><TextField label="YouTube Playlist URL" variant='outlined' fullWidth value={combineVideoUrl} onChange={(e)=> setCombineVideoUrl(e.target.value)} disabled={true} /><CookieInputField /><Button variant='contained' color='warning' fullWidth disabled={true}>Feature Temporarily Disabled</Button><JobStatusDisplay jobInfo={activeJobs['combineMp3']} /></Container> );
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
                                <ListItem disablePadding> <ListItemButton selected={currentView === 'single'} onClick={() => setCurrentView('single')}> <ListItemIcon><DownloadIcon /></ListItemIcon><ListItemText primary="Single MP3" /> </ListItemButton> </ListItem>
                                <ListItem disablePadding> <ListItemButton selected={currentView === 'zip'} onClick={() => setCurrentView('zip')}> <ListItemIcon><QueueMusicIcon /></ListItemIcon><ListItemText primary="Playlist Zip" /> </ListItemButton> </ListItem>
                                {/* --- FIX: Combine playlist button is now disabled --- */}
                                <ListItem disablePadding> <ListItemButton selected={currentView === 'combine'} onClick={() => setCurrentView('combine')} disabled={true}> <ListItemIcon><VideoLibraryIcon /></ListItemIcon><ListItemText primary="Combine MP3" /> </ListItemButton> </ListItem>
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

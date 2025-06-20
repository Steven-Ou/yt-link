'use client';
import { useState, useEffect, useRef } from 'react'; // Importing React hooks
import { // Importing Material-UI components
    Box, Button, Container, Divider, Drawer, List, ListItem,
    ListItemButton, ListItemIcon, ListItemText, TextField, Toolbar,
    Typography, CssBaseline,
    Accordion, AccordionSummary, AccordionDetails,
    createTheme, ThemeProvider,
    CircularProgress, LinearProgress,
    Paper, Stack, Alert, AlertTitle
} from '@mui/material';
import { // Importing Material-UI icons
    Home as HomeIcon, Download as DownloadIcon, QueueMusic as QueueMusicIcon,
    VideoLibrary as VideoLibraryIcon, Coffee as CoffeeIcon,
    Cookie as CookieIcon,
    ExpandMore as ExpandMoreIcon,
    CheckCircleOutline as CheckCircleOutlineIcon,
    ErrorOutline as ErrorOutlineIcon,
    HourglassEmpty as HourglassEmptyIcon,
    Window as WindowsIcon, Apple as AppleIcon,
    Folder as FolderIcon
 } from '@mui/icons-material';

const drawerWidth = 240;// Define the width of the drawer

// Your custom theme - UNCHANGED
const customTheme = createTheme({
    palette: {
        mode: 'light',
        primary: { main: '#E53935', contrastText: '#FFFFFF', },
        secondary: { main: '#1A1A1A', contrastText: '#FFFFFF', },
        warning: { main: '#FFB300', contrastText: '#1A1A1A', },
        background: { default: '#F5F5F5', paper: '#FFFFFF', },
        text: { primary: '#1A1A1A', secondary: '#616161', disabled: '#BDBDBD', },
    },
    components: {
        MuiCssBaseline: { styleOverrides: { body: { backgroundColor: '#F5F5F5', }, }, },
        MuiDrawer: { styleOverrides: { paper: { backgroundColor: '#1A1A1A', color: '#F5F5F5', }, }, },
        MuiListItemButton: { styleOverrides: { root: { '&.Mui-selected': { backgroundColor: 'rgba(229, 57, 53, 0.2)', '&:hover': { backgroundColor: 'rgba(229, 57, 53, 0.3)', }, }, '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.08)', }, }, }, },
        MuiTextField: { styleOverrides: { root: { '& .MuiInputBase-input': { color: '#1A1A1A', }, '& .MuiInputLabel-root': { color: '#616161', }, '& .MuiOutlinedInput-notchedOutline': { borderColor: '#BDBDBD', }, '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#E53935', }, '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#E53935', }, }, }, },
        MuiAccordion: { styleOverrides: { root: { backgroundColor: '#1A1A1A', color: '#F5F5F5', boxShadow: 'none', '&:before': { display: 'none' }, }, }, },
        MuiAccordionSummary: { styleOverrides: { root: { '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.08)', }, }, } },
        MuiDivider: { styleOverrides: { root: { backgroundColor: 'rgba(255, 255, 255, 0.12)', } } }
    },
});

// --- WELCOME PAGE COMPONENT - UNCHANGED ---
function WelcomePage({ isElectron }) {
    const MacUtube = "https://github.com/Steven-Ou/yt-link/releases/latest"; 
    const WindUtube = "https://github.com/Steven-Ou/yt-link/releases/latest";
    return (
        <Container maxWidth="md" sx={{ textAlign: 'center' }}>
            {!isElectron && (
                <Alert severity="warning" sx={{ mb: 4, textAlign: 'left' }}>
                    <AlertTitle>Web Version Notice</AlertTitle>
                    This web interface is for demonstration only. For full functionality, please <strong>download the desktop application.</strong>
                </Alert>
            )}
            <Typography variant="h3" component="h1" gutterBottom fontWeight="bold">YT Link Converter!</Typography>
            <Typography variant="h6" color="text.secondary" sx={{ mb: 2 }}>Welcome!!</Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mt: 2, mb: 4, maxWidth: '600px', mx: 'auto' }}>
                Please download the app if you're on the Website! Website won't work. Select a Download Option and follow the directions. When the download finishes, click on the green button to save the file! That's it!
            </Typography>
            <Paper elevation={0} variant="outlined" sx={{ mt: 4, p: { xs: 2, sm: 4 }, borderRadius: 4, backgroundColor: '#fafafa' }}>
                <Typography variant="h5" component="h2" gutterBottom align="center" fontWeight="bold">Download the Desktop App</Typography>
                <Typography variant="body1" color="text.secondary" align="center" sx={{ mb: 4, maxWidth: '500px', mx: 'auto' }}>
                    Get the full-featured desktop application for a seamless, local experience. (For Windows users, make sure to extract the zip after downloading.)
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="center">
                    <Button variant="contained" color="secondary" size="large" startIcon={<AppleIcon />} href={MacUtube} sx={{ textTransform: 'none', fontWeight: 'bold' }}>Download for macOS</Button>
                    <Button variant="contained" color="primary" size="large" startIcon={<WindowsIcon />} href={WindUtube} sx={{ textTransform: 'none', fontWeight: 'bold' }}>Download for Windows</Button>
                </Stack>
            </Paper>
        </Container>
    );
}

// --- MAIN HOME COMPONENT ---
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
        setIsElectron(!!(window && window.electron));
    }, []);
    
    const getJobStatus = (jobType) => activeJobs[jobType]?.status;
    const isLoading = (jobType) => {
        const status = getJobStatus(jobType);
        return status === 'queued' || status?.startsWith('processing');
    };
    const isAnyJobLoading = () => Object.values(activeJobs).some(job => job.status === 'queued' || job.status?.startsWith('processing'));

    const startJob = async (jobType, startFunction, payload, operationName) => {
        setActiveJobs(prev => ({ ...prev, [jobType]: { id: null, status: 'queued', message: `Initiating ${operationName}...`, type: jobType, downloadPath: payload.downloadPath } }));
        try {
            const result = await startFunction(payload);
            if (result.error) { throw new Error(result.error); }
            if (result.job_id) {
                setActiveJobs(prev => ({ ...prev, [jobType]: { ...prev[jobType], id: result.job_id, status: 'queued', message: 'Job started...' } }));
                pollJobStatus(result.job_id, jobType);
            } else { throw new Error("Failed to get Job ID from server."); }
        } catch (error) {
            setActiveJobs(prev => ({ ...prev, [jobType]: { ...prev[jobType], status: 'failed', message: `Error: ${error.message}` } }));
        }
    };

    const pollJobStatus = (jobId, jobType) => {
        if (pollingIntervals.current[jobId]) { clearInterval(pollingIntervals.current[jobId]); }
        pollingIntervals.current[jobId] = setInterval(async () => {
            try {
                // Check if window.electron exists before trying to use it
                if (window.electron) {
                    const data = await window.electron.getJobStatus(jobId);
                    if (data.error) { throw new Error(data.error); }
                    setActiveJobs(prev => {
                        const currentJob = prev[jobType];
                        if (currentJob && currentJob.id === jobId) { return { ...prev, [jobType]: { ...currentJob, ...data } }; }
                        return prev;
                    });
                    if (data.status === 'completed' || data.status === 'failed' || data.status === 'not_found') {
                        clearInterval(pollingIntervals.current[jobId]);
                        delete pollingIntervals.current[jobId];
                    }
                } else {
                    // If not in electron, stop polling
                    clearInterval(pollingIntervals.current[jobId]);
                }
            } catch (error) {
                setActiveJobs(prev => {
                     const currentJob = prev[jobType];
                     if (currentJob && currentJob.id === jobId) { return { ...prev, [jobType]: { ...currentJob, status: 'failed', message: `Error checking status: ${error.message}` } }; }
                     return prev;
                });
                clearInterval(pollingIntervals.current[jobId]);
            }
        }, 2000);
    };

    useEffect(() => {
        const intervals = pollingIntervals.current;
        return () => { Object.values(intervals).forEach(clearInterval); };
    }, []);

    // --- Button Click Handlers (CORRECTED & SAFER) ---
    const handleJobRequest = async (urlValue, jobType, operationName, urlKey = 'url') => {
        if (!urlValue) {
            alert(`Please enter a YouTube URL for: ${operationName}`);
            return;
        }

        // THIS IS THE KEY FIX: Check for the Electron API at the moment of the click.
        if (!window.electron) {
            alert("This feature is only available in the desktop application. Please run this app via Electron.");
            return;
        }
        
        const downloadPath = await window.electron.selectDirectory();
        if (!downloadPath) {
            return; // User cancelled directory selection
        }

        const payload = {
            [urlKey]: urlValue,
            downloadPath,
            cookiesPath: null
        };
        
        let startFunction;
        switch(jobType) {
            case 'singleMp3': startFunction = window.electron.startSingleMp3Job; break;
            case 'playlistZip': startFunction = window.electron.startPlaylistZipJob; break;
            case 'combineMp3': startFunction = window.electron.startCombinePlaylistMp3Job; break;
            default: alert('Unknown job type'); return;
        }

        startJob(jobType, startFunction, payload, operationName);
    };

    const downloadMP3 = () => handleJobRequest(url, 'singleMp3', 'Single MP3 Download');
    const downloadPlaylistZip = () => handleJobRequest(playlistUrl, 'playlistZip', 'Playlist Zip Download', 'playlistUrl');
    const downloadCombinedPlaylistMp3 = () => handleJobRequest(combineVideoUrl, 'combineMp3', 'Combine Playlist to MP3', 'playlistUrl');
    
    // --- UI Sub-components (Unchanged logic, just a reference) ---
    const CookieInputField = () => ( <TextField label="Paste YouTube Cookies Here (Optional)" helperText="Needed for age-restricted/private videos." variant='outlined' fullWidth multiline rows={4} value={cookieData} onChange={(e) => setCookieData(e.target.value)} style={{marginBottom: 16}} placeholder="Starts with # Netscape HTTP Cookie File..." disabled={isAnyJobLoading()} InputProps={{ startAdornment: ( <ListItemIcon sx={{minWidth: '40px', color: 'action.active', mr: 1}}><CookieIcon /></ListItemIcon> ), }} /> );
    
    const JobStatusDisplay = ({ jobInfo }) => {
        if (!jobInfo || !jobInfo.status || jobInfo.status === 'idle') return null;
        let icon = <HourglassEmptyIcon />; let color = "text.secondary"; let showProgressBar = false;
        if (jobInfo.status === 'completed') { icon = <CheckCircleOutlineIcon color="success" />; color = "success.main"; }
        else if (jobInfo.status === 'failed') { icon = <ErrorOutlineIcon color="error" />; color = "error.main"; }
        else if (jobInfo.status === 'queued' || jobInfo.status?.startsWith('processing')) { icon = <CircularProgress size={20} sx={{ mr: 1}} color="inherit" />; color = "info.main"; showProgressBar = true; }
        
        const handleOpenFolder = async () => {
            if (window.electron && jobInfo.downloadPath) { 
                await window.electron.openFolder(jobInfo.downloadPath);
            } else {
                alert("Could not determine the download folder.");
            }
        };
        
        return ( <Box sx={{ mt: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}><Typography variant="subtitle1" sx={{display: 'flex', alignItems: 'center', color: color}}>{icon} <Box component="span" sx={{ml:1}}>{jobInfo.message || `Status: ${jobInfo.status}`}</Box></Typography>{showProgressBar && <LinearProgress color="info" sx={{mt:1, mb:1}}/>} {jobInfo.status === 'completed' && jobInfo.downloadPath && (<Button variant="contained" color="success" onClick={handleOpenFolder} sx={{ mt: 1 }} startIcon={<FolderIcon />}>Open Download Folder</Button>)}</Box> );
    };

    const [expandedDownloads, setExpandedDownloads] = useState(true);

    const renderContent = () => {
        switch (currentView) {
            case 'welcome': return <WelcomePage isElectron={isElectron} />;
            case 'single': return ( <Container maxWidth="sm" sx={{ mt: 4 }}><Typography variant='h6' gutterBottom>Convert Single Video to MP3</Typography><TextField label="YouTube Video URL" variant='outlined' fullWidth value={url} onChange={(e)=> setUrl(e.target.value)} style={{marginBottom: 16}} disabled={isAnyJobLoading()} /><CookieInputField /><Button variant='contained' color='primary' fullWidth onClick={downloadMP3} disabled={isLoading('singleMp3') || (isAnyJobLoading() && !isLoading('singleMp3'))}>{isLoading('singleMp3') && <CircularProgress size={24} sx={{mr:1}} />} {isLoading('singleMp3') ? 'Processing...' : 'Download MP3'}</Button><JobStatusDisplay jobInfo={activeJobs['singleMp3']} /></Container> );
            case 'zip': return ( <Container maxWidth="sm" sx={{ mt: 4 }}><Typography variant='h6' gutterBottom>Download Playlist as Zip</Typography><TextField label="YouTube Playlist URL (for Zip)" variant='outlined' fullWidth value={playlistUrl} onChange={(e)=> setPlaylistUrl(e.target.value)} style={{marginBottom: 16}} disabled={isAnyJobLoading()} /><CookieInputField /><Button variant='contained' color='secondary' onClick={downloadPlaylistZip} fullWidth style={{marginBottom: 16}} disabled={isLoading('playlistZip') || (isAnyJobLoading() && !isLoading('playlistZip'))}>{isLoading('playlistZip') && <CircularProgress size={24} sx={{mr:1}} />} {isLoading('playlistZip') ? 'Processing...' : 'Download Playlist As Zip'}</Button><JobStatusDisplay jobInfo={activeJobs['playlistZip']} /></Container> );
            case 'combine': return ( <Container maxWidth="sm" sx={{ mt: 4 }}><Typography variant='h6' gutterBottom>Convert Playlist to Single MP3</Typography><TextField label="YouTube Playlist URL (for Single MP3)" variant='outlined' fullWidth value={combineVideoUrl} onChange={(e)=> setCombineVideoUrl(e.target.value)} style={{marginBottom: 16}} disabled={isAnyJobLoading()} /><CookieInputField /><Button variant='contained' color='warning' onClick={downloadCombinedPlaylistMp3} fullWidth style={{marginBottom: 16}} disabled={isLoading('combineMp3') || (isAnyJobLoading() && !isLoading('combineMp3'))}>{isLoading('combineMp3') && <CircularProgress size={24} sx={{mr:1}} />} {isLoading('combineMp3') ? 'Processing...' : 'Download Playlist As Single MP3'}</Button><JobStatusDisplay jobInfo={activeJobs['combineMp3']} /></Container> );
            default: return <Typography>Select an option</Typography>;
        }
    };

    // Your main UI structure is UNCHANGED
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
                <Box component="main" sx={{ flexGrow: 1, p: 3 }}>
                    <Toolbar />
                    {renderContent()}
                </Box>
            </Box>
        </ThemeProvider>
    );
};

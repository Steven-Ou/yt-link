'use client';
import { useState, useEffect, useRef } from 'react';
import {
    Box, Button, Container, Divider, Drawer, List, ListItem,
    ListItemButton, ListItemIcon, ListItemText, TextField, Toolbar,
    Typography, CssBaseline, Accordion, AccordionSummary, AccordionDetails,
    createTheme, ThemeProvider, CircularProgress, LinearProgress, Paper, Stack
} from '@mui/material';
import {
    Home as HomeIcon, Download as DownloadIcon, QueueMusic as QueueMusicIcon,
    VideoLibrary as VideoLibraryIcon, Coffee as CoffeeIcon, Cookie as CookieIcon,
    ExpandMore as ExpandMoreIcon, CheckCircleOutline as CheckCircleOutlineIcon,
    ErrorOutline as ErrorOutlineIcon, HourglassEmpty as HourglassEmptyIcon,
    Window as WindowsIcon, Apple as AppleIcon
} from '@mui/icons-material';

const drawerWidth = 240;

const customTheme = createTheme({
    palette: {
        mode: 'light',
        primary: { main: '#E53935', contrastText: '#FFFFFF' },
        secondary: { main: '#1A1A1A', contrastText: '#FFFFFF' },
        warning: { main: '#FFB300', contrastText: '#1A1A1A' },
        background: { default: '#000000', paper: '#FFFFFF' },
        text: { primary: '#1A1A1A', secondary: '#616161' },
    },
    components: {
        MuiCssBaseline: { styleOverrides: { body: { backgroundColor: '#000000' } } },
        MuiDrawer: { styleOverrides: { paper: { backgroundColor: '#1A1A1A', color: '#F5F5F5' } } },
        MuiListItemButton: { styleOverrides: { root: { '&.Mui-selected': { backgroundColor: 'rgba(229, 57, 53, 0.2)' } } } }
    },
});

function DownloadSection() {
    const macDownloadUrl = "https://github.com/Steven-Ou/yt-link/releases/download/v0.0.0/YT.Link.Final-1.2.0-arm64.dmg";
    const windowsDownloadUrl = "https://github.com/Steven-Ou/yt-link/releases/download/v0.0.0/YT.Link.Final-1.2.0-win.zip";

    return (
        <Paper elevation={3} sx={{ mt: 8, p: { xs: 2, sm: 4 }, borderRadius: 4 }}>
            <Typography variant="h4" component="h2" gutterBottom align="center" fontWeight="bold">Download the Desktop App</Typography>
            <Typography variant="body1" color="text.secondary" align="center" sx={{ mb: 4, maxWidth: '500px', mx: 'auto' }}>
                Get the full-featured desktop application for a seamless, local experience.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="center">
                <Button variant="contained" color="secondary" size="large" startIcon={<AppleIcon />} href={macDownloadUrl}>Download for macOS</Button>
                <Button variant="contained" color="primary" size="large" startIcon={<WindowsIcon />} href={windowsDownloadUrl}>Download for Windows</Button>
            </Stack>
        </Paper>
    );
}

export default function Home() {
    const [currentView, setCurrentView] = useState('welcome');
    const [url, setUrl] = useState('');
    const [playlistUrl, setPlaylistUrl] = useState('');
    const [cookieData, setCookieData] = useState('');
    const [activeJobs, setActiveJobs] = useState({});
    const pollingIntervals = useRef({});
    const [isElectron, setIsElectron] = useState(false);

    useEffect(() => {
        setIsElectron(!!window.electronAPI);
    }, []);
    
    const PYTHON_SERVICE_BASE_URL = 'http://127.0.0.1:8080';

    const isLoading = (jobType) => activeJobs[jobType]?.status === 'processing' || activeJobs[jobType]?.status === 'queued';
    const isAnyJobLoading = () => Object.values(activeJobs).some(job => isLoading(job.type));

    const startJob = async (jobType, endpoint, payload) => {
        const fullEndpoint = `${PYTHON_SERVICE_BASE_URL}/${endpoint}`;
        setActiveJobs(prev => ({ ...prev, [jobType]: { status: 'queued', message: 'Initiating...', type: jobType } }));
        try {
            const res = await fetch(fullEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                 const errorData = await res.json().catch(() => ({ error: `Server error: ${res.status}` }));
                 throw new Error(errorData.error || 'Unknown server error');
            }
            const data = await res.json();
            if (data.jobId) {
                setActiveJobs(prev => ({ ...prev, [jobType]: { id: data.jobId, status: 'processing', message: 'Job started...', type: jobType } }));
                pollJobStatus(data.jobId, jobType);
            } else {
                throw new Error("Failed to get Job ID from server.");
            }
        } catch (error) {
            setActiveJobs(prev => ({ ...prev, [jobType]: { status: 'failed', message: `Error: ${error.message}`, type: jobType } }));
        }
    };

    const pollJobStatus = (jobId, jobType) => {
        if (pollingIntervals.current[jobId]) clearInterval(pollingIntervals.current[jobId]);
        pollingIntervals.current[jobId] = setInterval(async () => {
            try {
                const res = await fetch(`${PYTHON_SERVICE_BASE_URL}/job-status/${jobId}`);
                const data = await res.json();
                setActiveJobs(prev => ({ ...prev, [jobType]: { ...prev[jobType], ...data } }));
                if (data.status === 'completed' || data.status === 'failed' || data.status === 'not_found') {
                    clearInterval(pollingIntervals.current[jobId]);
                    delete pollingIntervals.current[jobId];
                }
            } catch (error) {
                setActiveJobs(prev => ({ ...prev, [jobType]: { status: 'failed', message: `Status check failed.` } }));
                clearInterval(pollingIntervals.current[jobId]);
            }
        }, 3000);
    };
    
    useEffect(() => () => Object.values(pollingIntervals.current).forEach(clearInterval), []);

    const JobStatusDisplay = ({ jobType }) => {
        const jobInfo = activeJobs[jobType];
        if (!jobInfo) return null;

        let icon, color;
        const showProgressBar = isLoading(jobType);

        if (jobInfo.status === 'completed') { icon = <CheckCircleOutlineIcon color="success" />; color = "success.main"; }
        else if (jobInfo.status === 'failed') { icon = <ErrorOutlineIcon color="error" />; color = "error.main"; }
        else if (showProgressBar) { icon = <CircularProgress size={20} sx={{ mr: 1}} color="inherit" />; color = "info.main"; }
        else { icon = <HourglassEmptyIcon />; color = "text.secondary"; }
        
        const downloadUrl = (jobInfo.status === 'completed' && jobInfo.id && jobInfo.filename) 
            ? `${PYTHON_SERVICE_BASE_URL}/download-file/${jobInfo.id}/${jobInfo.filename}` 
            : null;

        return (
            <Box sx={{ mt: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Typography variant="subtitle1" sx={{ display: 'flex', alignItems: 'center', color }}>
                    {icon}
                    <Box component="span" sx={{ ml: 1 }}>{jobInfo.message || jobInfo.error || `Status: ${jobInfo.status}`}</Box>
                </Typography>
                {showProgressBar && <LinearProgress color="info" sx={{ mt: 1 }} />}
                {downloadUrl && <Button variant="contained" color="success" href={downloadUrl} sx={{ mt: 1 }}>Download File</Button>}
            </Box>
        );
    };

    const renderContent = () => {
        const anyLoading = isAnyJobLoading();
        switch (currentView) {
            case 'welcome': 
                return (
                    <Box sx={{ textAlign: 'center', mt: 4 }}>
                        <Typography variant="h2" component="h1" gutterBottom>YT Link Converter!</Typography>
                        <Typography variant="h5" color="text.secondary">Welcome!!</Typography>
                        <Typography variant="body1" color="text.secondary" sx={{mt: 2, maxWidth: '600px', mx: 'auto'}}>
                            Please be aware the download options on this website are for demonstration only and **will not work**. 
                            For full functionality, please download the desktop application below. You may need to trust the app after downloading.
                            Once installed, the download options will work as intended.
                        </Typography>
                        <DownloadSection />
                    </Box>
                );
            case 'single': return (
                <Container maxWidth="sm" sx={{ mt: 4 }}>
                    <Typography variant='h6' gutterBottom>Convert Single Video to MP3</Typography>
                    <TextField label="YouTube Video URL" variant='outlined' fullWidth value={url} onChange={(e) => setUrl(e.target.value)} disabled={anyLoading} sx={{mb: 2}} />
                    <TextField label="Cookies (Optional)" multiline rows={4} fullWidth value={cookieData} onChange={(e) => setCookieData(e.target.value)} disabled={anyLoading} />
                    <Button sx={{mt: 2}} variant='contained' color='primary' fullWidth onClick={() => startJob('singleMp3', 'start-single-mp3-job', { url, cookieData })} disabled={isLoading('singleMp3') || (anyLoading && !isLoading('singleMp3'))}>
                        {isLoading('singleMp3') ? <CircularProgress size={24} color="inherit"/> : 'Download MP3'}
                    </Button>
                    <JobStatusDisplay jobType="singleMp3" />
                </Container>
            );
            case 'zip': return (
                <Container maxWidth="sm" sx={{ mt: 4 }}>
                    <Typography variant='h6' gutterBottom>Download Playlist as Zip</Typography>
                    <TextField label="YouTube Playlist URL" variant='outlined' fullWidth value={playlistUrl} onChange={(e) => setPlaylistUrl(e.target.value)} disabled={anyLoading} sx={{mb: 2}}/>
                    <TextField label="Cookies (Optional)" multiline rows={4} fullWidth value={cookieData} onChange={(e) => setCookieData(e.target.value)} disabled={anyLoading} />
                    <Button sx={{mt: 2}} variant='contained' color='secondary' fullWidth onClick={() => startJob('playlistZip', 'start-playlist-zip-job', { playlistUrl, cookieData })} disabled={isLoading('playlistZip') || (anyLoading && !isLoading('playlistZip'))}>
                        {isLoading('playlistZip') ? <CircularProgress size={24} color="inherit"/> : 'Download Playlist as Zip'}
                    </Button>
                    <JobStatusDisplay jobType="playlistZip" />
                </Container>
            );
            default: return <DownloadSection />;
        }
    };

    return (
        <ThemeProvider theme={customTheme}>
            <Box sx={{ display: 'flex' }}>
                <CssBaseline />
                <Drawer variant="permanent" sx={{ width: drawerWidth, flexShrink: 0, [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: 'border-box' } }}>
                    <Toolbar />
                    <List>
                        <ListItemButton selected={currentView === 'welcome'} onClick={() => setCurrentView('welcome')}><ListItemIcon><HomeIcon /></ListItemIcon><ListItemText primary="Welcome" /></ListItemButton>
                        <Divider />
                        <ListItemButton selected={currentView === 'single'} onClick={() => setCurrentView('single')}><ListItemIcon><DownloadIcon /></ListItemIcon><ListItemText primary="Single MP3" /></ListItemButton>
                        <ListItemButton selected={currentView === 'zip'} onClick={() => setCurrentView('zip')}><ListItemIcon><QueueMusicIcon /></ListItemIcon><ListItemText primary="Playlist Zip" /></ListItemButton>
                        {/* Combine feature is disabled for now for stability */}
                        <ListItemButton disabled><ListItemIcon><VideoLibraryIcon /></ListItemIcon><ListItemText primary="Combine MP3 (Soon)" /></ListItemButton>
                    </List>
                </Drawer>
                <Box component="main" sx={{ flexGrow: 1, p: 3, bgcolor: 'background.paper' }}>
                    <Toolbar />
                    {renderContent()}
                </Box>
            </Box>
        </ThemeProvider>
    );
}

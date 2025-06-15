// frontend/app/page.js
'use client'; // Required for Next.js 13+ App Router to use hooks

import { useState, useEffect } from 'react';

// --- Helper & UI Components ---

// A simple component to show job status messages
function StatusDisplay({ status }) {
    if (!status.message) return null;

    const baseClasses = "text-center p-3 mt-4 rounded-md text-sm";
    const successClasses = "bg-green-100 text-green-800";
    const errorClasses = "bg-red-100 text-red-800";
    const loadingClasses = "bg-blue-100 text-blue-800 animate-pulse";
    
    let statusClasses = "";
    if (status.type === 'error') statusClasses = errorClasses;
    else if (status.type === 'success') statusClasses = successClasses;
    else if (status.type === 'loading') statusClasses = loadingClasses;

    return (
        <div className="px-6 pb-6">
            <div className={`${baseClasses} ${statusClasses}`}>
                <p>{status.message}</p>
            </div>
        </div>
    );
}

// Warning banner for users on the web
function WebAppWarning() {
    return (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 m-4 rounded-md" role="alert">
            <p className="font-bold">Web Version Notice</p>
            <p>This web interface is for demonstration only. The features below will not work.</p>
            <p className="mt-2">For full functionality, please download the desktop application.</p>
            <a 
                href="https://github.com/steven-ou/yt-link/releases"
                target="_blank" 
                rel="noopener noreferrer" 
                className="font-bold underline hover:text-yellow-800"
            >
                Download for Windows, macOS, or Linux
            </a>
        </div>
    );
}

// --- Main Page Component ---

export default function HomePage() {
    // State for which view is active
    const [activeView, setActiveView] = useState('single'); // 'single', 'playlist', 'combine'
    
    // State for form inputs
    const [videoUrl, setVideoUrl] = useState('');
    const [playlistUrl, setPlaylistUrl] = useState('');
    const [cookies, setCookies] = useState('');
    const [playlistJobId, setPlaylistJobId] = useState('');
    
    // State for app status
    const [jobStatus, setJobStatus] = useState({ type: '', message: '' });
    const [isLoading, setIsLoading] = useState(false);
    const [isWebApp, setIsWebApp] = useState(false);

    useEffect(() => {
        if (typeof window.api === 'undefined') {
            setIsWebApp(true);
        }
    }, []);

    // --- Job Submission Logic ---
    const handleJobSubmit = async (jobFunction, params, loadingMessage) => {
        if (isWebApp) {
            setJobStatus({ type: 'error', message: 'This feature is only available in the downloaded desktop app.' });
            return;
        }
        setIsLoading(true);
        setJobStatus({ type: 'loading', message: loadingMessage });

        try {
            const result = await jobFunction(params);
            let successMessage = result.message || 'Job started successfully!';
            if (result.jobId) {
                successMessage += ` Job ID: ${result.jobId}`;
            }
            setJobStatus({ type: 'success', message: successMessage });
        } catch (error) {
            console.error("Error received in renderer:", error);
            setJobStatus({ type: 'error', message: `Error: ${error.message}` });
        } finally {
            setIsLoading(false);
        }
    };

    const handleSingleMP3Submit = (e) => {
        e.preventDefault();
        if (!videoUrl) return setJobStatus({ type: 'error', message: 'Please enter a YouTube Video URL.' });
        handleJobSubmit(window.api.startSingleMp3Job, { videoUrl, cookies }, 'Starting download...');
    };

    const handlePlaylistZipSubmit = (e) => {
        e.preventDefault();
        if (!playlistUrl) return setJobStatus({ type: 'error', message: 'Please enter a YouTube Playlist URL.' });
        handleJobSubmit(window.api.startPlaylistZipJob, { playlistUrl, cookies }, 'Starting playlist download...');
    };

    const handleCombineMp3Submit = (e) => {
        e.preventDefault();
        if (!playlistJobId) return setJobStatus({ type: 'error', message: 'Please enter a Playlist Job ID.' });
        handleJobSubmit(window.api.startCombineMp3Job, { jobId: playlistJobId }, 'Starting combination job...');
    };

    // --- Component Rendering ---

    const renderActiveView = () => {
        switch (activeView) {
            case 'single':
                return (
                    <form onSubmit={handleSingleMP3Submit}>
                        <h2 className="text-2xl font-semibold mb-4">Convert Single Video to MP3</h2>
                        {/* Form fields */}
                        <div className="mb-4">
                            <label htmlFor="video-url" className="block text-sm font-medium text-gray-700 mb-1">YouTube Video URL</label>
                            <input id="video-url" type="text" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div className="mb-4">
                            <label htmlFor="cookies-single" className="block text-sm font-medium text-gray-700 mb-1">Cookies (Optional)</label>
                            <textarea id="cookies-single" value={cookies} onChange={(e) => setCookies(e.target.value)} rows="4" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
                        </div>
                        <button type="submit" disabled={isLoading} className="w-full bg-red-600 text-white font-bold py-2 px-4 rounded-md hover:bg-red-700 disabled:bg-gray-400">
                            {isLoading ? 'Processing...' : 'DOWNLOAD MP3'}
                        </button>
                    </form>
                );
            case 'playlist':
                return (
                    <form onSubmit={handlePlaylistZipSubmit}>
                        <h2 className="text-2xl font-semibold mb-4">Download Playlist as Zip</h2>
                        {/* Form fields */}
                        <div className="mb-4">
                            <label htmlFor="playlist-url" className="block text-sm font-medium text-gray-700 mb-1">YouTube Playlist URL</label>
                            <input id="playlist-url" type="text" value={playlistUrl} onChange={(e) => setPlaylistUrl(e.target.value)} placeholder="https://www.youtube.com/playlist?list=..." className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div className="mb-4">
                            <label htmlFor="cookies-playlist" className="block text-sm font-medium text-gray-700 mb-1">Cookies (Optional)</label>
                            <textarea id="cookies-playlist" value={cookies} onChange={(e) => setCookies(e.target.value)} rows="4" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
                        </div>
                        <button type="submit" disabled={isLoading} className="w-full bg-gray-800 text-white font-bold py-2 px-4 rounded-md hover:bg-gray-900 disabled:bg-gray-400">
                            {isLoading ? 'Processing...' : 'DOWNLOAD PLAYLIST AS ZIP'}
                        </button>
                    </form>
                );
            case 'combine':
                return (
                    <form onSubmit={handleCombineMp3Submit}>
                        <h2 className="text-2xl font-semibold mb-4">Combine Playlist MP3s</h2>
                        <div className="mb-4">
                            <label htmlFor="playlist-job-id" className="block text-sm font-medium text-gray-700 mb-1">Playlist Job ID</label>
                            <input id="playlist-job-id" type="text" value={playlistJobId} onChange={(e) => setPlaylistJobId(e.target.value)} placeholder="Enter Job ID from a completed download" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <p className="text-xs text-gray-500 mb-4">After downloading a playlist, you will get a Job ID. Enter it here to combine the downloaded MP3s into a single file.</p>
                        <button type="submit" disabled={isLoading} className="w-full bg-green-600 text-white font-bold py-2 px-4 rounded-md hover:bg-green-700 disabled:bg-gray-400">
                            {isLoading ? 'Processing...' : 'COMBINE MP3s'}
                        </button>
                    </form>
                );
            default:
                return null;
        }
    };

    const NavItem = ({ view, label }) => {
        const isActive = activeView === view;
        return (
            <button
                onClick={() => setActiveView(view)}
                className={`w-full text-left px-4 py-2 rounded-md text-sm font-medium ${isActive ? 'bg-gray-900 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}
            >
                {label}
            </button>
        );
    };

    return (
        <div className="flex h-screen bg-gray-100 font-sans">
            {/* Sidebar */}
            <aside className="w-64 bg-gray-800 text-white flex flex-col">
                <div className="h-16 flex items-center justify-center border-b border-gray-700">
                    <h1 className="text-xl font-bold">YT Link V2</h1>
                </div>
                <nav className="flex-1 px-2 py-4 space-y-2">
                    <NavItem view="single" label="Single MP3" />
                    <NavItem view="playlist" label="Playlist Zip" />
                    <NavItem view="combine" label="Combine MP3s" />
                </nav>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col">
                {isWebApp && <WebAppWarning />}
                <div className="flex-1 p-6 bg-white">
                    {renderActiveView()}
                </div>
                <StatusDisplay status={jobStatus} />
            </main>
        </div>
    );
}

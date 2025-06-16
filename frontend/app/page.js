// frontend/app/page.js
'use client'; // Required for Next.js 13+ App Router to use hooks

import { useState, useEffect } from 'react';

// --- Reusable SVG Icons ---
const AppleIcon = () => (
  <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
    <path d="M10.333 1.833a2.313 2.313 0 00-2.015.999A2.25 2.25 0 006.333 1.833c-1.306 0-2.368.992-2.368 2.22 0 .93.633 1.733 1.517 2.033a2.38 2.38 0 01-1.233 2.11C2.933 9.125 2 10.883 2 12.917c0 3.35 2.492 4.25 4.883 4.25.775 0 1.5-.15 2.2-.4.667-.25 1.15-.367 1.917-.367s1.25.117 1.917.367c.7.25 1.425.4 2.2.4 2.392 0 4.883-.9 4.883-4.25 0-2.034-.933-3.792-2.25-4.717a2.38 2.38 0 01-1.233-2.11c.884-.3 1.517-1.102 1.517-2.033 0-1.228-1.062-2.22-2.368-2.22z" />
  </svg>
);

const WindowsIcon = () => (
  <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
    <path d="M0 3h9.5v6.5H0V3zm0 7.5h9.5V17H0v-6.5zm10.5-7.5H20v6.5h-9.5V3zm0 7.5H20V17h-9.5v-6.5z" />
  </svg>
);

// --- UI Components ---
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
            <div className={`${baseClasses} ${statusClasses}`}><p>{status.message}</p></div>
        </div>
    );
}

// This is the new Welcome/Download page component.
function WelcomePage() {
    return (
        <div className="text-center">
            <h2 className="text-3xl font-bold mb-2">YT Link V2</h2>
            <p className="text-lg text-gray-600 mb-6">Welcome!</p>
            <p className="max-w-md mx-auto text-gray-500 mb-8">
                Select an option from the menu. Downloads will be processed in the background.
                Or, download the desktop app for a better experience.
            </p>
            <div className="bg-gray-50 p-6 rounded-lg shadow-inner">
                <h3 className="text-xl font-semibold mb-4">Download the Desktop App</h3>
                <p className="text-sm text-gray-500 mb-6">
                    Get the full-featured desktop application for a seamless, local experience. Includes background processing and all updates.
                </p>
                <div className="flex justify-center space-x-4">
                    <a href="https://github.com/Steven-Ou/yt-link/releases" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center bg-gray-800 text-white font-semibold py-2 px-4 rounded-md hover:bg-gray-900 transition-colors duration-300">
                        <AppleIcon />
                        Download for macOS
                    </a>
                    <a href="https://github.com/Steven-Ou/yt-link/releases" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center bg-red-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-red-700 transition-colors duration-300">
                        <WindowsIcon />
                        Download for Windows
                    </a>
                </div>
            </div>
        </div>
    );
}


// --- Main Page Component ---
export default function HomePage() {
    const [activeView, setActiveView] = useState('welcome');
    const [videoUrl, setVideoUrl] = useState('');
    const [playlistUrl, setPlaylistUrl] = useState('');
    const [cookies, setCookies] = useState('');
    const [playlistJobId, setPlaylistJobId] = useState('');
    const [jobStatus, setJobStatus] = useState({ type: '', message: '' });
    const [isLoading, setIsLoading] = useState(false);
    const [isWebApp, setIsWebApp] = useState(false);

    useEffect(() => {
        if (typeof window.api === 'undefined') {
            setIsWebApp(true);
        }
    }, []);

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
            if (result.jobId) successMessage += ` Job ID: ${result.jobId}`;
            setJobStatus({ type: 'success', message: successMessage });
        } catch (error) {
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

    const renderActiveView = () => {
        // In a web browser, ONLY show the welcome/download page.
        if (isWebApp) {
            return <WelcomePage />;
        }

        // In the Electron app, switch between views.
        switch (activeView) {
            case 'welcome':
                return <WelcomePage />;
            case 'single':
                return (
                    <form onSubmit={handleSingleMP3Submit}>
                        <h2 className="text-2xl font-semibold mb-4">Convert Single Video to MP3</h2>
                        <div className="mb-4">
                            <label htmlFor="video-url" className="block text-sm font-medium text-gray-700 mb-1">YouTube Video URL</label>
                            <input id="video-url" type="text" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div className="mb-4">
                            <label htmlFor="cookies-single" className="block text-sm font-medium text-gray-700 mb-1">Cookies (Optional)</label>
                            <textarea id="cookies-single" value={cookies} onChange={(e) => setCookies(e.target.value)} rows="4" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Paste your Netscape cookie file content here..."></textarea>
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
                        <div className="mb-4">
                            <label htmlFor="playlist-url" className="block text-sm font-medium text-gray-700 mb-1">YouTube Playlist URL</label>
                            <input id="playlist-url" type="text" value={playlistUrl} onChange={(e) => setPlaylistUrl(e.target.value)} placeholder="https://www.youtube.com/playlist?list=..." className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div className="mb-4">
                            <label htmlFor="cookies-playlist" className="block text-sm font-medium text-gray-700 mb-1">Cookies (Optional)</label>
                            <textarea id="cookies-playlist" value={cookies} onChange={(e) => setCookies(e.target.value)} rows="4" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Paste your Netscape cookie file content here..."></textarea>
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
                return <WelcomePage />;
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
            {/* Sidebar is hidden on web, but shown in Electron */}
            {!isWebApp && (
                <aside className="w-64 bg-gray-800 text-white flex flex-col flex-shrink-0">
                    <div className="h-16 flex items-center justify-center border-b border-gray-700">
                        <h1 className="text-xl font-bold">YT Link</h1>
                    </div>
                    <nav className="flex-1 px-2 py-4 space-y-2">
                        <NavItem view="welcome" label="Welcome" />
                        <NavItem view="single" label="Single MP3" />
                        <NavItem view="playlist" label="Playlist Zip" />
                        <NavItem view="combine" label="Combine MP3s" />
                    </nav>
                </aside>
            )}

            {/* Main Content */}
            <main className="flex-1 flex flex-col overflow-y-auto">
                 <div className="flex-1 p-6 bg-white flex items-center justify-center">
                    {renderActiveView()}
                </div>
                {!isWebApp && <StatusDisplay status={jobStatus} />}
            </main>
        </div>
    );
}

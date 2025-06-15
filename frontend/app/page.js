// frontend/app/page.js
'use client'; // Required for Next.js 13+ App Router to use hooks

import { useState, useEffect } from 'react';

// A simple component to show job status
function StatusDisplay({ status }) {
    if (!status.message) return null;

    const baseClasses = "text-center p-2 mt-4 rounded-md";
    const successClasses = "bg-green-100 text-green-800";
    const errorClasses = "bg-red-100 text-red-800";
    const loadingClasses = "bg-blue-100 text-blue-800 animate-pulse";
    
    let statusClasses = "";
    if (status.type === 'error') {
        statusClasses = errorClasses;
    } else if (status.type === 'success') {
        statusClasses = successClasses;
    } else if (status.type === 'loading') {
        statusClasses = loadingClasses;
    }

    return (
        <div className={`${baseClasses} ${statusClasses}`}>
            <p>{status.message}</p>
        </div>
    );
}

// ** NEW COMPONENT **
// This banner will only show up when the app is opened in a regular web browser.
function WebAppWarning() {
    return (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-8 rounded-md" role="alert">
            <p className="font-bold">Web Version Notice</p>
            <p>This web interface is for demonstration only. The download and conversion features require the backend service and will not work here.</p>
            <p className="mt-2">For full functionality, please download the desktop application from our GitHub page.</p>
            <a 
                href="https://github.com/steven-ou/yt-link/releases" // <-- Direct link to your releases!
                target="_blank" 
                rel="noopener noreferrer" 
                className="font-bold underline hover:text-yellow-800"
            >
                Download the App
            </a>
        </div>
    );
}


export default function HomePage() {
    const [videoUrl, setVideoUrl] = useState('');
    const [playlistUrl, setPlaylistUrl] = useState('');
    const [cookies, setCookies] = useState('');
    const [playlistJobId, setPlaylistJobId] = useState('');
    
    const [jobStatus, setJobStatus] = useState({ type: '', message: '' });
    const [isLoading, setIsLoading] = useState(false);
    const [isWebApp, setIsWebApp] = useState(false); // State to track if it's the web version

    // This effect runs once on startup to check the environment.
    useEffect(() => {
        // If window.api does NOT exist, it means the preload script didn't run.
        // This is a reliable way to know we are in a standard browser.
        if (typeof window.api === 'undefined') {
            setIsWebApp(true);
        }
    }, []);


    // Generic job handler to reduce repetition
    const handleJobSubmit = async (jobFunction, params, loadingMessage) => {
        // Prevent submissions if on the web app
        if (isWebApp) {
            setJobStatus({ type: 'error', message: 'This feature is only available in the downloaded desktop app.' });
            return;
        }

        setIsLoading(true);
        setJobStatus({ type: 'loading', message: loadingMessage });

        try {
            const result = await jobFunction(params);
            console.log('Job started successfully:', result);
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
        if (!videoUrl) {
            setJobStatus({ type: 'error', message: 'Please enter a YouTube Video URL.' });
            return;
        }
        handleJobSubmit(window.api.startSingleMp3Job, { videoUrl, cookies }, 'Starting download... please wait.');
    };

    const handlePlaylistZipSubmit = (e) => {
        e.preventDefault();
        if (!playlistUrl) {
            setJobStatus({ type: 'error', message: 'Please enter a YouTube Playlist URL.' });
            return;
        }
        handleJobSubmit(window.api.startPlaylistZipJob, { playlistUrl, cookies }, 'Starting playlist download... this may take a while.');
    };

    const handleCombineMp3Submit = (e) => {
        e.preventDefault();
        if (!playlistJobId) {
            setJobStatus({ type: 'error', message: 'Please enter the Job ID of a completed playlist download.' });
            return;
        }
        handleJobSubmit(window.api.startCombineMp3Job, { jobId: playlistJobId }, 'Starting combination job...');
    };


    return (
        <main className="container mx-auto p-8 font-sans">
            
            {/* Conditionally render the warning banner */}
            {isWebApp && <WebAppWarning />}

            <h1 className="text-4xl font-bold text-center mb-8">YT Link V2</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                
                {/* Single MP3 Card */}
                <div className="bg-white p-6 rounded-lg shadow-md">
                    <h2 className="text-2xl font-semibold mb-4">1. Convert Single Video</h2>
                    <form onSubmit={handleSingleMP3Submit}>
                        <div className="mb-4">
                            <label htmlFor="video-url" className="block text-sm font-medium text-gray-700 mb-1">YouTube Video URL</label>
                            <input
                                id="video-url"
                                type="text"
                                value={videoUrl}
                                onChange={(e) => setVideoUrl(e.target.value)}
                                placeholder="https://www.youtube.com/watch?v=..."
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div className="mb-4">
                            <label htmlFor="cookies-single" className="block text-sm font-medium text-gray-700 mb-1">Cookies (Optional)</label>
                            <textarea
                                id="cookies-single"
                                value={cookies}
                                onChange={(e) => setCookies(e.target.value)}
                                rows="3"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            ></textarea>
                        </div>
                        <button 
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-red-600 text-white font-bold py-2 px-4 rounded-md hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                        >
                            {isLoading ? 'Processing...' : 'DOWNLOAD MP3'}
                        </button>
                    </form>
                </div>

                {/* Playlist Zip Card */}
                <div className="bg-white p-6 rounded-lg shadow-md">
                    <h2 className="text-2xl font-semibold mb-4">2. Download Playlist</h2>
                    <form onSubmit={handlePlaylistZipSubmit}>
                        <div className="mb-4">
                            <label htmlFor="playlist-url" className="block text-sm font-medium text-gray-700 mb-1">YouTube Playlist URL</label>
                            <input
                                id="playlist-url"
                                type="text"
                                value={playlistUrl}
                                onChange={(e) => setPlaylistUrl(e.target.value)}
                                placeholder="https://www.youtube.com/playlist?list=..."
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div className="mb-4">
                            <label htmlFor="cookies-playlist" className="block text-sm font-medium text-gray-700 mb-1">Cookies (Optional)</label>
                            <textarea
                                id="cookies-playlist"
                                value={cookies}
                                onChange={(e) => setCookies(e.target.value)}
                                rows="3"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            ></textarea>
                        </div>
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-gray-800 text-white font-bold py-2 px-4 rounded-md hover:bg-gray-900 disabled:bg-gray-400 disabled:cursor-not-allowed"
                        >
                             {isLoading ? 'Processing...' : 'DOWNLOAD PLAYLIST AS ZIP'}
                        </button>
                    </form>
                </div>

                {/* Combine MP3s Card */}
                <div className="bg-white p-6 rounded-lg shadow-md md:col-span-2 lg:col-span-1">
                    <h2 className="text-2xl font-semibold mb-4">3. Combine Playlist MP3s</h2>
                    <form onSubmit={handleCombineMp3Submit}>
                        <div className="mb-4">
                            <label htmlFor="playlist-job-id" className="block text-sm font-medium text-gray-700 mb-1">Playlist Job ID</label>
                            <input
                                id="playlist-job-id"
                                type="text"
                                value={playlistJobId}
                                onChange={(e) => setPlaylistJobId(e.target.value)}
                                placeholder="Enter Job ID from a completed Step 2"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-green-600 text-white font-bold py-2 px-4 rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                        >
                             {isLoading ? 'Processing...' : 'COMBINE MP3s'}
                        </button>
                    </form>
                </div>

            </div>

            <StatusDisplay status={jobStatus} />
        </main>
    );
}

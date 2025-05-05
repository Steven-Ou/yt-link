'use client';
import { useState } from 'react';
import { Button, Divider, TextField, Typography } from '@mui/material';
import { Container } from '@mui/system';

// Helper function to parse Content-Disposition header
function getFilenameFromHeaders(headers) {
    const disposition = headers.get('Content-Disposition');
    // Default filename if parsing fails - adjust based on expected type
    let filename = 'downloaded_file'; // More generic default

    if (disposition) {
        console.log("Parsing Content-Disposition:", disposition);
        // Try filename*=UTF-8''...
        const utf8FilenameRegex = /filename\*=UTF-8''([\w%.-]+)(?:; ?|$)/i;
        const utf8Match = disposition.match(utf8FilenameRegex);
        if (utf8Match && utf8Match[1]) {
            try {
                filename = decodeURIComponent(utf8Match[1]);
                console.log(`Successfully parsed filename* (decoded): ${filename}`);
                return filename;
            } catch (e) {
                console.error("Error decoding filename*:", e);
            }
        }

        // Fallback: Try filename="..."
        const asciiFilenameRegex = /filename=(?:(")([^"]*)\1|([^;\n]*))/i;
        const asciiMatch = disposition.match(asciiFilenameRegex);
        if (asciiMatch && (asciiMatch[2] || asciiMatch[3])) {
            filename = asciiMatch[2] || asciiMatch[3];
            // Basic sanitization for ASCII filename - remove path characters if any
             filename = filename.replace(/[\\/]/g, '_');
            console.log(`Parsed simple filename= parameter: ${filename}`);
            return filename;
        }
    }
    console.log(`Could not parse filename from headers, using default: ${filename}`);
    return filename;
}


export default function Home() {
    //States variables
    const [url, setUrl] = useState('');
    const [playlistUrl, setPlaylistUrl] = useState('');
    // Add loading states for user feedback
    const [isLoadingMp3, setIsLoadingMp3] = useState(false);
    const [isLoadingZip, setIsLoadingZip] = useState(false);
    const [isLoadingVideo, setIsLoadingVideo] = useState(false);


    // Single video download
    const downloadMP3 = async () => {
        if (!url) return alert('Enter video URL');
        setIsLoadingMp3(true); // Start loading
        try {
            const res = await fetch('/api/download', { // Endpoint for single MP3
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url }),
            });

            if (!res.ok) {
                const errorBody = await res.json().catch(() => ({ error: 'Unknown server error' }));
                console.error("Server error response:", errorBody);
                throw new Error(errorBody.error || res.statusText); // Throw error to be caught
            }

            const filename = getFilenameFromHeaders(res.headers);
            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);

        } catch (error) {
            console.error("Client-side download error:", error);
            alert(`Error downloading MP3: ${error.message}`);
        } finally {
             setIsLoadingMp3(false); // Stop loading regardless of outcome
        }
      };

      // Playlist download as ZIP
      const downloadPlaylistZip = async () => {
        if (!playlistUrl) return alert('Enter playlist URL');
        setIsLoadingZip(true); // Start loading
        try {
            const res = await fetch('/api/download-playlist', { // Endpoint for playlist ZIP
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ playlistUrl }),
            });

            if (!res.ok) {
                 const errorBody = await res.json().catch(() => ({ error: 'Unknown server error' }));
                 console.error("Server error response (playlist zip):", errorBody);
                 throw new Error(errorBody.error || res.statusText);
            }

            // Assuming the zip endpoint also sends Content-Disposition
            const filename = getFilenameFromHeaders(res.headers) || 'playlist.zip'; // Default zip name

            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);

        } catch (error) {
             console.error("Client-side playlist zip download error:", error);
             alert(`Error downloading playlist zip: ${error.message}`);
        } finally {
            setIsLoadingZip(false); // Stop loading
        }
      };

      // --- NEW: Playlist download as single combined VIDEO ---
      const downloadCombinedVideo = async () => {
        if (!playlistUrl) return alert('Enter playlist URL');
        // Add a warning about potential long processing time
        alert('Combining videos can take a long time, especially for long playlists. Please be patient.');
        setIsLoadingVideo(true); // Start loading
        try {
            // *** IMPORTANT: Replace '/api/convert' with your actual endpoint path ***
            const res = await fetch('/api/convert', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ playlistUrl }),
            });

            if (!res.ok) {
                 const errorBody = await res.json().catch(() => ({ error: 'Unknown server error' }));
                 console.error("Server error response (combine video):", errorBody);
                 throw new Error(errorBody.error || res.statusText);
            }

            // Get filename (e.g., playlist_combined.mp4) from headers
            const filename = getFilenameFromHeaders(res.headers) || 'combined_video.mp4'; // Default video name

            const blob = await res.blob();
            // Check blob type if needed - should be video/mp4 or similar
            console.log("Received blob type:", blob.type);

            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);

        } catch (error) {
             console.error("Client-side combined video download error:", error);
             alert(`Error downloading combined video: ${error.message}`);
        } finally {
            setIsLoadingVideo(false); // Stop loading
        }
      };


    return(
        <Container maxWidth="sm" style={{marginTop: 80}}>
            <Typography variant='h4' gutterBottom align='center'>
                🎧 YouTube Downloader 🎬
            </Typography>

             {/* Single Video Section */}
            <Typography variant='h6' gutterBottom>
                Convert a Single Video to MP3
            </Typography>
            <TextField
                label="YouTube Video URL"
                variant='outlined'
                fullWidth
                value={url}
                onChange={(e)=> setUrl(e.target.value)}
                style={{marginBottom: 16}}
                disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo} // Disable input while loading
            />
            <Button
                variant='contained'
                color='primary'
                fullWidth
                onClick={downloadMP3}
                disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo} // Disable button while loading
            >
                {isLoadingMp3 ? 'Downloading MP3...' : 'Download MP3'}
            </Button>
            <Divider style={{margin:"40px 0"}}/>

             {/* Playlist Section */}
            <Typography variant='h6' gutterBottom>
                Download a Whole Album
            </Typography>
            <TextField
                label="YouTube Playlist URL"
                variant='outlined'
                fullWidth
                value={playlistUrl}
                onChange={(e)=> setPlaylistUrl(e.target.value)}
                style={{marginBottom: 16}}
                disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo} // Disable input while loading
            />
            {/* Button for Playlist ZIP */}
            <Button
                variant='contained'
                color='secondary'
                onClick={downloadPlaylistZip} // Renamed function for clarity
                fullWidth
                style={{marginBottom: 16}}
                disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo} // Disable button while loading
            >
                 {isLoadingZip ? 'Downloading Zip...' : 'Download Playlist As Zip'}
            </Button>
            <Divider style={{margin:"40px 0"}}/>
            {/* --- NEW: Playlist download as single combined VIDEO --- */}
            <Typography variant='h6' gutterBottom>
                Convert a Album to MP3
            </Typography>
            <TextField
                label="YouTube Playlist URL"
                variant='outlined'
                fullWidth
                value={playlistUrl}
                onChange={(e)=> setPlaylistUrl(e.target.value)}
                style={{marginBottom: 16}}
                disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo} // Disable input while loading
            />
            {/* --- NEW: Button for Combined Video --- */}
            <Button
                variant='contained'
                // Choose a different color or style if desired
                color='warning' // Example: use warning color for potentially long operation
                onClick={downloadCombinedVideo}
                fullWidth
                style={{marginBottom: 16}}
                disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo} // Disable button while loading
            >
                 {isLoadingVideo ? 'Combining Video...' : 'Download Playlist As Single Video'}
            </Button>

            {/* Consider adding a button for the combined MP3 playlist endpoint if you have it */}
            {/* <Button variant='contained' color='secondary' onClick={downloadCombinedPlaylistMp3} fullWidth>
                 Download Playlist As Single MP3
             </Button> */}
        </Container>
    );
};

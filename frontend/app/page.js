'use client';
import { useState } from 'react';
import { Button, Divider, TextField, Typography } from '@mui/material';
import { Container } from '@mui/system';

// Helper function to parse Content-Disposition header
function getFilenameFromHeaders(headers) {
    const disposition = headers.get('Content-Disposition');
    let filename = 'downloaded_file'; // Generic default

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
    const [playlistUrl, setPlaylistUrl] = useState(''); // For playlist zip download
    // *** NEW STATE for the third input field ***
    const [combineVideoUrl, setCombineVideoUrl] = useState(''); // For combined video download

    // Add loading states for user feedback
    const [isLoadingMp3, setIsLoadingMp3] = useState(false);
    const [isLoadingZip, setIsLoadingZip] = useState(false);
    const [isLoadingVideo, setIsLoadingVideo] = useState(false);


    // Single video download
    const downloadMP3 = async () => {
        if (!url) return alert('Enter video URL');
        setIsLoadingMp3(true);
        try {
            const res = await fetch('/api/download', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url }), // Uses 'url' state
            });
            // ... (rest of the function remains the same) ...
             if (!res.ok) {
                const errorBody = await res.json().catch(() => ({ error: 'Unknown server error' }));
                console.error("Server error response:", errorBody);
                throw new Error(errorBody.error || res.statusText);
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
             setIsLoadingMp3(false);
        }
      };

      // Playlist download as ZIP
      const downloadPlaylistZip = async () => {
        if (!playlistUrl) return alert('Enter playlist URL for Zip download'); // Clarify which URL
        setIsLoadingZip(true);
        try {
            const res = await fetch('/api/download-playlist', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ playlistUrl }), // Uses 'playlistUrl' state
            });
            // ... (rest of the function remains the same) ...
             if (!res.ok) {
                 const errorBody = await res.json().catch(() => ({ error: 'Unknown server error' }));
                 console.error("Server error response (playlist zip):", errorBody);
                 throw new Error(errorBody.error || res.statusText);
            }
            const filename = getFilenameFromHeaders(res.headers) || 'playlist.zip';
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
            setIsLoadingZip(false);
        }
      };

      // Playlist download as single combined VIDEO
      const downloadCombinedVideo = async () => {
        // *** Use the NEW state variable ***
        if (!combineVideoUrl) return alert('Enter playlist URL for Single Video download'); // Clarify which URL
        alert('Combining videos can take a long time, especially for long playlists. Please be patient.');
        setIsLoadingVideo(true);
        try {
            const res = await fetch('/api/convert', { // Your endpoint name
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              // *** Send the NEW state variable ***
              body: JSON.stringify({ playlistUrl: combineVideoUrl }), // Send the correct URL
            });
            // ... (rest of the function remains the same) ...
             if (!res.ok) {
                 const errorBody = await res.json().catch(() => ({ error: 'Unknown server error' }));
                 console.error("Server error response (combine video):", errorBody);
                 throw new Error(errorBody.error || res.statusText);
            }
            const filename = getFilenameFromHeaders(res.headers) || 'combined_video.mp4';
            const blob = await res.blob();
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
            setIsLoadingVideo(false);
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
                disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo}
            />
            <Button
                variant='contained'
                color='primary'
                fullWidth
                onClick={downloadMP3}
                disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo}
            >
                {isLoadingMp3 ? 'Downloading MP3...' : 'Download MP3'}
            </Button>
            <Divider style={{margin:"40px 0"}}/>

             {/* Playlist Section (ZIP) */}
            <Typography variant='h6' gutterBottom>
                Download Playlist as Zip
            </Typography>
            <TextField
                label="YouTube Playlist URL (for Zip)" // Clarify label
                variant='outlined'
                fullWidth
                value={playlistUrl} // Uses playlistUrl state
                onChange={(e)=> setPlaylistUrl(e.target.value)} // Sets playlistUrl state
                style={{marginBottom: 16}}
                disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo}
            />
            <Button
                variant='contained'
                color='secondary'
                onClick={downloadPlaylistZip}
                fullWidth
                style={{marginBottom: 16}}
                disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo}
            >
                 {isLoadingZip ? 'Downloading Zip...' : 'Download Playlist As Zip'}
            </Button>
            <Divider style={{margin:"40px 0"}}/>

            {/* --- Playlist Section (Combined Video) --- */}
            <Typography variant='h6' gutterBottom>
                Convert Playlist to Single Video {/* Updated Title */}
            </Typography>
            <TextField
                label="YouTube Playlist URL (for Single Video)" // Clarify label
                variant='outlined'
                fullWidth
                // *** Bind to the NEW state variable ***
                value={combineVideoUrl}
                onChange={(e)=> setCombineVideoUrl(e.target.value)} // Set the NEW state
                style={{marginBottom: 16}}
                disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo}
            />
            <Button
                variant='contained'
                color='warning'
                onClick={downloadCombinedVideo}
                fullWidth
                style={{marginBottom: 16}}
                disabled={isLoadingMp3 || isLoadingZip || isLoadingVideo}
            >
                 {isLoadingVideo ? 'Combining Video...' : 'Download Playlist As Single Video'}
            </Button>

        </Container>
    );
};

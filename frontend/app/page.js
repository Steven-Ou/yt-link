'use client';
import { useState } from 'react';
import { Button, Divider, TextField, Typography } from '@mui/material';
import { Container } from '@mui/system';

// Helper function to parse Content-Disposition header
function getFilenameFromHeaders(headers) {
    const disposition = headers.get('Content-Disposition');
    // Default filename if parsing fails
    let filename = 'downloaded_audio.mp3';

    if (disposition) {
        console.log("Parsing Content-Disposition:", disposition);
        // Try to match filename*=UTF-8''my%20filename.mp3 (RFC 5987)
        // This regex looks for filename*=UTF-8'' followed by encoded characters
        const utf8FilenameRegex = /filename\*=UTF-8''([\w%.-]+)(?:; ?|$)/i;
        const utf8Match = disposition.match(utf8FilenameRegex);
        if (utf8Match && utf8Match[1]) {
            try {
                // Decode the URI-encoded filename
                filename = decodeURIComponent(utf8Match[1]);
                console.log(`Successfully parsed filename* (decoded): ${filename}`);
                return filename; // Prioritize filename* if found and decoded
            } catch (e) {
                console.error("Error decoding filename*:", e);
                // If decoding fails, fall through to try the simple filename
            }
        }

        // Fallback: Try to match the simpler filename="my filename.mp3"
        // This regex looks for filename= followed by a quoted or unquoted string
        const asciiFilenameRegex = /filename=(?:(")([^"]*)\1|([^;\n]*))/i;
        const asciiMatch = disposition.match(asciiFilenameRegex);
        // Use group 2 if quoted, otherwise use group 3 if unquoted
        if (asciiMatch && (asciiMatch[2] || asciiMatch[3])) {
            filename = asciiMatch[2] || asciiMatch[3];
            console.log(`Parsed simple filename= parameter: ${filename}`);
            // No decoding needed for this simple format (usually ASCII)
            return filename;
        }
    }
    // If no filename parameter is found or parsed correctly
    console.log(`Could not parse filename from headers, using default: ${filename}`);
    return filename;
}


export default function Home() {
    //States variables
    const [url, setUrl] = useState('');
    const [playlistUrl, setPlaylistUrl] = useState('');

    // Single video
    const downloadMP3 = async () => {
        if (!url) return alert('Enter video URL');
        try {
            const res = await fetch('/api/download', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url }),
            });

            if (!res.ok) {
                const errorBody = await res.json().catch(() => ({ error: 'Unknown server error' }));
                console.error("Server error response:", errorBody);
                return alert('Error downloading: ' + (errorBody.error || res.statusText));
            }

            // Use the helper function to get the best possible filename
            const filename = getFilenameFromHeaders(res.headers);

            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            // Set the correctly parsed filename for the download attribute
            a.download = filename;
            document.body.appendChild(a); // Append link to body (needed for Firefox)
            a.click();
            document.body.removeChild(a); // Clean up link
            URL.revokeObjectURL(a.href); // Clean up blob URL

        } catch (error) {
            console.error("Client-side download error:", error);
            alert('An error occurred during the download process.');
        }
      };

      // Playlist download - assumes server sends simple zip name
      const downloadPlaylist = async () => {
        if (!playlistUrl) return alert('Enter playlist URL');
        try { // Add try...catch
            const res = await fetch('/api/download-playlist', { // Assuming this endpoint sends a zip
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ playlistUrl }),
            });

            if (!res.ok) {
                 const errorBody = await res.json().catch(() => ({ error: 'Unknown server error' }));
                 console.error("Server error response (playlist):", errorBody);
                 return alert('Error downloading playlist: ' + (errorBody.error || res.statusText));
            }

            // For playlists, we might expect a simpler zip name from the server
            // Or use the same parsing function if that endpoint also sends complex names
            const playlistFilename = getFilenameFromHeaders(res.headers); // Reuse parser, adjust default if needed

            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            // Use the parsed name, or maybe a default like 'playlist.zip' if preferred
            a.download = playlistFilename || 'playlist.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);

        } catch (error) {
             console.error("Client-side playlist download error:", error);
             alert('An error occurred during the playlist download process.');
        }
      };

    return(
        <Container maxWidth="sm" style={{marginTop: 80}}>
            <Typography variant='h4' gutterBottom align='center'>
                🎧 YouTube to MP3 Converter
            </Typography>

            <Typography variant='h6' gutterBottom>
                Convert a Single Video
            </Typography>
            <TextField
                label="YouTube Video URL"
                variant='outlined'
                fullWidth
                value={url}
                onChange={(e)=> setUrl(e.target.value)}
                style={{marginBottom: 16}}
            />
            <Button
                variant='contained'
                color='primary'
                fullWidth
                onClick={downloadMP3}
            >
                Download MP3
            </Button>
            <Divider style={{margin:"40px 0"}}/>

            <Typography variant='h6' gutterBottom>
                Convert a Full Playlist (Album)
            </Typography>
            <TextField
                label="YouTube Playlist URL"
                variant='outlined'
                fullWidth
                value={playlistUrl}
                onChange={(e)=> setPlaylistUrl(e.target.value)}
                style={{marginBottom: 16}}
            />
            <Button
                variant='contained'
                color='secondary'
                onClick={downloadPlaylist}
                fullWidth
                style={{marginBottom: 16}}
            >
                Download Playlist As Zip
            </Button>
             {/* Consider adding a button for the combined MP3 playlist endpoint if you have it */}
             {/* <Button variant='contained' color='secondary' onClick={downloadCombinedPlaylist} fullWidth>
                 Download Playlist As Single MP3
             </Button> */}
        </Container>
    );
};

'use client';
import { useState } from 'react';
import { Button, Divider, TextField, Typography } from '@mui/material';
import { Container } from '@mui/system';


export default function Home() {
    //States variables
  const [url, setUrl] = useState('');             
  const [playlistUrl, setPlaylistUrl] = useState('');

    // Single video
    const downloadMP3 = async () => {
        if (!url) return alert('Enter video URL');
        try { // Add try...catch for better error handling
            const res = await fetch('/api/download', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url }),
            });

            if (!res.ok) {
                // Try to get error message from server response
                const errorBody = await res.json().catch(() => ({ error: 'Unknown server error' }));
                console.error("Server error response:", errorBody);
                return alert('Error downloading: ' + (errorBody.error || res.statusText));
            }

            // Get filename from Content-Disposition header if possible (more robust)
            const disposition = res.headers.get('Content-Disposition');
            let filename = 'downloaded_audio.mp3'; // Default filename
            if (disposition && disposition.indexOf('attachment') !== -1) {
                const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
                const matches = filenameRegex.exec(disposition);
                if (matches != null && matches[1]) {
                  filename = matches[1].replace(/['"]/g, '');
                  console.log(`Filename from header: ${filename}`);
                }
            }

            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            // Use the determined filename (or default) with the correct .mp3 extension
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
    
      const downloadPlaylist = async () => {
        if (!playlistUrl) return alert('Enter playlist URL');
        const res = await fetch('/api/download-playlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playlistUrl }),
        });
        if (!res.ok) return alert('Error: ' + (await res.text()));
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'playlist.zip';
        a.click();
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
                Download Playlist
            </Button>
        </Container>
    );
};


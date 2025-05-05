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
        const res = await fetch('app/api/download/route.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        if (!res.ok) return alert('Error: ' + (await res.text()));
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'audio.zip';
        a.click();
      };
    
      const downloadPlaylist = async () => {
        if (!playlistUrl) return alert('Enter playlist URL');
        const res = await fetch('app/api/download-playlist/route.js', {
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


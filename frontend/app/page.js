"use client";
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
        try {
          const res = await fetch('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
          });
          if (!res.ok) throw new Error('Network response was not ok');
          const blob = await res.blob();
          const href = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = href;
          a.download = 'audio.zip';
          a.click();
        } catch (err) {
          console.error(err);
          alert('Download failed');
        }
    };
    
    const downloadPlaylist = async () => {
        if (!playlistUrl) return alert('Enter playlist URL');
        try {
          const res = await fetch('/api/download-playlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playlistUrl })
          });
          if (!res.ok) throw new Error('Network response was not ok');
          const blob = await res.blob();
          const href = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = href;
          a.download = 'playlist.zip';
          a.click();
        } catch (err) {
          console.error(err);
          alert('Download failed');
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
                Download Playlist
            </Button>
        </Container>
    );
};


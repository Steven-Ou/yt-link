"use client";
import { Button, Divider, TextField, Typography } from '@mui/material';
import { Container } from '@mui/system';


export default function Home() {
    // Single video
    await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: videoUrl }),
    });
  
    // Playlist
    await fetch('/api/download-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistUrl }),
    });   
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
}


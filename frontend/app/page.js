"use client";
import { Button, Divider, TextField, Typography } from '@mui/material';
import { Container } from '@mui/system';
import {use, useState} from 'react';

export default function Home() {
    const [url, setUrl] = useState(""); //State to store the URL
    const [playlistUrl, setPlaylistUrl] = useState(""); //State to store the playlist URL

    const downloadMP3 = () => {
        if (!url) return alert("Enter video URL");
            window.location.href = `http://localhost:5000/download?url=${encodeURIComponent(url)}`;
    };
    const downloadPlaylist = () => {
        if (!playlistUrl) return alert("Enter playlist URL");
        window.location.href = `http://localhost:5000/download-playlist?url=${encodeURIComponent(playlistUrl)}`;
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
        </Container>
    );
}

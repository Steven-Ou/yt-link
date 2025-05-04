"use client";
import { Button, TextField, Typography } from '@mui/material';
import { Container } from '@mui/system';
import {use, useState} from 'react';

export default function Home() {
    const [url, setUrl] = useState(""); //State to store the URL
    const [playlistUrl, setPlaylistUrl] = useState(""); //State to store the playlist URL

    const downloadMP3 = () => {
        if (!url) return alert("Enter video URL");
            window.location.href = `http://localhost:5000/download?url=${encodeURIComponent(url)}`;
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
                disabled={loading}
            >
                Download MP3
            </Button>
        </Container>
    );
}

"use client";
import { Button, Divider, TextField, Typography } from '@mui/material';
import { Container } from '@mui/system';
import {use, useState} from 'react';

export default function Home() {
    const [url, setUrl] = useState(""); //State to store the URL
    const [playlistUrl, setPlaylistUrl] = useState(""); //State to store the playlist URL

    const downloadMP3 = async () => {
        if (!url) return alert("Enter video URL");
        try {
            const response = await fetch('http://localhost:5000/download', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ url }),
            });
    
            if (!response.ok) throw new Error("Failed to start download");
            const blob = await response.blob();
            const href = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = href;
            a.download = "audio.zip"; // or get filename from response headers
            a.click();
        
        } catch (err) {
            console.error("Error:", err);
            alert("An error occurred while downloading");
        }
    };
    const downloadPlaylist = async () => {
        if (!playlistUrl) return alert("Enter playlist URL");

    try {
        const response = await fetch('http://localhost:5000/download-playlist', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ playlistUrl }),
        });

        if (response.ok) {
            // Handle the successful response
            alert("Playlist download started...");
        } else {
            alert("Failed to download Playlist");
        }
    } catch (error) {
        console.error("Error:", error);
        alert("An error occurred while downloading");
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
}


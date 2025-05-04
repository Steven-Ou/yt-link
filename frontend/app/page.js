"use client";
import { Button, TextField, Typography } from '@mui/material';
import { Container } from '@mui/system';
import {use, useState} from 'react';

export default function Home() {
    const [url, setUrl] = useState(''); //storing the URL
    const [loading, setLoading] = useState(false); //checks if the app is in the process of fetching
    const [error, setError] = useState(''); //Stores error messsage and update the error state. 

    const handleSubmit = async (e) => {
        e.preventDefault();
        if(!url) {
            setError('Please enter a URL'); //if the URL is empty, show error message
            return;
        }
        setLoading(true); //Set loading state to true
        setError(''); //Reset error state
        
        try{ // fetching data from the backend
            const response = await fetch('http://localhost:5000/download', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({url}),
            });
            if(!response.ok) {
                throw new Error('Failed to download audio'); //if the response is not ok, show error message
            }
            const blob = await response.blob(); //Convert the response to a blob
            const downloadUrl = URL.createObjectURL(blob); //Create a download URL for the blob
            const a = document.createElement('a'); //Create an anchor element
            a.href = downloadUrl; //Set the href to the download URL
            a.download = 'audio.mp3'; //Set the download attribute to the desired file name
            a.click(); //Programmatically click the anchor element to trigger the download
        }catch (error) {
            setError(error.message); //If an error occurs, set the error state
        } finally {
            setLoading(false); //Set loading state to false
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
                disabled={loading}
            >

            </Button>
        </Container>
    );
}

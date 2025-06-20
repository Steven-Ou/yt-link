// Save this file at: frontend/app/components/UpdateStatus.js

'use client'; // This is a Client Component because it uses hooks and browser APIs

import { useState, useEffect } from 'react';
import { LinearProgress, Typography, Box, Slide } from '@mui/material'; // Using MUI for a nice look

export default function UpdateStatus() {
  const [statusMessage, setStatusMessage] = useState('');
  const [progress, setProgress] = useState(0);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    // This code only runs in the Electron environment where `window.electronAPI` is exposed
    if (window.electronAPI && typeof window.electronAPI.onUpdateStatus === 'function') {
      
      // Listener for general status messages
      const removeStatusListener = window.electronAPI.onUpdateStatus((message) => {
        console.log('Update Status from Main:', message);
        setStatusMessage(message);
        setShowBanner(true);
        setProgress(0); // Reset progress for new status messages
        // Hide the banner after a few seconds if it's not a progress message
        if (!message.toLowerCase().includes('downloading')) {
            setTimeout(() => {
                setShowBanner(false);
            }, 6000); // Hide after 6 seconds
        }
      });

      // Listener for download progress
      const removeProgressListener = window.electronAPI.onUpdateDownloadProgress((progressInfo) => {
        console.log('Update Progress from Main:', progressInfo);
        setProgress(progressInfo.percent);
        setStatusMessage(`Downloading update: ${Math.round(progressInfo.percent)}%`);
        setShowBanner(true); // Ensure banner is visible during download
      });

      // The 'return' function is a cleanup function that React runs when the component unmounts.
      return () => {
        // This removes the listeners to prevent memory leaks if the component ever unmounts.
        removeStatusListener();
        removeProgressListener();
      };
    }
  }, []); // The empty dependency array means this useEffect runs only once.

  return (
    <Slide direction="up" in={showBanner} mountOnEnter unmountOnExit>
      <Box
        sx={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: 'secondary.main', // Using your theme's secondary color
          color: 'primary.contrastText',
          padding: '12px 24px',
          zIndex: 1500, // Ensure it's above other content
          boxShadow: '0 -2px 10px rgba(0,0,0,0.2)'
        }}
      >
        <Typography variant="body1">{statusMessage}</Typography>
        {progress > 0 && progress < 100 && (
          <LinearProgress
            variant="determinate"
            value={progress}
            sx={{
              marginTop: '8px',
              height: '8px',
              borderRadius: '4px'
            }}
          />
        )}
      </Box>
    </Slide>
  );
}
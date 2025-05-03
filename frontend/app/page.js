import {useState} from 'react';

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
        }
        if(!response.ok) {
            throw new Error('Failed to download audio'); //if the response is not ok, show error message
        }
        const blob = await response.blob(); //Convert the response to a blob
        const downloadUrl = URL.createObjectURL(blob); //Create a download URL for the blob
        const a = document.createElement('a'); //Create an anchor element
        a.href = downloadUrl; //Set the href to the download URL
    }
}

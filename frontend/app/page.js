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
        
    }
}

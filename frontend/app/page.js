import {useState} from 'react';

export default function Home() {
    const [url, setUrl] = useState(''); //storing the URL
    const [loading, setLoading] = useState(false); //checks if the app is in the process of fetching
    const [error, setError] = useState(''); //Stores error messsage and update the error state. 

    const
}

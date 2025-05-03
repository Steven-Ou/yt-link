import {useState} from 'react';

export default function Home() {
    const [url, setUrl] = useState('');
    const download = () => {
        if(!url){
            alert('Please enter a URL');
            return;
        }
    }
    const link = document.createElement('a');
    link.href =`http://localhost:5000/download?url=${encodeURIComponent(url)}}`;

}

import {useState} from 'react';

export default function Home() {
    const [url, setUrl] = useState('');
    const download = () => {
        if(!url){
            alert('Please enter a URL');
            return;
        }
}

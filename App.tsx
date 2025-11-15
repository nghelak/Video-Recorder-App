import React, { useState, useRef, useEffect, useCallback } from 'react';
import { TimedChunk } from './types';
import { RecordIcon, StopIcon, PlayIcon, PauseIcon, DownloadIcon, ClearIcon } from './components/Icons';

// FIX: Cast window to any to access vendor-prefixed SpeechRecognition API and rename to avoid type conflict.
// Helper to get the prefixed SpeechRecognition object
const SpeechRecognitionApi = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

const App: React.FC = () => {
    const [isRecording, setIsRecording] = useState<boolean>(false);
    const [isPlaying, setIsPlaying] = useState<boolean>(false);
    const [statusMessage, setStatusMessage] = useState<string>("Click 'Start Recording' to begin.");
    const [timedChunks, setTimedChunks] = useState<TimedChunk[]>([]);
    const [interimTranscript, setInterimTranscript] = useState<string>('');
    const [wordCount, setWordCount] = useState<number>(0);
    const [mediaBlobUrl, setMediaBlobUrl] = useState<string | null>(null);
    const [currentChunkId, setCurrentChunkId] = useState<string | null>(null);
    
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    // FIX: The SpeechRecognition type is now correctly resolved because the constant of the same name was renamed.
    const speechRecognitionRef = useRef<SpeechRecognition | null>(null);
    const mediaChunksRef = useRef<Blob[]>([]);
    const currentStreamRef = useRef<MediaStream | null>(null);
    const recordingStartTimeRef = useRef<number>(0);
    const lastFinalTimeRef = useRef<number>(0);
    const chunkIndexRef = useRef<number>(0);
    const mediaBlobRef = useRef<Blob | null>(null);

    const videoPreviewRef = useRef<HTMLVideoElement>(null);
    const videoPlaybackRef = useRef<HTMLVideoElement>(null);

    const isSupported = SpeechRecognitionApi && navigator.mediaDevices?.getUserMedia;

    useEffect(() => {
        if (!isSupported) {
            setStatusMessage('Sorry, your browser does not support the required APIs. Please try Chrome or Firefox.');
            return;
        }

        speechRecognitionRef.current = new SpeechRecognitionApi();
        const recognition = speechRecognitionRef.current;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    const chunkEndTime = (performance.now() - recordingStartTimeRef.current) / 1000.0;
                    const chunkStartTime = lastFinalTimeRef.current;
                    
                    const newChunk: TimedChunk = {
                        text: transcript,
                        startTime: chunkStartTime,
                        endTime: chunkEndTime,
                        id: `chunk-${chunkIndexRef.current}`,
                    };
                    
                    setTimedChunks(prev => [...prev, newChunk]);
                    setWordCount(prev => prev + transcript.trim().split(/\s+/).filter(Boolean).length);

                    lastFinalTimeRef.current = chunkEndTime;
                    chunkIndexRef.current++;
                } else {
                    interim += transcript;
                }
            }
            setInterimTranscript(interim);
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            setStatusMessage(`Speech error: ${event.error}`);
        };

    }, [isSupported]);
    
    const setupMediaRecorder = (stream: MediaStream) => {
        const recorder = new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                mediaChunksRef.current.push(event.data);
            }
        };

        recorder.onstop = () => {
            const blobType = mediaRecorderRef.current?.mimeType || 'video/webm';
            const mediaBlob = new Blob(mediaChunksRef.current, { type: blobType });
            mediaBlobRef.current = mediaBlob;
            const url = URL.createObjectURL(mediaBlob);
            setMediaBlobUrl(url);

            mediaChunksRef.current = [];
            currentStreamRef.current?.getTracks().forEach(track => track.stop());
            currentStreamRef.current = null;

            if (videoPreviewRef.current) {
                videoPreviewRef.current.srcObject = null;
            }

            setStatusMessage('Recording stopped. Ready to play or re-record.');
        };
        
        recorder.onerror = (event) => {
            console.error('MediaRecorder error:', event);
            setStatusMessage('Recording error.');
        };
    };


    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
            currentStreamRef.current = stream;
            
            handleClear(true);
            setIsRecording(true);
            setStatusMessage('Recording... Speak now.');
            
            if (videoPreviewRef.current) {
                videoPreviewRef.current.srcObject = stream;
            }

            recordingStartTimeRef.current = performance.now();
            setupMediaRecorder(stream);
            mediaRecorderRef.current?.start();
            speechRecognitionRef.current?.start();

        } catch (err: any) {
            console.error('Error starting recording:', err);
            if (err.name === "NotAllowedError" || err.name === "SecurityError") {
                setStatusMessage('Camera/Mic access denied. Please allow it in your browser settings.');
            } else if (err.name === "NotFoundError") {
                setStatusMessage('No camera or microphone found.');
            } else {
                setStatusMessage('Error: Could not access microphone or camera.');
            }
        }
    };

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
            mediaRecorderRef.current.stop();
        }
        speechRecognitionRef.current?.stop();
        setIsRecording(false);
        setInterimTranscript('');
        setStatusMessage('Processing recording...');
    }, []);

    const handleRecordClick = () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    };
    
    const handlePlayClick = () => {
        if (!videoPlaybackRef.current) return;
        if (isPlaying) {
            videoPlaybackRef.current.pause();
        } else {
            videoPlaybackRef.current.play();
        }
        setIsPlaying(!isPlaying);
    };

    const handleClear = (isRestarting = false) => {
        if(isRecording) stopRecording();
        if(isPlaying) {
            if (videoPlaybackRef.current) {
                videoPlaybackRef.current.pause();
                videoPlaybackRef.current.currentTime = 0;
            }
            setIsPlaying(false);
        }

        setTimedChunks([]);
        setInterimTranscript('');
        setWordCount(0);
        if(mediaBlobUrl) {
           URL.revokeObjectURL(mediaBlobUrl);
           setMediaBlobUrl(null);
        }
        mediaBlobRef.current = null;
        lastFinalTimeRef.current = 0;
        chunkIndexRef.current = 0;

        if (!isRestarting) {
           setStatusMessage("Click 'Start Recording' to begin.");
        }
    };
    
    const handleChunkClick = (startTime: number) => {
        if (videoPlaybackRef.current) {
            videoPlaybackRef.current.currentTime = startTime;
            if(!isPlaying) {
              videoPlaybackRef.current.play();
              setIsPlaying(true);
            }
        }
    };

    const handleTimeUpdate = () => {
        if (!videoPlaybackRef.current) return;
        const currentTime = videoPlaybackRef.current.currentTime;
        
        const currentChunk = timedChunks.find(chunk => currentTime >= chunk.startTime && currentTime < chunk.endTime);
        
        if (currentChunk) {
            setCurrentChunkId(currentChunk.id);
        }
    };

    const formatTimeVTT = (timeInSeconds: number) => {
        const hours = Math.floor(timeInSeconds / 3600);
        const minutes = Math.floor((timeInSeconds % 3600) / 60);
        const seconds = Math.floor(timeInSeconds % 60);
        const milliseconds = Math.floor((timeInSeconds - Math.floor(timeInSeconds)) * 1000);

        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
    };

    const generateVttContent = () => {
        let vttContent = "WEBVTT\n\n";
        timedChunks.forEach((chunk, index) => {
            const startTime = formatTimeVTT(chunk.startTime);
            const endTime = formatTimeVTT(chunk.endTime);
            vttContent += `${index + 1}\n`;
            vttContent += `${startTime} --> ${endTime}\n`;
            vttContent += `${chunk.text.trim()}\n\n`;
        });
        return vttContent;
    };

    const downloadFile = (blob: Blob, fileName: string) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 100);
    };

    const handleDownload = () => {
        if (!mediaBlobRef.current) {
            alert('No recording found to download.');
            return;
        }
        
        const fileExtension = (mediaBlobRef.current.type.includes('mp4')) ? 'mp4' : 'webm';
        downloadFile(mediaBlobRef.current, `recording.${fileExtension}`);

        const vttContent = generateVttContent();
        const vttBlob = new Blob([vttContent], { type: 'text/vtt' });
        downloadFile(vttBlob, 'recording.vtt');
    };
    
    if (!isSupported) {
         return (
             <div className="bg-gray-100 text-gray-900 flex items-center justify-center min-h-screen">
                 <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-lg mx-auto text-center">
                     <h1 className="text-2xl font-bold text-red-600 mb-4">Browser Not Supported</h1>
                     <p className="text-gray-700">{statusMessage}</p>
                 </div>
             </div>
         );
    }

    return (
        <div className="flex items-center justify-center min-h-screen text-gray-900">
            <div className="bg-transparent p-4 sm:p-8 rounded-xl w-full max-w-2xl mx-auto">
                <h1 className="text-3xl font-bold text-center text-gray-900 mb-2">
                    Video Recorder & Transcriber
                </h1>
                <p className="text-center text-gray-600 mb-6">Press "Record" to capture video, audio, and text simultaneously.</p>

                <div className="w-full bg-black rounded-lg aspect-video flex items-center justify-center text-gray-500 mb-4 shadow-sm relative">
                    {!isRecording && !mediaBlobUrl && <span>Video preview will appear here</span>}
                    <video ref={videoPreviewRef} className={`w-full h-full rounded-lg ${!isRecording ? 'hidden' : ''}`} autoPlay muted playsinline></video>
                    <video ref={videoPlaybackRef} className={`w-full h-full rounded-lg ${mediaBlobUrl ? '' : 'hidden'}`} controls playsinline src={mediaBlobUrl || ''} onTimeUpdate={handleTimeUpdate} onPlay={()=>setIsPlaying(true)} onPause={()=>setIsPlaying(false)} onEnded={()=>setIsPlaying(false)}></video>
                </div>

                <div className="mb-2">
                    <div className="w-full h-48 bg-white border border-gray-300 shadow-sm rounded-lg p-4 overflow-y-auto resize-none leading-relaxed" >
                        {timedChunks.map(chunk => (
                            <span key={chunk.id} id={chunk.id} onClick={() => handleChunkClick(chunk.startTime)} className={`transcript-chunk ${currentChunkId === chunk.id ? 'highlighted-chunk' : 'text-gray-600'}`}>
                                {chunk.text}
                            </span>
                        ))}
                         <span className="text-gray-400">{interimTranscript}</span>
                    </div>
                </div>
                
                <div className="text-right text-gray-600 text-sm mb-4 pr-1">Word Count: {wordCount}</div>

                <div className="flex flex-row flex-wrap justify-center gap-4">
                    <button onClick={handleRecordClick} className={`flex items-center justify-center gap-3 w-full sm:w-auto text-white py-3 px-6 rounded-lg font-semibold text-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-opacity-50 ${isRecording ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500' : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'}`}>
                        {isRecording ? <><StopIcon /><span className="recording-dot">Stop Recording</span></> : <><RecordIcon /><span>Start Recording</span></>}
                    </button>
                    <button onClick={handlePlayClick} disabled={!mediaBlobUrl} className="flex items-center justify-center gap-3 w-full sm:w-auto bg-gray-200 text-gray-800 py-3 px-6 rounded-lg font-semibold text-lg transition-all duration-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed">
                        {isPlaying ? <PauseIcon /> : <PlayIcon />}
                        <span>{isPlaying ? 'Pause' : 'Play'}</span>
                    </button>
                    <button onClick={handleDownload} disabled={!mediaBlobUrl} className="flex items-center justify-center gap-3 w-full sm:w-auto bg-gray-200 text-gray-800 py-3 px-6 rounded-lg font-semibold text-lg transition-all duration-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed">
                        <DownloadIcon />
                        <span>Download</span>
                    </button>
                    <button onClick={() => handleClear(false)} className="flex items-center justify-center gap-3 w-full sm:w-auto bg-gray-200 text-gray-800 py-3 px-6 rounded-lg font-semibold text-lg transition-all duration-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-opacity-50">
                        <ClearIcon />
                        <span>Clear</span>
                    </button>
                </div>

                <div className="text-center mt-5 text-gray-600 h-6">
                    {statusMessage}
                </div>
            </div>
        </div>
    );
};

export default App;

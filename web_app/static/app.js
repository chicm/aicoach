let mediaRecorder;
let audioChunks = [];

// Fetch the current chat mode on page load
$(document).ready(function() {
    fetch('/api/config/chat-modes', {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => response.json())
    .then(data => {
        $('#chatModeSelector').val(data.chat_mode);
        const history = data.chat_history
            .filter(entry => entry.role !== 'system')
            .map(entry => {
                return `${entry.role === 'user' ? '你' : 'AI'}: ${entry.content}`;
            }).join('\n');
        $('#history').val(history);
    })
    .catch(error => {
        console.error('Error fetching chat mode:', error);
    });

    // Update chat mode when dropdown changes
    $('#chatModeSelector').change(function() {
        const selectedMode = $(this).val();
        fetch('/api/config/chat-modes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ chat_mode: selectedMode })
        })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                const history = data.chat_history
                    .filter(entry => entry.role !== 'system')
                    .map(entry => {
                        return `${entry.role === 'user' ? '你' : 'AI'}: ${entry.content}`;
                    }).join('\n');
                $('#history').val(history);
            } else {
                console.error('Error updating chat mode:', data.message);
            }
        })
        .catch(error => {
            console.error('Error updating chat mode:', error);
        });
    });

    // Initialize recording event handlers for both click and touch
    const recordButton = $('#recordButton');
    const stopButton = $('#stopButton');

    // Handle both click and touch events
    recordButton.on('click touchend', function(e) {
        e.preventDefault(); // Prevent double-firing on mobile devices
        startRecording();
    });

    stopButton.on('click touchend', function(e) {
        e.preventDefault(); // Prevent double-firing on mobile devices
        stopRecording();
    });
});

function processTranscription(transcription) {
    console.log('Transcription received:', transcription);
    const history = document.getElementById('history');
    history.value += '你: ' + transcription + '\n';
    history.scrollTop = history.scrollHeight;

    if (transcription && transcription.trim() !== '') {
        generateResponse(transcription);
    } else {
        console.error('No transcription received');
        alert('Transcription failed. Please try recording again.');
    }
}

async function generateResponse(transcription) {
    console.log('Sending generate request with transcription:', transcription);
    const selectedModel = document.getElementById('modelSelector').value;
    const history = document.getElementById('history');
    let fullResponse = '';
    
    // Get the current history content and add AI: prefix
    const currentHistory = history.value;
    history.value = currentHistory + 'AI: ';
    
    try {
        const response = await fetch('/api/ai/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: transcription,
                model: selectedModel
            })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const {done, value} = await reader.read();
            
            if (done) {
                break;
            }

            const chunk = decoder.decode(value, {stream: true});
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.content) {
                            fullResponse += data.content;
                            history.value = currentHistory + 'AI: ' + fullResponse;
                            history.scrollTop = history.scrollHeight;
                        }
                    } catch (e) {
                        console.error('Error parsing SSE data:', e);
                    }
                }
            }
        }

        // After stream completes, add newline
        history.value += '\n';
        
        // Generate audio
        if (fullResponse) {
            const audioResponse = await fetch('/api/audio/synthesis', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ text: fullResponse })
            });
            
            const audioData = await audioResponse.json();
            if (audioData.audio_url) {
                const audioElement = document.getElementById('speechOutput');
                audioElement.src = audioData.audio_url;
                audioElement.play();
            }
        }
    } catch (error) {
        console.error('Error generating response:', error);
        alert('Failed to generate response. Please try again.');
    }
}

async function startRecording() {
    try {
        // Check if mediaDevices is supported
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Your browser does not support audio recording');
        }

        // Request audio permission with constraints suitable for speech
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 44100
            }
        });

        // Create MediaRecorder with specific MIME type for better compatibility
        const mimeType = MediaRecorder.isTypeSupported('audio/webm') 
            ? 'audio/webm' 
            : 'audio/mp4';

        mediaRecorder = new MediaRecorder(stream, {
            mimeType: mimeType,
            audioBitsPerSecond: 128000
        });

        mediaRecorder.ondataavailable = event => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        // Handle recording errors
        mediaRecorder.onerror = (event) => {
            console.error('MediaRecorder error:', event.error);
            stopRecording();
            alert('Recording error occurred. Please try again.');
        };

        mediaRecorder.onstop = async () => {
            try {
                const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                const formData = new FormData();
                formData.append('audio', audioBlob, 'recording.wav');

                const response = await fetch('/api/audio/transcriptions', {
                    method: 'POST',
                    body: formData
                });
                
                const data = await response.json();
                processTranscription(data.transcription);
            } catch (error) {
                console.error('Error transcribing audio:', error);
                alert('Error processing recording. Please try again.');
            } finally {
                // Clean up
                audioChunks = [];
                if (mediaRecorder.stream) {
                    mediaRecorder.stream.getTracks().forEach(track => track.stop());
                }
                $('#recordButton').show().focus();
                $('#stopButton').hide();
            }
        };

        // Start recording
        mediaRecorder.start();
        $('#recordButton').hide();
        $('#stopButton').show().focus();
    } catch (error) {
        console.error('Error starting recording:', error);
        alert('Failed to start recording: ' + error.message);
        $('#recordButton').show().focus();
        $('#stopButton').hide();
    }
}

function stopRecording() {
    try {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
    } catch (error) {
        console.error('Error stopping recording:', error);
        alert('Error stopping recording. Please refresh the page and try again.');
        // Ensure UI is reset
        $('#recordButton').show().focus();
        $('#stopButton').hide();
    }
}
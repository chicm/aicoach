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
});

async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = event => {
        audioChunks.push(event.data);
    };

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

    function generateResponse(transcription) {
        console.log('Sending generate request with transcription:', transcription);
        const selectedModel = document.getElementById('modelSelector').value;
        fetch('/api/ai/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: transcription,
                model: selectedModel
            })
        })
        .then(response => response.json())
        .then(generateData => {
            const history = document.getElementById('history');
            history.value += 'AI: ' + generateData.response + '\n';
            history.scrollTop = history.scrollHeight;

            const responseText = generateData.response;
            if (responseText) {
                fetch('/api/audio/synthesis', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ text: responseText })
                })
                .then(response => response.json())
                .then(convertData => {
                    if (convertData.audio_url) {
                        const audioElement = document.getElementById('speechOutput');
                        audioElement.src = convertData.audio_url;
                        audioElement.play();
                    }
                })
                .catch(error => {
                    console.error('Error converting text to speech:', error);
                });
            }
        })
        .catch(error => {
            console.error('Error generating response:', error);
            alert('Failed to generate response. Please try again.');
        });
    }

    mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.wav');

        fetch('/api/audio/transcriptions', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            processTranscription(data.transcription);
        })
        .catch(error => {
            console.error('Error transcribing audio:', error);
        });

        audioChunks = [];
        $('#recordButton').show().focus();
        $('#stopButton').hide();
    };

    mediaRecorder.start();
    $('#recordButton').hide();
    $('#stopButton').show().focus();
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
}

// Initialize event handlers
$(document).ready(function() {
    $('#recordButton').click(startRecording);
    $('#stopButton').click(stopRecording);
});
let mediaRecorder;
let audioChunks = [];
let currentChatId = null;

// Device ID management
function getDeviceId() {
    let deviceId = localStorage.getItem('deviceId');
    if (!deviceId) {
        deviceId = 'device_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('deviceId', deviceId);
    }
    return deviceId;
}

// Hint management
function showHint(message, duration = 3000) {
    const $hint = $('#hint');
    $hint.text(message).addClass('show');
    
    setTimeout(() => {
        $hint.removeClass('show');
    }, duration);
}

// Chat History Modal Functionality
function initializeChatHistoryModal() {
    const $chatHistoryButton = $('#chatHistoryButton');
    const $chatHistoryModal = $('#chatHistoryModal');
    const $closeButton = $chatHistoryModal.find('.close-button');
    const $chatList = $('#chatList');

    async function loadChatList() {
        try {
            const response = await fetch('/api/chats', {
                headers: {
                    'X-Device-ID': getDeviceId()
                }
            });
            const data = await response.json();
            
            if (data.chats) {
                $chatList.empty();
                data.chats.forEach(chat => {
                    const lastMessage = chat.history
                        .filter(msg => msg.role !== 'system')
                        .pop();
                    const preview = lastMessage
                        ? `${lastMessage.role === 'user' ? '你' : 'AI'}: ${lastMessage.content.substring(0, 50)}...`
                        : '新对话';
                    
                    const $chatItem = $(`
                        <div class="chat-item ${chat.chat_id === currentChatId ? 'active' : ''}" data-chat-id="${chat.chat_id}">
                            <div class="chat-item-content">
                                <div class="chat-item-title">${getChatModeLabel(chat.chat_mode)}</div>
                                <div class="chat-item-preview">${preview}</div>
                            </div>
                        </div>
                    `);
                    
                    $chatItem.on('click', () => switchToChat(chat));
                    $chatList.append($chatItem);
                });
            }
        } catch (error) {
            console.error('Error loading chat list:', error);
        }
    }

    function getChatModeLabel(mode) {
        const modes = {
            'english_coach': '英语教练',
            'free_talk': '自由聊天',
            'kids': '与小朋友聊天'
        };
        return modes[mode] || mode;
    }

    async function switchToChat(chat) {
        currentChatId = chat.chat_id;
        $('#chatModeSelector').val(chat.chat_mode);
        
        const chatHistory = chat.history
            .filter(entry => entry.role !== 'system')
            .map(entry => `${entry.role === 'user' ? '你' : 'AI'}: ${entry.content}`)
            .join('\n');
        $('#history').val(chatHistory);
        
        closeModal();
    }

    function openModal() {
        loadChatList();
        $chatHistoryModal.fadeIn(200);
        $('body').css('overflow', 'hidden');
    }

    function closeModal() {
        $chatHistoryModal.fadeOut(200);
        $('body').css('overflow', '');
    }

    // Event Listeners
    $chatHistoryButton.on('click', openModal);
    $closeButton.on('click', closeModal);

    // Close modal when clicking outside
    $(window).on('click', (event) => {
        if ($(event.target).is($chatHistoryModal)) {
            closeModal();
        }
    });

    // Close modal with Escape key
    $(document).on('keydown', (event) => {
        if (event.key === 'Escape' && $chatHistoryModal.is(':visible')) {
            closeModal();
        }
    });
}

// New Chat Modal Functionality
function initializeNewChatModal() {
    const $newChatButton = $('#newChatButton');
    const $newChatModal = $('#newChatModal');
    const $closeButton = $newChatModal.find('.close-button');
    const $createButton = $('#createChatButton');

    function openModal() {
        $newChatModal.fadeIn(200);
        $('body').css('overflow', 'hidden');
    }

    function closeModal() {
        $newChatModal.fadeOut(200);
        $('body').css('overflow', '');
    }

    async function handleCreateChat() {
        // Check if current chat is empty
        const currentHistory = $('#history').val().trim();
        if (currentChatId && !currentHistory) {
            showHint('您已经在新对话中');
            closeModal();
            return;
        }

        try {
            const response = await fetch('/api/chats', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Device-ID': getDeviceId()
                },
                body: JSON.stringify({
                    chat_mode: $('#chatModeSelector').val(),
                    model_name: $('#modelSelector').val()
                })
            });
            
            const data = await response.json();
            if (data.status === 'success') {
                currentChatId = data.chat.chat_id;
                $('#history').val(''); // Clear history for new chat
                closeModal();
            } else {
                console.error('Error creating new chat:', data.message);
            }
        } catch (error) {
            console.error('Error creating new chat:', error);
        }
    }

    // Event Listeners for Modal
    $newChatButton.on('click', openModal);
    $closeButton.on('click', closeModal);
    $createButton.on('click', handleCreateChat);

    // Close modal when clicking outside
    $(window).on('click', (event) => {
        if ($(event.target).is($newChatModal)) {
            closeModal();
        }
    });

    // Close modal with Escape key
    $(document).on('keydown', (event) => {
        if (event.key === 'Escape' && $newChatModal.is(':visible')) {
            closeModal();
        }
    });
}

// Initialize on page load
$(document).ready(async function() {
    // Initialize modals
    initializeNewChatModal();
    initializeChatHistoryModal();

    // Create initial chat if none exists
    try {
        const response = await fetch('/api/chats', {
            headers: {
                'X-Device-ID': getDeviceId()
            }
        });
        const data = await response.json();
        if (data.chats && data.chats.length > 0) {
            currentChatId = data.chats[0].chat_id;
            const chatHistory = data.chats[0].history
                .filter(entry => entry.role !== 'system')
                .map(entry => `${entry.role === 'user' ? '你' : 'AI'}: ${entry.content}`)
                .join('\n');
            $('#history').val(chatHistory);
            $('#chatModeSelector').val(data.chats[0].chat_mode);
        } else {
            // Show new chat modal for initial chat creation
            $('#newChatButton').click();
        }
    } catch (error) {
        console.error('Error fetching chats:', error);
        // Show new chat modal for initial chat creation
        $('#newChatButton').click();
    }

    // Update chat mode when dropdown changes
    $('#chatModeSelector').change(async function() {
        if (!currentChatId) return;
        
        const selectedMode = $(this).val();
        try {
            const response = await fetch(`/api/chats/${currentChatId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Device-ID': getDeviceId()
                },
                body: JSON.stringify({ chat_mode: selectedMode })
            });
            
            const data = await response.json();
            if (data.status === 'success') {
                $('#history').val(''); // Clear history for new chat mode
            } else {
                console.error('Error updating chat mode:', data.message);
            }
        } catch (error) {
            console.error('Error updating chat mode:', error);
        }
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
    if (!currentChatId) {
        console.error('No active chat');
        alert('No active chat session. Please try again.');
        return;
    }

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
                'Content-Type': 'application/json',
                'X-Device-ID': getDeviceId()
            },
            body: JSON.stringify({
                text: transcription,
                model: selectedModel,
                chat_id: currentChatId
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
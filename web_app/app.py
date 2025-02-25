from flask import Flask, render_template, request, jsonify, Response, stream_with_context
import dashscope
import openai
import os
from dashscope.api_entities.dashscope_response import SpeechSynthesisResponse
from dashscope.audio.tts import SpeechSynthesisResult
import uuid
import json
app = Flask(__name__, static_folder='static')

# Configuration
DASHSCOPE_API_KEY = 'sk-4d336f13dfec4e9ebf4a6cb372fee73c'
dashscope.api_key = DASHSCOPE_API_KEY

SYSTEM_PROMPT_ENGLISH_COACH = '''你是一个英语陪练，帮助中国学生学习英语，如果学生问你一个中文问题，你需要告诉学生如何用英文来问，如果学生问你一个英文问题，请你检查学生问的有没有问题，
如果有问题，指出如何纠正问题，如果没有问题，你需要用英语回答学生的问题。学生母语是中文。
学生的英语水平不高，所以当你指出问题，纠正问题，或评价学生的句子时一定要用中文。只有在回答学生的英文问题时才用英文。
请注意：
1. 学生说的话是经过语音识别转成文本的，没有标点符号，所以不要去纠正学生标点符号的问题。
2. 可以主动提出设计一些场景进行对话，例如在学校教室，体育课等， 设计对话场景时，把每个人的台词也翻译成中文，另外不要太长，每人的台词最好不要超过3轮，总共不要超过6轮对话。
'''

SYSTEM_PROMPT_FREE_TALK = '''你是一个多语言对话助手，可以进行开放式交流，请遵守：
1. 使用用户当前使用的语言进行回应
2. 保持友好、专业的语气
3. 避免敏感或争议性话题
4. 当用户请求超出能力范围时礼貌说明
5. 复杂问题分步骤解答'''

SYSTEM_PROMPT_KIDS = '''你在和1个8岁孩子进行自由对话。'''

# Chat storage
chats = {}

def get_system_prompt(chat_mode):
    prompts = {
        'english_coach': SYSTEM_PROMPT_ENGLISH_COACH,
        'free_talk': SYSTEM_PROMPT_FREE_TALK,
        'kids': SYSTEM_PROMPT_KIDS
    }
    return prompts.get(chat_mode, SYSTEM_PROMPT_FREE_TALK)

def create_new_chat(device_id, chat_mode='free_talk'):
    chat_id = str(uuid.uuid4())
    chat = {
        'chat_id': chat_id,
        'device_id': device_id,
        'chat_mode': chat_mode,
        'history': [{"role": "system", "content": get_system_prompt(chat_mode)}]
    }
    chats[chat_id] = chat
    return chat

@app.route('/api/chats', methods=['GET', 'POST'])
def chat_handler():

    for k in chats:
        print(chats[k]['chat_id'], chats[k]['device_id'], chats[k]['chat_mode'])

    device_id = request.headers.get('X-Device-ID')
    if not device_id:
        return jsonify({"status": "error", "message": "Device ID required"}), 400

    if request.method == 'GET':
        # Get all chats for the device
        device_chats = [chat for chat in chats.values() if chat['device_id'] == device_id]
        return jsonify({"chats": device_chats})

    elif request.method == 'POST':
        # Create a new chat
        data = request.json
        chat_mode = data.get('chat_mode', 'free_talk')
        new_chat = create_new_chat(device_id, chat_mode)
        return jsonify({"status": "success", "chat": new_chat})

@app.route('/api/chats/<chat_id>', methods=['GET', 'PUT', 'DELETE'])
def chat_detail_handler(chat_id):
    device_id = request.headers.get('X-Device-ID')
    if not device_id:
        return jsonify({"status": "error", "message": "Device ID required"}), 400

    if chat_id not in chats:
        return jsonify({"status": "error", "message": "Chat not found"}), 404

    chat = chats[chat_id]
    if chat['device_id'] != device_id:
        return jsonify({"status": "error", "message": "Unauthorized"}), 403

    if request.method == 'GET':
        return jsonify(chat)

    elif request.method == 'PUT':
        data = request.json
        new_mode = data.get('chat_mode')
        if new_mode:
            chat['chat_mode'] = new_mode
            chat['history'] = [{"role": "system", "content": get_system_prompt(new_mode)}]
        return jsonify({"status": "success", "chat": chat})

    elif request.method == 'DELETE':
        del chats[chat_id]
        return jsonify({"status": "success"})

def transcribe_audio(filename):
    messages = [
        {
            "role": "user",
            "content": [{"audio": filename}]
        }
    ]
    response = dashscope.MultiModalConversation.call(model="qwen-audio-asr-latest", messages=messages)
    return response['output']['choices'][0]['message']['content'][0]['text']

def generate_response(text, model_name, chat_id):
    if chat_id not in chats:
        return None

    chat = chats[chat_id]
    chat_history = chat['history']
    
    client = openai.OpenAI(
        api_key=DASHSCOPE_API_KEY,
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
    )
    
    chat_history.append({"role": "user", "content": text})

    completion = client.chat.completions.create(
        model=model_name,
        messages=chat_history,
        stream=True
    )
    
    full_response = ""
    for chunk in completion:
        if chunk.choices and chunk.choices[0].delta.content:
            content = chunk.choices[0].delta.content
            full_response += content
            yield content

    chat_history.append({'role': 'assistant', 'content': full_response})
    chats[chat_id] = chat  # Update the chat in storage

def filter_text_for_synthesis(text):
    if len(text):
        return text.replace('#', '').replace('*', '')
    else:
        return text

def convert_text_to_speech(text):
    class SaveToFileCallback(dashscope.audio.tts.ResultCallback):
        def __init__(self, filename):
            self.filename = filename
            self._file = None

        def on_open(self):
            print('Opening file for writing...', self.filename)
            self._file = open(self.filename, 'wb')

        def on_complete(self):
            print('Speech synthesis complete.')

        def on_error(self, response: SpeechSynthesisResponse):
            print('Speech synthesizer failed, response is %s' % (str(response)))

        def on_close(self):
            print('Closing file...')
            if self._file:
                self._file.close()

        def on_event(self, result: SpeechSynthesisResult):
            if result.get_audio_frame() is not None:
                #print('Writing audio frame...')
                self._file.write(result.get_audio_frame())

    unique_filename = f"{uuid.uuid4().hex}.wav"
    audio_dir = os.path.join(app.static_folder, 'audio_sythesis')
    os.makedirs(audio_dir, exist_ok=True)
    output_file = os.path.join(audio_dir, unique_filename)
    callback = SaveToFileCallback(output_file)
    
    dashscope.audio.tts.SpeechSynthesizer.call(
        model='sambert-zhichu-v1',
        text=filter_text_for_synthesis(text),
        sample_rate=48000,
        format='wav',
        rate=1.2,
        callback=callback
    )
    
    return unique_filename

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/audio/transcriptions', methods=['POST'])
def transcribe():
    if 'audio' not in request.files:
        return jsonify({"status": "error", "message": "No audio file provided"}), 400

    audio_file = request.files['audio']
    if audio_file.filename == '':
        return jsonify({"status": "error", "message": "No selected file"}), 400

    # Save the file temporarily
    recording_dir = os.path.join(app.static_folder, 'recording')
    if not os.path.exists(recording_dir):
        os.makedirs(recording_dir)

    audio_path = os.path.join(recording_dir, f"{uuid.uuid4().hex}.wav")
    audio_file.save(audio_path)

    # Transcribe the audio
    transcription = transcribe_audio(audio_path)
    return jsonify({"transcription": transcription})

@app.route('/api/ai/generate', methods=['POST'])
def generate():
    device_id = request.headers.get('X-Device-ID')
    if not device_id:
        return jsonify({"status": "error", "message": "Device ID required"}), 400

    data = request.json
    chat_id = data.get('chat_id')
    if not chat_id:
        return jsonify({"status": "error", "message": "Chat ID required"}), 400

    if chat_id not in chats or chats[chat_id]['device_id'] != device_id:
        return jsonify({"status": "error", "message": "Invalid chat ID"}), 403

    selected_model = data.get('model', 'qwen-max')
    
    def generate_stream():
        for content in generate_response(data['text'], model_name=selected_model, chat_id=chat_id):
            if content is None:
                yield f"data: {json.dumps({'error': 'Chat not found'})}\n\n"
                break
            yield f"data: {json.dumps({'content': content})}\n\n"
    
    return Response(stream_with_context(generate_stream()), mimetype='text/event-stream')

@app.route('/api/audio/synthesis', methods=['POST'])
def convert():
    data = request.json
    # Generate speech and save to file
    unique_filename = convert_text_to_speech(data['text'])
    
    # Return the file URL with the unique filename
    unique_audio_url = f"/static/audio_sythesis/{unique_filename}"
    return jsonify({
        "audio_url": unique_audio_url
    })

@app.route('/favicon.ico')
def favicon():
    return Response(status=204)  # Return an empty response for favicon requests

if __name__ == '__main__':
    app.run(
        host='0.0.0.0',
        debug=True,
    )

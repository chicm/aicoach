from flask import Flask, render_template, request, jsonify, Response
import pyaudio
import wave
import dashscope
import openai
import json
import os
from flask import send_from_directory
from dashscope.api_entities.dashscope_response import SpeechSynthesisResponse
from dashscope.audio.tts import ResultCallback, SpeechSynthesizer, SpeechSynthesisResult
app = Flask(__name__, static_folder='static')

# Configuration
DASHSCOPE_API_KEY = 'sk-4d336f13dfec4e9ebf4a6cb372fee73c'
dashscope.api_key = DASHSCOPE_API_KEY

# Audio recording parameters
FORMAT = pyaudio.paInt16
CHANNELS = 2
RATE = 44100
CHUNK = 1024
RECORD_SECONDS = 5
WAVE_OUTPUT_FILENAME = "output.wav"

SYSTEM_PROMPT_ENGLISH_COACH = '''你是一个英语陪练，帮助中国学生学习英语，如果学生问你一个中文问题，你需要告诉学生如何用英文来问，如果学生问你一个英文问题，请你检查学生问的有没有问题，
如果有问题，指出如何纠正问题，如果没有问题，你需要用英语回答学生的问题。学生名字是迟羽墨，学生母语是中文。
学生的英语水平不高，所以当你指出问题，纠正问题，或评价学生的句子时一定要用中文。只有在回答学生的英文问题时才用英文。
请注意：
1. 学生说的话是经过语音识别转成文本的，没有标点符号，所以不要去纠正学生标点符号的问题。
2. 可以主动提出设计一些场景进行对话，例如在学校教室，体育课等， 设计对话场景时，把每个人的台词也翻译成中文，另外不要太长，每人的台词最好不要超过3轮，总共不要超过6轮对话。
'''

SYSTEM_PROMPT_FREE_TALK = ''''''

SYSTEM_PROMPT_KIDS = '''你在和1个8岁孩子进行自由对话。'''

chat_mode = 'english_coach'

chat_histories = {
    'english_coach': [{"role": "system", "content": SYSTEM_PROMPT_ENGLISH_COACH}],
    'free_talk': [{"role": "system", "content": SYSTEM_PROMPT_FREE_TALK}],
    'kids': [{"role": "system", "content": SYSTEM_PROMPT_KIDS}],
}

@app.route('/chat-mode', methods=['GET', 'POST'])
def chat_mode_handler():
    global chat_mode
    if request.method == 'GET':
        return jsonify({
            "chat_mode": chat_mode,
            "chat_history": chat_histories[chat_mode]
        })
    elif request.method == 'POST':
        data = request.json
        new_mode = data.get('chat_mode')
        if new_mode in chat_histories:
            chat_mode = new_mode
            return jsonify({
                "status": "success",
                "chat_mode": chat_mode,
                "chat_history": chat_histories[chat_mode]
            })
        else:
            return jsonify({"status": "error", "message": "Invalid chat mode"}), 400


def transcribe_audio(filename):
    messages = [
        {
            "role": "user",
            "content": [{"audio": filename}]
        }
    ]
    response = dashscope.MultiModalConversation.call(model="qwen-audio-asr", messages=messages)
    return response['output']['choices'][0]['message']['content'][0]['text']

def generate_response(text):
    chat_history = chat_histories[chat_mode]

    client = openai.OpenAI(
        api_key=DASHSCOPE_API_KEY,
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
    )
    chat_history.append({"role": "user", "content": text})

    completion = client.chat.completions.create(
        model="qwen-max",
        messages=chat_history
    )
    #return json.loads(completion.model_dump_json())['choices'][0]['message']['content']
    response = completion.choices[0].message.content
    chat_history.append({'role': 'assistant', 'content': response})
    print(chat_history)
    
    return response

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

    import uuid
    unique_filename = f"output_speech_{uuid.uuid4().hex}.wav"
    output_file = os.path.join(app.static_folder, 'static', unique_filename)
    callback = SaveToFileCallback(output_file)
    
    dashscope.audio.tts.SpeechSynthesizer.call(
        model='sambert-zhichu-v1',
        text=text,
        sample_rate=48000,
        format='wav',
        rate=1.2,
        callback=callback
    )
    
    return unique_filename

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/transcribe', methods=['POST'])
def transcribe():
    if 'audio' not in request.files:
        return jsonify({"status": "error", "message": "No audio file provided"}), 400

    audio_file = request.files['audio']
    if audio_file.filename == '':
        return jsonify({"status": "error", "message": "No selected file"}), 400

    # Save the file temporarily
    static_dir = os.path.join(app.static_folder, 'static')
    if not os.path.exists(static_dir):
        os.makedirs(static_dir)

    audio_path = os.path.join(static_dir, audio_file.filename)
    audio_file.save(audio_path)

    # Transcribe the audio
    transcription = transcribe_audio(audio_path)
    return jsonify({"transcription": transcription})

@app.route('/generate', methods=['POST'])
def generate():
    data = request.json
    response = generate_response(data['text'])
    return jsonify({"response": response})

@app.route('/convert', methods=['POST'])
def convert():
    data = request.json
    # Generate speech and save to file
    unique_filename = convert_text_to_speech(data['text'])
    
    # Return the file URL with the unique filename
    unique_audio_url = f"/static/static/{unique_filename}"
    return jsonify({
        "audio_url": unique_audio_url
    })

@app.route('/clear-audio', methods=['DELETE'])
def clear_audio():
    output_path = os.path.join(app.static_folder, 'static', 'test_output_speech.wav')
    if os.path.exists(output_path):
        os.remove(output_path)
    return jsonify({"status": "success"})

@app.route('/favicon.ico')
def favicon():
    return Response(status=204)  # Return an empty response for favicon requests

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True)

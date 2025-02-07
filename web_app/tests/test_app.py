import unittest
import os
from app import app, convert_text_to_speech

class TestConvertTextToSpeech(unittest.TestCase):
    def setUp(self):
        # Set up the Flask app for testing
        self.app = app.test_client()
        self.app.testing = True

    def test_convert_text_to_speech(self):
        # Define the output file path
        output_filename = "test_output_speech.wav"
        output_path = os.path.join(app.static_folder, 'static', output_filename)

        # Ensure the file does not exist before the test
        #if os.path.exists(output_path):
        #    os.remove(output_path)

        try:
            # Call the function to convert text to speech
            convert_text_to_speech("This is a test.")

            # Check if the file was created
            self.assertTrue(os.path.exists(output_path), "The audio file was not generated.")

            # Check file size to ensure it's not empty
            file_size = os.path.getsize(output_path)
            self.assertGreater(file_size, 1024, f"The generated audio file is too small ({file_size} bytes).")

        except Exception as e:
            self.fail(f"Exception occurred: {e}")


if __name__ == '__main__':
    unittest.main()
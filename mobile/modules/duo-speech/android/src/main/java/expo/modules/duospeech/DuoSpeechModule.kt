package expo.modules.duospeech

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

class DuoSpeechModule : Module() {
  private var recognizer: SpeechRecognizer? = null
  private val mainHandler = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("DuoSpeech")
    Events("onSpeechPartial", "onSpeechResult", "onSpeechError", "onSpeechState")

    AsyncFunction("startListening") { localeTag: String? ->
      val context = appContext.reactContext ?: throw IllegalStateException("React context unavailable")
      if (!SpeechRecognizer.isRecognitionAvailable(context)) {
        throw IllegalStateException("Android speech recognition is unavailable on this device")
      }
      mainHandler.post {
        recognizer?.cancel()
        recognizer = SpeechRecognizer.createSpeechRecognizer(context).also { speech ->
          speech.setRecognitionListener(listener)
          val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, localeTag ?: Locale.getDefault().toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
          }
          speech.startListening(intent)
        }
        sendEvent("onSpeechState", mapOf("state" to "listening"))
      }
    }

    AsyncFunction("stopListening") {
      mainHandler.post { recognizer?.stopListening() }
      sendEvent("onSpeechState", mapOf("state" to "stopping"))
    }

    AsyncFunction("cancelListening") {
      mainHandler.post { recognizer?.cancel() }
      sendEvent("onSpeechState", mapOf("state" to "cancelled"))
    }

    OnDestroy {
      recognizer?.destroy()
      recognizer = null
    }
  }

  private val listener = object : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) = sendEvent("onSpeechState", mapOf("state" to "ready"))
    override fun onBeginningOfSpeech() = sendEvent("onSpeechState", mapOf("state" to "speaking"))
    override fun onRmsChanged(rmsdB: Float) = Unit
    override fun onBufferReceived(buffer: ByteArray?) = Unit
    override fun onEndOfSpeech() = sendEvent("onSpeechState", mapOf("state" to "ended"))
    override fun onPartialResults(results: Bundle?) {
      val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
      if (!text.isNullOrBlank()) sendEvent("onSpeechPartial", mapOf("text" to text))
    }
    override fun onResults(results: Bundle?) {
      val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
      if (!text.isNullOrBlank()) sendEvent("onSpeechResult", mapOf("text" to text))
      sendEvent("onSpeechState", mapOf("state" to "idle"))
    }
    override fun onError(error: Int) {
      sendEvent("onSpeechError", mapOf("code" to error, "message" to speechErrorMessage(error)))
      sendEvent("onSpeechState", mapOf("state" to "idle"))
    }
    override fun onEvent(eventType: Int, params: Bundle?) = Unit
  }

  private fun speechErrorMessage(code: Int): String = when (code) {
    SpeechRecognizer.ERROR_AUDIO -> "Audio recording failed"
    SpeechRecognizer.ERROR_CLIENT -> "Speech client error"
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission denied"
    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech service network error"
    SpeechRecognizer.ERROR_NO_MATCH -> "No speech recognized"
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Speech recognizer is busy"
    SpeechRecognizer.ERROR_SERVER -> "Speech service error"
    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech heard"
    else -> "Speech recognition failed ($code)"
  }
}

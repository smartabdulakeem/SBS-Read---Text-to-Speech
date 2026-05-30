package com.voxread.ai;

import android.content.Context;
import android.content.SharedPreferences;
import android.speech.tts.TextToSpeech;

import java.util.Locale;

/** Thin wrapper over Android's native TextToSpeech used by the Select-to-Speak
 *  overlay. Reads rate/pitch/lang from the shared "voxread_prefs" so it matches
 *  the in-app voice settings (written by ScreenReaderPlugin.saveTtsPrefs). */
public class TtsHelper {
    private TextToSpeech tts;
    private boolean ready = false;
    private String pendingText = null;
    private final Context appContext;

    public TtsHelper(Context context) {
        this.appContext = context.getApplicationContext();
        tts = new TextToSpeech(appContext, status -> {
            if (status == TextToSpeech.SUCCESS) {
                ready = true;
                applyPrefs();
                if (pendingText != null) {
                    speakNow(pendingText);
                    pendingText = null;
                }
            }
        });
    }

    private void applyPrefs() {
        try {
            SharedPreferences p = appContext.getSharedPreferences("voxread_prefs", Context.MODE_PRIVATE);
            tts.setSpeechRate(p.getFloat("rate", 1.0f));
            tts.setPitch(p.getFloat("pitch", 1.0f));
            String lang = p.getString("lang", null);
            if (lang != null && lang.length() > 0) {
                tts.setLanguage(Locale.forLanguageTag(lang.replace('_', '-')));
            } else {
                tts.setLanguage(Locale.getDefault());
            }
        } catch (Exception ignored) {
        }
    }

    public void speak(String text) {
        if (text == null || text.trim().isEmpty()) return;
        if (!ready) { pendingText = text; return; }
        applyPrefs();
        speakNow(text);
    }

    private void speakNow(String text) {
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "voxread-stt");
    }

    public boolean isSpeaking() {
        return tts != null && tts.isSpeaking();
    }

    public void stop() {
        if (tts != null) tts.stop();
    }

    public void shutdown() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
    }
}

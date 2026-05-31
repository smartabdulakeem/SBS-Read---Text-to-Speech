import { useState, useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

// On Android (Capacitor WebView) the browser Web Speech API is NOT available,
// so we drive the native @capacitor-community/text-to-speech plugin instead.
// On web / Electron (.exe) / Chrome extension we keep using window.speechSynthesis,
// which gives us word-level boundary highlighting + native pause/resume.
const IS_NATIVE = Capacitor.isNativePlatform();

// --- persisted settings (localStorage) ---
const voiceKey = (v) => (v ? `${v.voiceURI || v.name}|${v.lang}` : '');
const readNum = (k, d) => {
  try { const n = parseFloat(localStorage.getItem(k)); return Number.isFinite(n) ? n : d; }
  catch { return d; }
};

export function useTTS() {
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoiceState] = useState(null);
  const [rate, setRate] = useState(() => readNum('voxread_rate', 1));
  const [pitch, setPitch] = useState(() => readNum('voxread_pitch', 1));
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(-1);
  const [currentWordRange, setCurrentWordRange] = useState({ start: -1, end: -1 });
  const [sentences, setSentences] = useState([]);
  const [ttsError, setTtsError] = useState(null);

  const utteranceRef = useRef(null);
  const sentencesRef = useRef([]);
  const sentenceIndexRef = useRef(-1);
  const isPlayingRef = useRef(false);
  const isPausedRef = useRef(false);
  const rateRef = useRef(1);
  const pitchRef = useRef(1);
  const voiceRef = useRef(null);
  const voicesRef = useRef([]);
  // Increments on every start/stop/jump/pause so stale native speak-loops self-cancel.
  const playTokenRef = useRef(0);
  const audioRef = useRef(null);

  // Keep refs in sync for the event handlers to read the freshest state
  useEffect(() => { rateRef.current = rate; }, [rate]);
  useEffect(() => { pitchRef.current = pitch; }, [pitch]);
  useEffect(() => { voiceRef.current = selectedVoice; }, [selectedVoice]);
  useEffect(() => { voicesRef.current = voices; }, [voices]);

  // Persist voice/rate/pitch so they survive restarts.
  useEffect(() => { try { localStorage.setItem('voxread_rate', String(rate)); } catch { /* ignore */ } }, [rate]);
  useEffect(() => { try { localStorage.setItem('voxread_pitch', String(pitch)); } catch { /* ignore */ } }, [pitch]);
  const selectVoiceAndPersist = useCallback((voice) => {
    setSelectedVoiceState(voice);
    if (voice) {
      try { localStorage.setItem('voxread_voice', voiceKey(voice)); } catch { /* ignore */ }
    }
  }, []);

  const applyVoices = useCallback((availableVoices) => {
    let sorted = [...availableVoices].sort((a, b) => {
      const langA = (a.lang || '').toLowerCase();
      const langB = (b.lang || '').toLowerCase();
      if (langA < langB) return -1;
      if (langA > langB) return 1;
      return 0;
    });

    if (window.voxreadDesktop?.isDesktop) {
      const PIPER_VOICES = [
        {
          name: 'Piper Amy (Neural Female)',
          lang: 'en-US',
          voiceURI: 'piper-neural-amy',
          modelName: 'en_US-amy-medium.onnx',
          default: true,
          isPiper: true
        },
        {
          name: 'Piper Ryan (Neural Male 1)',
          lang: 'en-US',
          voiceURI: 'piper-neural-ryan',
          modelName: 'en_US-ryan-medium.onnx',
          isPiper: true
        },
        {
          name: 'Piper Lessac (Neural Male 2)',
          lang: 'en-US',
          voiceURI: 'piper-neural-lessac',
          modelName: 'en_US-lessac-medium.onnx',
          isPiper: true
        }
      ];
      sorted = [...PIPER_VOICES, ...sorted];
    }

    setVoices(sorted);
    voicesRef.current = sorted;

    const savedKey = localStorage.getItem('voxread_voice');
    let chosen = null;
    if (savedKey) {
      chosen = sorted.find(v => voiceKey(v) === savedKey);
    }

    if (chosen) {
      setSelectedVoiceState(chosen);
    } else if (!voiceRef.current && sorted.length > 0) {
      const fallback = sorted.find(v => v.default) ||
                       sorted.find(v => (v.lang || '').startsWith('en')) ||
                       sorted[0];
      setSelectedVoiceState(fallback);
    }
  }, []);

  // -------- Voice loading --------
  // On Android the TTS engine may not be initialized the instant the app mounts,
  // so getSupportedVoices() can briefly return []. Retry a few times before giving up.
  const loadVoices = useCallback(async (attempt = 0) => {
    if (IS_NATIVE) {
      try {
        const result = await TextToSpeech.getSupportedVoices();
        // Tag each voice with its ORIGINAL index — the plugin's speak({voice})
        // expects the index from this unsorted order, but we sort for display.
        const list = (result?.voices || []).map((v, i) => ({ ...v, _idx: i }));
        if (list.length > 0) {
          applyVoices(list);
        } else if (attempt < 8) {
          setTimeout(() => loadVoices(attempt + 1), 700);
        } else {
          // Engine reachable but no installed voice data on this device.
          setVoices([]);
          voicesRef.current = [];
        }
      } catch (e) {
        console.error('Failed to load native voices:', e);
        if (attempt < 8) {
          setTimeout(() => loadVoices(attempt + 1), 700);
        } else {
          setTtsError('Could not reach the device text-to-speech engine.');
        }
      }
      return;
    }
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    applyVoices(window.speechSynthesis.getVoices());
  }, [applyVoices]);

  useEffect(() => {
    loadVoices();
    let rangeHandlePromise;
    if (IS_NATIVE) {
      // Word-range highlighting on Android (plugin emits charIndex offsets per utterance).
      rangeHandlePromise = TextToSpeech.addListener('onRangeStart', (info) => {
        if (info && typeof info.start === 'number' && typeof info.end === 'number') {
          setCurrentWordRange({ start: info.start, end: info.end });
        }
      });
    } else if (typeof window !== 'undefined' && window.speechSynthesis) {
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
      }
    }
    return () => {
      if (IS_NATIVE) {
        TextToSpeech.stop().catch(() => {});
        if (rangeHandlePromise) rangeHandlePromise.then(h => h && h.remove()).catch(() => {});
      } else {
        if (typeof window !== 'undefined' && window.speechSynthesis) {
          window.speechSynthesis.cancel();
        }
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
        }
        if (window.voxreadDesktop) {
          window.voxreadDesktop.stopSpeech().catch(() => {});
        }
      }
    };
  }, [loadVoices]);

  // Opens the Android dialog to install missing TTS voice data.
  const openVoiceInstall = useCallback(async () => {
    if (!IS_NATIVE) return;
    try {
      await TextToSpeech.openInstall();
    } catch (e) {
      console.error('openInstall failed:', e);
    }
  }, []);

  // Split text into clean sentences (shared by both engines)
  const splitTextIntoSentences = (text) => {
    if (!text) return [];
    const rawSentences = text.split(/(?<=[.!?])\s+/);
    return rawSentences.map(s => s.trim()).filter(s => s.length > 0);
  };

  // Index of the selected voice within the native voice list (plugin takes an index, not a name).
  const nativeVoiceIndex = () => {
    const v = voiceRef.current;
    if (!v) return -1;
    // Use the original index captured at load time (display list is sorted).
    if (typeof v._idx === 'number') return v._idx;
    return voicesRef.current.findIndex(x =>
      (x.voiceURI && v.voiceURI && x.voiceURI === v.voiceURI) || x.name === v.name
    );
  };

  const resetPlaybackState = useCallback(() => {
    setIsPlaying(false);
    setIsPaused(false);
    isPlayingRef.current = false;
    isPausedRef.current = false;
    setCurrentSentenceIndex(-1);
    sentenceIndexRef.current = -1;
    setCurrentWordRange({ start: -1, end: -1 });
  }, []);

  const stop = useCallback(() => {
    playTokenRef.current += 1; // cancel any running native loop
    if (IS_NATIVE) {
      TextToSpeech.stop().catch(() => {});
    } else if (voiceRef.current?.isPiper) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (window.voxreadDesktop) {
        window.voxreadDesktop.stopSpeech().catch(() => {});
      }
    } else if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    resetPlaybackState();
  }, [resetPlaybackState]);

  // -------- Native (Android) playback loop --------
  // Speaks one sentence at a time so we still get sentence-level highlighting.
  // The plugin has no word-boundary events, so currentWordRange stays unset and
  // the UI falls back to highlighting the whole active sentence.
  const runNative = useCallback(async (startIndex) => {
    await TextToSpeech.stop().catch(() => {});
    const myToken = ++playTokenRef.current;

    for (let i = startIndex; i < sentencesRef.current.length; i++) {
      if (playTokenRef.current !== myToken) return; // superseded/stopped/paused
      setCurrentSentenceIndex(i);
      sentenceIndexRef.current = i;
      setCurrentWordRange({ start: -1, end: -1 });

      const idx = nativeVoiceIndex();
      try {
        await TextToSpeech.speak({
          text: sentencesRef.current[i],
          lang: voiceRef.current?.lang || 'en-US',
          rate: rateRef.current,
          pitch: pitchRef.current,
          // Omit `voice` so the system default is used when none is selected.
          ...(idx >= 0 ? { voice: idx } : {}),
        });

        // Android speedup fix: add a small pause to allow the native audio track to finish the utterance
        if (playTokenRef.current === myToken) {
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      } catch (e) {
        // speak() rejects when interrupted by stop()/jump — that's expected, just bail.
        if (playTokenRef.current !== myToken) return;
        // Otherwise it's a genuine failure (e.g. no installed voice data).
        console.error('Native speak error:', e);
        setTtsError('Playback failed — your device may have no TTS voice installed. Tap "Install voice data" below.');
        resetPlaybackState();
        return;
      }
    }

    if (playTokenRef.current === myToken) {
      resetPlaybackState();
    }
  }, [resetPlaybackState]);

  // -------- Web (Electron / extension / browser) playback --------
  const speakSentence = useCallback((index) => {
    if (!window.speechSynthesis || index < 0 || index >= sentencesRef.current.length) {
      stop();
      return;
    }

    window.speechSynthesis.cancel();
    setCurrentSentenceIndex(index);
    sentenceIndexRef.current = index;
    setCurrentWordRange({ start: -1, end: -1 });

    const sentenceText = sentencesRef.current[index];
    const utterance = new SpeechSynthesisUtterance(sentenceText);
    utteranceRef.current = utterance;

    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.rate = rateRef.current;
    utterance.pitch = pitchRef.current;

    utterance.onboundary = (event) => {
      if (event.name === 'word') {
        const charIndex = event.charIndex;
        const textRest = sentenceText.substring(charIndex);
        const nextSpace = textRest.search(/\s/);
        const wordLength = nextSpace > -1 ? nextSpace : textRest.length;
        setCurrentWordRange({ start: charIndex, end: charIndex + wordLength });
      }
    };

    utterance.onend = () => {
      if (isPlayingRef.current) {
        const nextIndex = index + 1;
        if (nextIndex < sentencesRef.current.length) {
          speakSentence(nextIndex);
        } else {
          stop();
        }
      }
    };

    utterance.onerror = (e) => {
      console.error('Speech synthesis error:', e);
      if (isPlayingRef.current && e.error !== 'interrupted') {
        const nextIndex = index + 1;
        if (nextIndex < sentencesRef.current.length) {
          speakSentence(nextIndex);
        } else {
          stop();
        }
      }
    };

    window.speechSynthesis.speak(utterance);
  }, [stop]);

  // -------- Piper Neural Playback loop --------
  const runPiper = useCallback(async (startIndex) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (window.voxreadDesktop) {
      await window.voxreadDesktop.stopSpeech().catch(() => {});
    }
    const myToken = ++playTokenRef.current;

    for (let i = startIndex; i < sentencesRef.current.length; i++) {
      if (playTokenRef.current !== myToken) return;
      setCurrentSentenceIndex(i);
      sentenceIndexRef.current = i;
      setCurrentWordRange({ start: -1, end: -1 });

      try {
        const wavUrl = await window.voxreadDesktop.synthesizeSpeech(
          sentencesRef.current[i],
          rateRef.current,
          voiceRef.current?.modelName
        );

        if (playTokenRef.current !== myToken) return;

        await new Promise((resolve, reject) => {
          const audio = new Audio(wavUrl);
          audioRef.current = audio;

          audio.onended = () => {
            audioRef.current = null;
            resolve();
          };

          audio.onerror = (e) => {
            audioRef.current = null;
            reject(e);
          };

          if (isPausedRef.current) {
            audio.pause();
          } else {
            audio.play().catch(reject);
          }
        });
      } catch (e) {
        if (playTokenRef.current !== myToken) return;
        console.error('Piper playback error:', e);
        setTtsError('Piper playback failed. Ensure Piper is fully installed.');
        resetPlaybackState();
        return;
      }
    }

    if (playTokenRef.current === myToken) {
      resetPlaybackState();
    }
  }, [resetPlaybackState]);

  // -------- Public API (platform-agnostic) --------
  const start = useCallback((text) => {
    if (!text) return;
    setTtsError(null);
    stop();
    const split = splitTextIntoSentences(text);
    setSentences(split);
    sentencesRef.current = split;
    if (split.length === 0) return;

    setIsPlaying(true);
    setIsPaused(false);
    isPlayingRef.current = true;
    isPausedRef.current = false;

    if (IS_NATIVE) {
      runNative(0);
    } else if (voiceRef.current?.isPiper) {
      runPiper(0);
    } else if (window.speechSynthesis) {
      speakSentence(0);
    }
  }, [stop, runNative, runPiper, speakSentence]);

  const pause = useCallback(() => {
    if (!isPlaying) return;
    if (IS_NATIVE) {
      playTokenRef.current += 1; // stop the loop without resetting position
      TextToSpeech.stop().catch(() => {});
      isPausedRef.current = true;
      setIsPaused(true);
    } else if (voiceRef.current?.isPiper) {
      isPausedRef.current = true;
      setIsPaused(true);
      if (audioRef.current) {
        audioRef.current.pause();
      }
    } else if (window.speechSynthesis) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  }, [isPlaying]);

  const resume = useCallback(() => {
    if (!isPaused) return;
    if (IS_NATIVE) {
      isPausedRef.current = false;
      setIsPaused(false);
      // Native engine can't resume mid-sentence; restart from the current sentence.
      runNative(Math.max(0, sentenceIndexRef.current));
    } else if (voiceRef.current?.isPiper) {
      isPausedRef.current = false;
      setIsPaused(false);
      if (audioRef.current) {
        audioRef.current.play().catch(e => {
          console.error('Resume play failed, restarting sentence:', e);
          runPiper(sentenceIndexRef.current);
        });
      } else {
        runPiper(sentenceIndexRef.current);
      }
    } else if (window.speechSynthesis) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    }
  }, [isPaused, runNative, runPiper]);

  const jumpToSentence = useCallback((index) => {
    if (index < 0 || index >= sentencesRef.current.length) return;
    if (!isPlayingRef.current) {
      setIsPlaying(true);
      isPlayingRef.current = true;
    }
    setIsPaused(false);
    isPausedRef.current = false;
    if (IS_NATIVE) {
      runNative(index);
    } else if (voiceRef.current?.isPiper) {
      runPiper(index);
    } else {
      speakSentence(index);
    }
  }, [runNative, runPiper, speakSentence]);

  const skipForward = useCallback(() => {
    const nextIndex = sentenceIndexRef.current + 1;
    if (nextIndex < sentencesRef.current.length) jumpToSentence(nextIndex);
  }, [jumpToSentence]);

  const skipBackward = useCallback(() => {
    const prevIndex = sentenceIndexRef.current - 1;
    if (prevIndex >= 0) jumpToSentence(prevIndex);
  }, [jumpToSentence]);

  return {
    voices,
    selectedVoice,
    setSelectedVoice: selectVoiceAndPersist,
    rate,
    setRate,
    pitch,
    setPitch,
    isPlaying,
    isPaused,
    currentSentenceIndex,
    currentWordRange,
    sentences,
    start,
    stop,
    pause,
    resume,
    jumpToSentence,
    skipForward,
    skipBackward,
    ttsError,
    openVoiceInstall,
    isNative: IS_NATIVE
  };
}

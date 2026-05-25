import { useState, useEffect, useRef, useCallback } from 'react';

export function useTTS() {
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(-1);
  const [currentWordRange, setCurrentWordRange] = useState({ start: -1, end: -1 });
  const [sentences, setSentences] = useState([]);

  const utteranceRef = useRef(null);
  const sentencesRef = useRef([]);
  const sentenceIndexRef = useRef(-1);
  const isPlayingRef = useRef(false);
  const rateRef = useRef(1);
  const pitchRef = useRef(1);
  const voiceRef = useRef(null);

  // Keep refs in sync for the event handlers to read the freshest state
  useEffect(() => { rateRef.current = rate; }, [rate]);
  useEffect(() => { pitchRef.current = pitch; }, [pitch]);
  useEffect(() => { voiceRef.current = selectedVoice; }, [selectedVoice]);

  // Load voices
  const loadVoices = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    let availableVoices = window.speechSynthesis.getVoices();
    // Sort voices: put standard languages, then alphabetically
    availableVoices = [...availableVoices].sort((a, b) => {
      const langA = a.lang.toLowerCase();
      const langB = b.lang.toLowerCase();
      if (langA < langB) return -1;
      if (langA > langB) return 1;
      return 0;
    });
    setVoices(availableVoices);

    // Pick a default voice (prefer English, or first available)
    if (availableVoices.length > 0 && !voiceRef.current) {
      const defaultVoice = availableVoices.find(v => v.default) || 
                           availableVoices.find(v => v.lang.startsWith('en')) || 
                           availableVoices[0];
      setSelectedVoice(defaultVoice);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, [loadVoices]);

  // Split text into clean sentences
  const splitTextIntoSentences = (text) => {
    if (!text) return [];
    // Regular expression to split sentences while maintaining abbreviations like Mr., Dr.
    // Splits on punctuation followed by space
    const rawSentences = text.split(/(?<=[.!?])\s+/);
    return rawSentences.map(s => s.trim()).filter(s => s.length > 0);
  };

  const stop = useCallback(() => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setIsPlaying(false);
    setIsPaused(false);
    isPlayingRef.current = false;
    setCurrentSentenceIndex(-1);
    sentenceIndexRef.current = -1;
    setCurrentWordRange({ start: -1, end: -1 });
  }, []);

  // Speak a single sentence chunk
  const speakSentence = useCallback((index) => {
    if (!window.speechSynthesis || index < 0 || index >= sentencesRef.current.length) {
      stop();
      return;
    }

    window.speechSynthesis.cancel(); // Cancel any current utterance
    setCurrentSentenceIndex(index);
    sentenceIndexRef.current = index;
    setCurrentWordRange({ start: -1, end: -1 });

    const sentenceText = sentencesRef.current[index];
    const utterance = new SpeechSynthesisUtterance(sentenceText);
    utteranceRef.current = utterance;

    // Apply configurations
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.rate = rateRef.current;
    utterance.pitch = pitchRef.current;

    // Word-by-word boundary tracking
    utterance.onboundary = (event) => {
      if (event.name === 'word') {
        const charIndex = event.charIndex;
        // Find end of current word
        const textRest = sentenceText.substring(charIndex);
        const nextSpace = textRest.search(/\s/);
        const wordLength = nextSpace > -1 ? nextSpace : textRest.length;
        
        setCurrentWordRange({
          start: charIndex,
          end: charIndex + wordLength
        });
      }
    };

    utterance.onend = () => {
      // Auto-advance to next sentence
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
      if (isPlayingRef.current) {
        // If error is not "interrupted" (which happens on manual cancels), proceed
        if (e.error !== 'interrupted') {
          const nextIndex = index + 1;
          if (nextIndex < sentencesRef.current.length) {
            speakSentence(nextIndex);
          } else {
            stop();
          }
        }
      }
    };

    window.speechSynthesis.speak(utterance);
  }, [stop]);

  const start = useCallback((text) => {
    if (!window.speechSynthesis || !text) return;
    
    stop();
    const split = splitTextIntoSentences(text);
    setSentences(split);
    sentencesRef.current = split;
    
    if (split.length === 0) return;

    setIsPlaying(true);
    setIsPaused(false);
    isPlayingRef.current = true;

    speakSentence(0);
  }, [speakSentence, stop]);

  const pause = useCallback(() => {
    if (!window.speechSynthesis || !isPlaying) return;
    window.speechSynthesis.pause();
    setIsPaused(true);
  }, [isPlaying]);

  const resume = useCallback(() => {
    if (!window.speechSynthesis || !isPaused) return;
    window.speechSynthesis.resume();
    setIsPaused(false);
  }, [isPaused]);

  // Jump to specific sentence index
  const jumpToSentence = useCallback((index) => {
    if (index < 0 || index >= sentencesRef.current.length) return;
    if (!isPlayingRef.current) {
      setIsPlaying(true);
      isPlayingRef.current = true;
    }
    speakSentence(index);
  }, [speakSentence]);

  // Skip forward/backward
  const skipForward = useCallback(() => {
    const nextIndex = sentenceIndexRef.current + 1;
    if (nextIndex < sentencesRef.current.length) {
      jumpToSentence(nextIndex);
    }
  }, [jumpToSentence]);

  const skipBackward = useCallback(() => {
    const prevIndex = sentenceIndexRef.current - 1;
    if (prevIndex >= 0) {
      jumpToSentence(prevIndex);
    }
  }, [jumpToSentence]);

  return {
    voices,
    selectedVoice,
    setSelectedVoice,
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
    skipBackward
  };
}

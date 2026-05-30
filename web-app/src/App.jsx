import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, Pause, Square, SkipForward, SkipBack, Upload,
  Trash2, Volume2, Globe, FileText, Sparkles, Copy,
  BookOpen, Clock, Settings, RefreshCw, Languages, ArrowRight,
  Download
} from 'lucide-react';

// MP3 export hits the Vercel serverless TTS function. On the web it's same-origin;
// the packaged .exe (file://) and Android (capacitor://) must call the public URL.
const TTS_API_BASE =
  typeof location !== 'undefined' && location.protocol.startsWith('http')
    ? ''
    : 'https://sbs-read-text-to-speech.vercel.app';
import { useTTS } from './hooks/useTTS';
import { extractTextFromFile } from './utils/fileParser';
import HistoryList from './components/HistoryList';

export default function App() {
  const {
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
    skipBackward,
    ttsError,
    openVoiceInstall,
    isNative
  } = useTTS();

  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [history, setHistory] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [selectedLangFilter, setSelectedLangFilter] = useState('All');
  const [activeTab, setActiveTab] = useState('read'); // 'read' or 'history'

  // Auto-scroll: keep the sentence being read centered in the playback viewer.
  const readerContainerRef = useRef(null);
  const activeSentenceRef = useRef(null);
  useEffect(() => {
    const container = readerContainerRef.current;
    const el = activeSentenceRef.current;
    if (!container || !el || currentSentenceIndex < 0) return;
    const top = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [currentSentenceIndex]);

  // Load history from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('voxread_history');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse history:', e);
      }
    }
  }, []);

  // Save history helper
  const saveToHistory = (newText, title = '') => {
    if (!newText.trim()) return;
    const truncatedTitle = title || newText.split('\n')[0].substring(0, 50).trim() || 'Untitled Document';
    const newItem = {
      id: Date.now().toString(),
      text: newText,
      title: truncatedTitle,
      timestamp: Date.now(),
    };
    const updated = [newItem, ...history.filter(item => item.text !== newText)].slice(0, 50); // limit to 50 items
    setHistory(updated);
    localStorage.setItem('voxread_history', JSON.stringify(updated));
  };

  // Listen for native Android share events
  useEffect(() => {
    // 1. Check for cold-start shared text
    if (window.androidSharedText) {
      const sharedText = window.androidSharedText;
      setText(sharedText);
      saveToHistory(sharedText, "Shared Text");
      start(sharedText);
      window.androidSharedText = null;
    }

    // 2. Listen for warm-start shared text events
    const handleAndroidShare = (event) => {
      const sharedText = event.detail;
      if (sharedText) {
        setText(sharedText);
        saveToHistory(sharedText, "Shared Text");
        start(sharedText);
      }
    };

    window.addEventListener('androidShareText', handleAndroidShare);
    return () => {
      window.removeEventListener('androidShareText', handleAndroidShare);
    };
  }, [start, history]); // depends on start and history since it calls saveToHistory which references history

  const handleSelectHistoryItem = (item) => {
    setText(item.text);
    setActiveTab('read');
    // Wait a brief tick for state to update, then play
    setTimeout(() => {
      start(item.text);
    }, 100);
  };

  const handleDeleteHistoryItem = (id) => {
    const updated = history.filter(item => item.id !== id);
    setHistory(updated);
    localStorage.setItem('voxread_history', JSON.stringify(updated));
  };

  const handleFileUpload = async (file) => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const parsedText = await extractTextFromFile(file);
      if (!parsedText.trim()) {
        throw new Error('This file contains no extractable text.');
      }
      setText(parsedText);
      saveToHistory(parsedText, file.name);
      start(parsedText);
    } catch (err) {
      console.error(err);
      setError(err.message || 'An error occurred while reading the file.');
    } finally {
      setLoading(false);
    }
  };

  // Drag and drop handlers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  // Paste from clipboard handler
  const handlePasteClipboard = async () => {
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (clipboardText) {
        setText(clipboardText);
        saveToHistory(clipboardText);
        start(clipboardText);
      } else {
        setError("Clipboard is empty or permissions were denied.");
      }
    } catch (err) {
      setError("Unable to read from clipboard. Copy some text first, or paste manually.");
    }
  };

  // Clear input
  const handleClear = () => {
    setText('');
    stop();
    setError(null);
  };

  // Download the current text as an MP3 (Google Cloud TTS via the /api/tts proxy)
  const handleDownloadMp3 = async () => {
    if (!text.trim()) {
      setError('Please enter or upload some text before downloading audio.');
      return;
    }
    setError(null);
    setDownloading(true);
    try {
      const res = await fetch(`${TTS_API_BASE}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          languageCode: (selectedVoice && selectedVoice.lang) || 'en-US',
          // Map the app's slider ranges to Google's: rate 0.25–4, pitch -20–20.
          speakingRate: Math.min(4, Math.max(0.25, rate)),
          pitch: Math.min(20, Math.max(-20, (pitch - 1) * 20)),
        }),
      });
      if (!res.ok) {
        let msg = `Request failed (${res.status})`;
        try { const j = await res.json(); msg = j.error || msg; } catch { /* not JSON */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const base = (text.split('\n')[0].slice(0, 40).trim() || 'voxread').replace(/[^\w\- ]/g, '');
      a.download = `${base || 'voxread'}.mp3`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`MP3 download failed: ${e.message}. (Make sure the Google TTS key is set on the server.)`);
    } finally {
      setDownloading(false);
    }
  };

  // Start reading current text
  const handleStartRead = () => {
    if (!text.trim()) {
      setError("Please enter or upload some text to read.");
      return;
    }
    setError(null);
    saveToHistory(text);
    start(text);
  };

  // Filter voices by selected language
  const availableLanguages = Array.from(new Set(voices.map(v => v.lang.split('-')[0]))).sort();
  
  const filteredVoices = voices.filter(v => {
    if (selectedLangFilter === 'All') return true;
    return v.lang.startsWith(selectedLangFilter);
  });

  const getLanguageName = (langCode) => {
    try {
      const displayName = new Intl.DisplayNames([navigator.language], { type: 'language' });
      return displayName.of(langCode.split('-')[0]);
    } catch (e) {
      return langCode;
    }
  };

  // Word-by-word active sentence layout renderer
  const renderSentenceText = (sentenceText, isCurrent, wordRange) => {
    if (!isCurrent || wordRange.start === -1) {
      return <span>{sentenceText}</span>;
    }
    
    const startIdx = wordRange.start;
    const endIdx = wordRange.end;
    
    const before = sentenceText.substring(0, startIdx);
    const word = sentenceText.substring(startIdx, endIdx);
    const after = sentenceText.substring(endIdx);
    
    return (
      <span className="spoken-sentence font-semibold text-white">
        {before}
        <span className="highlighted-word text-white">{word}</span>
        {after}
      </span>
    );
  };

  return (
    <div className="min-h-screen flex flex-col items-center p-4 sm:p-6 lg:p-8">
      {/* Top Banner Header */}
      <header className="w-full max-w-6xl mb-8 flex items-center justify-between animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-500 to-blue-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight bg-gradient-to-r from-white via-purple-300 to-blue-300 bg-clip-text text-transparent">
              VoxRead AI
            </h1>
            <p className="text-xs text-gray-400 font-medium">Smart Multilingual Text-to-Speech</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 text-xs rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-semibold flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            Local Offline TTS
          </span>
        </div>
      </header>

      {/* Main Grid Layout */}
      <main className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-6 items-start flex-1 pb-28 lg:pb-0">
        {/* Left Column: Input and Settings */}
        <section className="lg:col-span-7 space-y-6">
          {/* Navigation Tabs */}
          <div className="flex bg-white/5 p-1 rounded-xl border border-white/5">
            <button
              onClick={() => setActiveTab('read')}
              className={`flex-1 py-2 px-4 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
                activeTab === 'read' 
                  ? 'bg-purple-600/80 text-white shadow-md shadow-purple-600/10' 
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              Reader Dashboard
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex-1 py-2 px-4 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
                activeTab === 'history' 
                  ? 'bg-purple-600/80 text-white shadow-md shadow-purple-600/10' 
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Clock className="w-4 h-4" />
              Saved Library ({history.length})
            </button>
          </div>

          {activeTab === 'read' ? (
            <div className="glass-panel p-5 sm:p-6 space-y-6">
              {/* File Drag/Drop & Clipboard */}
              <div 
                className={`relative border-2 border-dashed rounded-xl p-6 transition-colors text-center ${
                  dragActive 
                    ? 'border-purple-500 bg-purple-500/5' 
                    : 'border-white/10 hover:border-white/20 bg-black/20'
                }`}
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  id="file-upload"
                  className="hidden"
                  accept=".txt,.pdf,.docx"
                  onChange={(e) => handleFileUpload(e.target.files[0])}
                />
                
                <div className="flex flex-col items-center justify-center gap-2">
                  <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-2">
                    <Upload className="w-5 h-5 text-purple-400" />
                  </div>
                  <label htmlFor="file-upload" className="cursor-pointer">
                    <span className="text-purple-400 font-semibold hover:text-purple-300">Upload a document</span>
                    <span className="text-gray-400"> or drag and drop</span>
                  </label>
                  <p className="text-xs text-gray-500">Supports PDF, DOCX, TXT (Max 50MB)</p>
                </div>
              </div>

              {/* Text Input area */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-semibold text-gray-300">Text Content</span>
                  <div className="flex gap-2">
                    <button
                      onClick={handlePasteClipboard}
                      className="text-xs text-purple-400 font-semibold hover:text-purple-300 flex items-center gap-1.5"
                      title="Paste from Clipboard"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Paste Clipboard
                    </button>
                    {text && (
                      <button
                        onClick={handleClear}
                        className="text-xs text-gray-500 font-semibold hover:text-red-400 flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Clear
                      </button>
                    )}
                  </div>
                </div>
                
                <textarea
                  className="w-full h-48 glass-input resize-none"
                  placeholder="Paste or write your text here to begin reading..."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>

              {/* Error Message */}
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm font-medium">
                  {error}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleStartRead}
                  disabled={loading}
                  className="btn-primary flex-1 justify-center py-3 text-base"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      Processing File...
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5 fill-current" />
                      Load & Read Aloud
                    </>
                  )}
                </button>
                <button
                  onClick={handleDownloadMp3}
                  disabled={downloading || loading}
                  className="btn-secondary justify-center py-3 text-base whitespace-nowrap"
                  title="Generate and download an MP3 of this text"
                >
                  {downloading ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      Generating…
                    </>
                  ) : (
                    <>
                      <Download className="w-5 h-5" />
                      MP3
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="glass-panel p-5 sm:p-6">
              <h3 className="text-base font-bold text-gray-200 mb-4 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-purple-400" />
                Your Library
              </h3>
              <HistoryList 
                history={history}
                onSelect={handleSelectHistoryItem}
                onDelete={handleDeleteHistoryItem}
              />
            </div>
          )}

          {/* Voice configuration panel */}
          <div className="glass-panel p-5 sm:p-6 space-y-5">
            <h3 className="text-base font-bold text-gray-200 flex items-center gap-2 border-b border-white/5 pb-3">
              <Settings className="w-5 h-5 text-purple-400" />
              Voice Customization
            </h3>

            {/* TTS playback error */}
            {ttsError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm font-medium">
                {ttsError}
              </div>
            )}

            {/* No voices installed on this Android device */}
            {isNative && voices.length === 0 && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg space-y-3">
                <p className="text-amber-300 text-sm font-medium">
                  No speech voices were found on this device. Install the text-to-speech voice
                  data, then reopen the app.
                </p>
                <button
                  onClick={openVoiceInstall}
                  className="btn-primary w-full justify-center py-2.5 text-sm"
                >
                  <Volume2 className="w-4 h-4" />
                  Install voice data
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Language filter */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-400 flex items-center gap-1">
                  <Languages className="w-3.5 h-3.5" />
                  Language Filter
                </label>
                <select
                  className="w-full glass-input bg-zinc-900 border-white/10"
                  value={selectedLangFilter}
                  onChange={(e) => setSelectedLangFilter(e.target.value)}
                >
                  <option value="All">All Languages ({voices.length})</option>
                  {availableLanguages.map(lang => (
                    <option key={lang} value={lang}>
                      {getLanguageName(lang)} ({lang.toUpperCase()})
                    </option>
                  ))}
                </select>
              </div>

              {/* Voice select */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-400 flex items-center gap-1">
                  <Volume2 className="w-3.5 h-3.5" />
                  Choose Voice
                </label>
                <select
                  className="w-full glass-input bg-zinc-900 border-white/10"
                  value={selectedVoice ? selectedVoice.name : ''}
                  onChange={(e) => {
                    const voice = voices.find(v => v.name === e.target.value);
                    if (voice) setSelectedVoice(voice);
                  }}
                >
                  {filteredVoices.map(voice => (
                    <option key={voice.name} value={voice.name}>
                      {voice.name} {voice.localService ? '(Local)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Range sliders */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              {/* Speed Slider */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-semibold text-gray-400">
                  <span>Reading Speed</span>
                  <span className="text-purple-400 font-bold">{rate}x</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="3"
                  step="0.1"
                  className="custom-slider"
                  value={rate}
                  onChange={(e) => setRate(parseFloat(e.target.value))}
                />
              </div>

              {/* Pitch Slider */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-semibold text-gray-400">
                  <span>Voice Tone / Pitch</span>
                  <span className="text-purple-400 font-bold">{pitch}</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  className="custom-slider"
                  value={pitch}
                  onChange={(e) => setPitch(parseFloat(e.target.value))}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Right Column: Audio Player & Highlight Visualizer */}
        <section className="lg:col-span-5 glass-panel p-5 sm:p-6 space-y-6 lg:sticky lg:top-8">
          <div className="flex items-center justify-between border-b border-white/5 pb-3">
            <h3 className="text-base font-bold text-gray-200 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-purple-400" />
              Live Reader Player
            </h3>
            {isPlaying && (
              <span className="w-2.5 h-2.5 rounded-full bg-purple-500 shadow-[0_0_10px_#a855f7] animate-pulse"></span>
            )}
          </div>

          {/* Player controls (desktop; mobile uses the sticky bottom bar) */}
          <div className="hidden lg:flex flex-col items-center justify-center p-6 glass-card rounded-2xl gap-5">
            {/* Pulsing state visualizer */}
            <div className="flex justify-center items-center gap-1.5 h-12 w-full max-w-[200px]">
              {[...Array(9)].map((_, i) => (
                <div
                  key={i}
                  className="w-1.5 bg-gradient-to-t from-purple-500 to-blue-500 rounded-full transition-all duration-300"
                  style={{
                    height: isPlaying && !isPaused 
                      ? `${Math.max(10, Math.floor(Math.random() * 48))}px` 
                      : '8px',
                    animation: isPlaying && !isPaused ? `pulseHighlight 0.5s infinite alternate ${i * 0.08}s` : 'none'
                  }}
                ></div>
              ))}
            </div>

            {/* Audio controllers */}
            <div className="flex items-center gap-4">
              <button
                onClick={skipBackward}
                disabled={!isPlaying || currentSentenceIndex <= 0}
                className="w-10 h-10 rounded-xl hover:bg-white/5 flex items-center justify-center text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                title="Previous Sentence"
              >
                <SkipBack className="w-5 h-5" />
              </button>

              {isPlaying ? (
                isPaused ? (
                  <button
                    onClick={resume}
                    className="w-14 h-14 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-purple-500/20 hover:scale-105 transition-transform"
                    title="Play"
                  >
                    <Play className="w-6 h-6 fill-current" />
                  </button>
                ) : (
                  <button
                    onClick={pause}
                    className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center text-white border border-white/10 hover:bg-zinc-700 hover:scale-105 transition-transform"
                    title="Pause"
                  >
                    <Pause className="w-6 h-6 fill-current" />
                  </button>
                )
              ) : (
                <button
                  onClick={handleStartRead}
                  className="w-14 h-14 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-purple-500/20 hover:scale-105 transition-transform"
                  title="Start Reading"
                >
                  <Play className="w-6 h-6 fill-current" />
                </button>
              )}

              <button
                onClick={stop}
                disabled={!isPlaying}
                className="w-10 h-10 rounded-xl hover:bg-white/5 flex items-center justify-center text-gray-400 hover:text-red-400 disabled:opacity-30 disabled:hover:bg-transparent"
                title="Stop Player"
              >
                <Square className="w-5 h-5 fill-current" />
              </button>

              <button
                onClick={skipForward}
                disabled={!isPlaying || currentSentenceIndex >= sentences.length - 1}
                className="w-10 h-10 rounded-xl hover:bg-white/5 flex items-center justify-center text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                title="Next Sentence"
              >
                <SkipForward className="w-5 h-5" />
              </button>
            </div>

            {/* Reading details & progress bar */}
            {sentences.length > 0 && (
              <div className="w-full space-y-2 mt-2">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Progress</span>
                  <span>{currentSentenceIndex + 1} / {sentences.length} sentences</span>
                </div>
                <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-purple-500 to-blue-500 h-full transition-all duration-300"
                    style={{ width: `${((currentSentenceIndex + 1) / sentences.length) * 100}%` }}
                  ></div>
                </div>
              </div>
            )}
          </div>

          {/* Interactive highlighted document view */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
              <span>Text Playback Viewer</span>
              <span className="text-[10px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded font-normal lowercase">Click sentence to jump</span>
            </h4>
            
            <div ref={readerContainerRef} className="h-64 border border-white/5 bg-black/30 rounded-2xl p-4 overflow-y-auto reader-container">
              {sentences.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-500 text-sm font-medium text-center">
                  Playback text viewer is empty.<br/>Load some text to see highlights.
                </div>
              ) : (
                <div className="space-y-4">
                  {sentences.map((sentence, idx) => {
                    const isCurrent = idx === currentSentenceIndex;
                    return (
                      <span
                        key={idx}
                        ref={isCurrent ? activeSentenceRef : null}
                        onClick={() => jumpToSentence(idx)}
                        className={`inline-block cursor-pointer transition-colors leading-relaxed text-sm ${
                          isCurrent 
                            ? 'text-white bg-purple-500/10 p-1 rounded border border-purple-500/20' 
                            : 'text-gray-400 hover:text-gray-200'
                        }`}
                      >
                        {renderSentenceText(sentence, isCurrent, currentWordRange)}
                        {' '}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Mobile sticky player bar — controls are always reachable on phones */}
      {sentences.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 lg:hidden">
          <div className="mx-3 mb-3 glass-panel rounded-2xl px-4 pt-2.5 pb-3 shadow-2xl shadow-black/50">
            <div className="w-full bg-white/10 h-1 rounded-full overflow-hidden mb-2.5">
              <div
                className="bg-gradient-to-r from-purple-500 to-blue-500 h-full transition-all duration-300"
                style={{ width: `${((currentSentenceIndex + 1) / sentences.length) * 100}%` }}
              ></div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-gray-400 w-10 shrink-0">
                {currentSentenceIndex + 1}/{sentences.length}
              </span>
              <div className="flex items-center gap-4">
                <button
                  onClick={skipBackward}
                  disabled={!isPlaying || currentSentenceIndex <= 0}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-300 active:bg-white/10 disabled:opacity-30"
                  title="Previous sentence"
                >
                  <SkipBack className="w-5 h-5" />
                </button>
                {isPlaying && !isPaused ? (
                  <button
                    onClick={pause}
                    className="w-12 h-12 rounded-full bg-zinc-800 border border-white/10 flex items-center justify-center text-white"
                    title="Pause"
                  >
                    <Pause className="w-6 h-6 fill-current" />
                  </button>
                ) : (
                  <button
                    onClick={isPaused ? resume : handleStartRead}
                    className="w-12 h-12 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-purple-500/30"
                    title="Play"
                  >
                    <Play className="w-6 h-6 fill-current" />
                  </button>
                )}
                <button
                  onClick={skipForward}
                  disabled={!isPlaying || currentSentenceIndex >= sentences.length - 1}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-300 active:bg-white/10 disabled:opacity-30"
                  title="Next sentence"
                >
                  <SkipForward className="w-5 h-5" />
                </button>
              </div>
              <button
                onClick={stop}
                disabled={!isPlaying}
                className="w-10 shrink-0 flex items-center justify-end text-gray-400 active:text-red-400 disabled:opacity-30"
                title="Stop"
              >
                <Square className="w-5 h-5 fill-current" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

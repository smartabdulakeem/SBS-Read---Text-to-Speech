// Guard against double-injection (manifest content_scripts + chrome.scripting fallback)
(function () {
if (window.__voxreadLoaded) return;
window.__voxreadLoaded = true;

let ttsState = {
  isPlaying: false,
  isPaused: false,
  sentences: [],
  currentSentenceIdx: -1,
  voices: [],
  selectedVoice: null,
  rate: 1.0,
  pitch: 1.0,
  text: "",
  widgetElement: null,
  utterance: null
};

// ============================================================
// Auto-floating "Read Aloud" button on text selection
// ============================================================
let voxreadSelectionBtn = null;

function ensureSelectionButton() {
  if (voxreadSelectionBtn) return voxreadSelectionBtn;

  const btn = document.createElement('button');
  btn.className = 'voxread-select-btn voxread-hidden';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Read selected text aloud');
  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
    </svg>
    <span>Read Aloud</span>
  `;

  // Use mousedown so the click fires before the selection is cleared
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = window.getSelection().toString().trim();
    hideSelectionButton();
    if (text) initializeTTS(text);
  });

  document.body.appendChild(btn);
  voxreadSelectionBtn = btn;
  return btn;
}

function showSelectionButton() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    hideSelectionButton();
    return;
  }
  const text = sel.toString().trim();
  if (text.length < 2) {
    hideSelectionButton();
    return;
  }

  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    hideSelectionButton();
    return;
  }

  const btn = ensureSelectionButton();
  btn.classList.remove('voxread-hidden');

  // Position just above the selection, centered
  const btnWidth = 112;
  const btnHeight = 32;
  let top = rect.top - btnHeight - 8;
  let left = rect.left + (rect.width / 2) - (btnWidth / 2);

  // If too close to top of viewport, place below selection instead
  if (rect.top < btnHeight + 12) {
    top = rect.bottom + 8;
  }

  // Clamp horizontally inside viewport
  const maxLeft = document.documentElement.clientWidth - btnWidth - 8;
  if (left < 8) left = 8;
  if (left > maxLeft) left = maxLeft;

  btn.style.top = top + 'px';
  btn.style.left = left + 'px';
}

function hideSelectionButton() {
  if (voxreadSelectionBtn) voxreadSelectionBtn.classList.add('voxread-hidden');
}

// Show button after the user finishes selecting (mouseup / touch / keyboard)
document.addEventListener('mouseup', () => setTimeout(showSelectionButton, 10), true);
document.addEventListener('keyup', (e) => {
  // Shift+arrow keys = keyboard selection
  if (e.shiftKey || e.key === 'Shift') setTimeout(showSelectionButton, 10);
}, true);

// Hide on outside click / scroll / new selection start
document.addEventListener('mousedown', (e) => {
  if (voxreadSelectionBtn && e.target !== voxreadSelectionBtn && !voxreadSelectionBtn.contains(e.target)) {
    hideSelectionButton();
  }
}, true);
window.addEventListener('scroll', hideSelectionButton, true);

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "read-text") {
    const text = (request.text && request.text.trim())
      || window.getSelection().toString().trim();
    if (text) {
      initializeTTS(text);
    } else {
      alert("VoxRead AI: No text selected. Highlight some text first.");
    }
  } else if (request.action === "read-article") {
    const articleText = extractArticleText();
    if (articleText) {
      initializeTTS(articleText);
    } else {
      alert("VoxRead AI: Could not extract readable text from this page.");
    }
  }
});

// Extract main article text, avoiding nav, header, footer elements
function extractArticleText() {
  const selectionText = window.getSelection().toString().trim();
  if (selectionText) return selectionText;

  const mainSelectors = ['article', 'main', '[role="main"]', '.post', '.article', '.content', '.entry-content', '.post-content'];
  let mainContainer = null;
  
  for (const selector of mainSelectors) {
    const container = document.querySelector(selector);
    if (container) {
      mainContainer = container;
      break;
    }
  }
  
  if (!mainContainer) {
    mainContainer = document.body;
  }

  // Get paragraph and heading elements
  const textElements = mainContainer.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');
  const extractedChunks = [];
  
  textElements.forEach(el => {
    // Avoid hidden elements, sidebars, headers, footers, comment zones
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    
    if (
      el.closest('nav') || 
      el.closest('footer') || 
      el.closest('header') || 
      el.closest('.sidebar') || 
      el.closest('#sidebar') || 
      el.closest('.comments') || 
      el.closest('#comments') ||
      el.closest('.menu')
    ) {
      return;
    }
    
    const txt = el.innerText.trim();
    // Only add if it has meaningful content
    if (txt.length > 5) {
      extractedChunks.push(txt);
    }
  });

  return extractedChunks.join('\n\n');
}

// Split article text into sentences
function splitTextIntoSentences(text) {
  if (!text) return [];
  return text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 0);
}

// Load Web Speech API Voices
function loadVoices(callback) {
  let voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    ttsState.voices = voices;
    if (callback) callback();
  } else {
    window.speechSynthesis.onvoiceschanged = () => {
      ttsState.voices = window.speechSynthesis.getVoices();
      if (callback) callback();
    };
  }
}

// Setup floating player UI widget
function createWidget() {
  if (ttsState.widgetElement) return;

  const widget = document.createElement('div');
  widget.className = 'voxread-widget';
  
  widget.innerHTML = `
    <div class="voxread-header">
      <div class="voxread-title">VoxRead AI Player</div>
      <button class="voxread-close-btn" id="voxread-close">&times;</button>
    </div>
    <div class="voxread-body">
      <div class="voxread-progress-bar">
        <div class="voxread-progress-fill" id="voxread-progress"></div>
      </div>
      <div class="voxread-captions" id="voxread-captions">
        Ready to play.
      </div>
      <div class="voxread-controls">
        <button class="voxread-control-btn" id="voxread-prev" disabled>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line></svg>
        </button>
        <button class="voxread-control-btn btn-play-pause" id="voxread-play-pause">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" id="voxread-play-icon"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        </button>
        <button class="voxread-control-btn" id="voxread-stop" disabled>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect></svg>
        </button>
        <button class="voxread-control-btn" id="voxread-next" disabled>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>
        </button>
      </div>
      <div class="voxread-settings-row">
        <div class="voxread-slider-container">
          <span>Speed</span>
          <input type="range" class="voxread-slider" id="voxread-speed" min="0.5" max="2.5" step="0.1" value="1.0">
          <span id="voxread-speed-label">1x</span>
        </div>
        <select class="voxread-select" id="voxread-voice-select">
          <option>Loading voices...</option>
        </select>
      </div>
    </div>
  `;

  document.body.appendChild(widget);
  ttsState.widgetElement = widget;

  // Bind Events
  document.getElementById('voxread-close').onclick = closeWidget;
  document.getElementById('voxread-play-pause').onclick = togglePlayPause;
  document.getElementById('voxread-stop').onclick = stopTTS;
  document.getElementById('voxread-prev').onclick = playPrevSentence;
  document.getElementById('voxread-next').onclick = playNextSentence;
  
  const speedSlider = document.getElementById('voxread-speed');
  speedSlider.value = ttsState.rate;
  document.getElementById('voxread-speed-label').innerText = `${ttsState.rate}x`;
  
  speedSlider.oninput = (e) => {
    ttsState.rate = parseFloat(e.target.value);
    document.getElementById('voxread-speed-label').innerText = `${ttsState.rate}x`;
    saveExtensionSettings();
    // If speaking, adjust dynamically by restarting current sentence
    if (ttsState.isPlaying && !ttsState.isPaused) {
      speakSentence(ttsState.currentSentenceIdx);
    }
  };

  const voiceSelect = document.getElementById('voxread-voice-select');
  voiceSelect.onchange = (e) => {
    ttsState.selectedVoice = ttsState.voices.find(v => v.name === e.target.value);
    saveExtensionSettings();
    // Restart current sentence with the new voice
    if (ttsState.isPlaying && !ttsState.isPaused) {
      speakSentence(ttsState.currentSentenceIdx);
    }
  };

  // Drag-and-drop / movable widget logic (simple implementation)
  setupDraggableWidget(widget);
}

// Simple floating element positioning drag listener
function setupDraggableWidget(widget) {
  let isDragging = false;
  let offsetX, offsetY;

  const header = widget.querySelector('.voxread-header');
  header.style.cursor = 'move';

  header.onmousedown = (e) => {
    isDragging = true;
    offsetX = e.clientX - widget.getBoundingClientRect().left;
    offsetY = e.clientY - widget.getBoundingClientRect().top;
    
    document.onmousemove = (e) => {
      if (!isDragging) return;
      widget.style.bottom = 'auto';
      widget.style.right = 'auto';
      widget.style.left = (e.clientX - offsetX) + 'px';
      widget.style.top = (e.clientY - offsetY) + 'px';
    };

    document.onmouseup = () => {
      isDragging = false;
      document.onmousemove = null;
      document.onmouseup = null;
    };
  };
}

// Populate voices dropdown in the floating player
function populateVoiceDropdown() {
  const select = document.getElementById('voxread-voice-select');
  if (!select) return;

  select.innerHTML = '';
  
  // Sort voices by language
  const sorted = [...ttsState.voices].sort((a, b) => a.lang.localeCompare(b.lang));
  
  sorted.forEach(voice => {
    const opt = document.createElement('option');
    opt.value = voice.name;
    opt.innerText = `${voice.name} (${voice.lang.split('-')[0].toUpperCase()})`;
    if (ttsState.selectedVoice && voice.name === ttsState.selectedVoice.name) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

function saveExtensionSettings() {
  try {
    chrome.storage.local.set({
      voxread_voice: ttsState.selectedVoice ? ttsState.selectedVoice.name : null,
      voxread_rate: ttsState.rate,
      voxread_pitch: ttsState.pitch
    });
  } catch (e) {
    /* ignore background context issues */
  }
}

function initializeTTS(text) {
  if (!text || text.trim().length === 0) return;
  
  ttsState.text = text;
  ttsState.sentences = splitTextIntoSentences(text);
  ttsState.currentSentenceIdx = 0;
  
  createWidget();
  
  chrome.storage.local.get(['voxread_voice', 'voxread_rate', 'voxread_pitch'], (stored) => {
    if (stored.voxread_rate !== undefined) {
      ttsState.rate = parseFloat(stored.voxread_rate) || 1.0;
    }
    if (stored.voxread_pitch !== undefined) {
      ttsState.pitch = parseFloat(stored.voxread_pitch) || 1.0;
    }
    
    // Update speed slider and label in widget if created
    const speedSlider = document.getElementById('voxread-speed');
    if (speedSlider) {
      speedSlider.value = ttsState.rate;
      const label = document.getElementById('voxread-speed-label');
      if (label) label.innerText = `${ttsState.rate}x`;
    }

    loadVoices(() => {
      if (stored.voxread_voice && ttsState.voices.length > 0) {
        ttsState.selectedVoice = ttsState.voices.find(v => v.name === stored.voxread_voice);
      }
      
      // Set a default voice if none set
      if (!ttsState.selectedVoice && ttsState.voices.length > 0) {
        ttsState.selectedVoice = ttsState.voices.find(v => v.default) || 
                                 ttsState.voices.find(v => v.lang.startsWith(navigator.language.split('-')[0])) || 
                                 ttsState.voices[0];
      }
      populateVoiceDropdown();
      updateControls();
      startTTS();
    });
  });
}

function startTTS() {
  if (ttsState.sentences.length === 0) return;
  ttsState.isPlaying = true;
  ttsState.isPaused = false;
  speakSentence(0);
}

function speakSentence(idx) {
  if (idx < 0 || idx >= ttsState.sentences.length) {
    stopTTS();
    return;
  }

  window.speechSynthesis.cancel();
  ttsState.currentSentenceIdx = idx;
  updateProgress();
  updateControls();

  const sentenceText = ttsState.sentences[idx];
  const utterance = new SpeechSynthesisUtterance(sentenceText);
  ttsState.utterance = utterance;

  if (ttsState.selectedVoice) {
    utterance.voice = ttsState.selectedVoice;
  }
  utterance.rate = ttsState.rate;
  utterance.pitch = ttsState.pitch;

  // Render initial sentence text
  const captionEl = document.getElementById('voxread-captions');
  if (captionEl) {
    captionEl.innerHTML = `<span class="voxread-sentence-active">${sentenceText}</span>`;
  }

  // Active word-by-word highlights inside caption bar
  utterance.onboundary = (e) => {
    if (e.name === 'word' && captionEl) {
      const charIndex = e.charIndex;
      const textRest = sentenceText.substring(charIndex);
      const nextSpace = textRest.search(/\s/);
      const wordLength = nextSpace > -1 ? nextSpace : textRest.length;
      
      const before = sentenceText.substring(0, charIndex);
      const word = sentenceText.substring(charIndex, charIndex + wordLength);
      const after = sentenceText.substring(charIndex + wordLength);
      
      captionEl.innerHTML = `
        <span class="voxread-sentence-active">
          ${before}<span class="voxread-word-active">${word}</span>${after}
        </span>
      `;
    }
  };

  utterance.onend = () => {
    if (ttsState.isPlaying && !ttsState.isPaused) {
      const nextIdx = idx + 1;
      if (nextIdx < ttsState.sentences.length) {
        speakSentence(nextIdx);
      } else {
        stopTTS();
      }
    }
  };

  utterance.onerror = (e) => {
    if (e.error !== 'interrupted' && ttsState.isPlaying) {
      const nextIdx = idx + 1;
      speakSentence(nextIdx);
    }
  };

  window.speechSynthesis.speak(utterance);
}

function togglePlayPause() {
  if (!ttsState.isPlaying) {
    startTTS();
    return;
  }

  const playPauseBtn = document.getElementById('voxread-play-pause');
  
  if (ttsState.isPaused) {
    window.speechSynthesis.resume();
    ttsState.isPaused = false;
    updatePlayPauseButton(false);
  } else {
    window.speechSynthesis.pause();
    ttsState.isPaused = true;
    updatePlayPauseButton(true);
  }
}

function updatePlayPauseButton(showPlay) {
  const btn = document.getElementById('voxread-play-pause');
  if (!btn) return;

  if (showPlay) {
    btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
  } else {
    btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
  }
}

function stopTTS() {
  window.speechSynthesis.cancel();
  ttsState.isPlaying = false;
  ttsState.isPaused = false;
  ttsState.currentSentenceIdx = -1;
  
  const captionEl = document.getElementById('voxread-captions');
  if (captionEl) {
    captionEl.innerHTML = "Playback stopped.";
  }
  
  updateControls();
  updateProgress();
  updatePlayPauseButton(true);
}

function playPrevSentence() {
  if (ttsState.currentSentenceIdx > 0) {
    speakSentence(ttsState.currentSentenceIdx - 1);
  }
}

function playNextSentence() {
  if (ttsState.currentSentenceIdx < ttsState.sentences.length - 1) {
    speakSentence(ttsState.currentSentenceIdx + 1);
  }
}

function updateProgress() {
  const fill = document.getElementById('voxread-progress');
  if (!fill) return;
  
  if (ttsState.currentSentenceIdx === -1 || ttsState.sentences.length === 0) {
    fill.style.width = '0%';
  } else {
    const pct = ((ttsState.currentSentenceIdx + 1) / ttsState.sentences.length) * 100;
    fill.style.width = `${pct}%`;
  }
}

function updateControls() {
  const prevBtn = document.getElementById('voxread-prev');
  const nextBtn = document.getElementById('voxread-next');
  const stopBtn = document.getElementById('voxread-stop');

  if (prevBtn) prevBtn.disabled = !ttsState.isPlaying || ttsState.currentSentenceIdx <= 0;
  if (nextBtn) nextBtn.disabled = !ttsState.isPlaying || ttsState.currentSentenceIdx >= ttsState.sentences.length - 1;
  if (stopBtn) stopBtn.disabled = !ttsState.isPlaying;

  updatePlayPauseButton(!ttsState.isPlaying || ttsState.isPaused);
}

function closeWidget() {
  stopTTS();
  if (ttsState.widgetElement) {
    ttsState.widgetElement.remove();
    ttsState.widgetElement = null;
  }
}

})();

const state = {
    home: 0,
    away: 0,
    isListening: false
};

const elements = {
    homeScore: document.getElementById('home-score'),
    awayScore: document.getElementById('away-score'),
    homePlus: document.getElementById('home-plus'),
    homeMinus: document.getElementById('home-minus'),
    awayPlus: document.getElementById('away-plus'),
    awayMinus: document.getElementById('away-minus'),
    resetBtn: document.getElementById('reset-btn'),
    startBtn: document.getElementById('start-btn'),
    overlay: document.getElementById('overlay'),
    listeningIndicator: document.getElementById('listening-indicator')
};

// Initialize State from LocalStorage
function init() {
    const saved = localStorage.getItem('scoretracker_state');
    if (saved) {
        const parsed = JSON.parse(saved);
        state.home = parsed.home || 0;
        state.away = parsed.away || 0;
        updateUI();
    }
}

function save() {
    localStorage.setItem('scoretracker_state', JSON.stringify({
        home: state.home,
        away: state.away
    }));
}

function updateUI() {
    elements.homeScore.textContent = state.home;
    elements.awayScore.textContent = state.away;

    // Add visual feedback
    elements.homeScore.classList.add('bump');
    elements.awayScore.classList.add('bump');
    setTimeout(() => {
        elements.homeScore.classList.remove('bump');
        elements.awayScore.classList.remove('bump');
    }, 200);
}

function changeScore(side, delta) {
    state[side] = Math.max(0, state[side] + delta);
    updateUI();
    save();
}

// Speech Recognition (Vosk — runs fully on-device via WASM, no cloud calls,
// so it keeps working with zero connectivity once the model is cached).
const VOSK_MODEL_URL = 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz';
const VOICE_GRAMMAR = JSON.stringify(['point home', 'point away', 'end match', '[unk]']);

let voskModel = null;
let recognizer = null;
let audioContext = null;
let micStream = null;
let scriptProcessor = null;
let voiceStatus = 'loading'; // loading | ready | listening | unavailable

function setVoiceStatus(status) {
    voiceStatus = status;
    const labels = {
        loading: 'Voice: loading model…',
        ready: 'Voice ready',
        listening: 'Listening...',
        unavailable: 'Voice unavailable — use buttons'
    };
    elements.listeningIndicator.textContent = labels[status] || '';

    const note = document.getElementById('voice-model-note');
    if (note) {
        if (status === 'ready') {
            note.textContent = 'Voice model ready — works fully offline.';
        } else if (status === 'unavailable') {
            note.textContent = 'Voice model unavailable (need internet once to download it). Buttons still work offline.';
        } else if (status === 'loading') {
            note.textContent = 'Voice recognition runs fully on-device (Vosk). Downloading ~40MB model — needs internet for this one-time download, then works offline.';
        }
    }
}

async function loadVoiceModel() {
    if (typeof Vosk === 'undefined') {
        console.warn('Vosk library failed to load (offline on first visit?)');
        setVoiceStatus('unavailable');
        return;
    }
    try {
        voskModel = await Vosk.createModel(VOSK_MODEL_URL);
    } catch (e) {
        console.error('Vosk model load failed:', e);
        setVoiceStatus('unavailable');
        return;
    }
    setVoiceStatus(state.isListening ? 'loading' : 'ready');
    if (state.isListening) {
        startVoiceRecognition();
    }
}

async function startVoiceRecognition() {
    if (!voskModel || recognizer) return;

    try {
        micStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
        });
    } catch (e) {
        console.error('Microphone access denied:', e);
        setVoiceStatus('unavailable');
        return;
    }

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(micStream);

    recognizer = new voskModel.KaldiRecognizer(audioContext.sampleRate, VOICE_GRAMMAR);
    recognizer.on('result', (message) => {
        const text = (message.result.text || '').toLowerCase();
        if (!text) return;
        console.log('Voice result:', text);

        if (text.includes('point home')) {
            changeScore('home', 1);
            triggerFlash();
        } else if (text.includes('point away')) {
            changeScore('away', 1);
            triggerFlash();
        } else if (text.includes('end match')) {
            endMatch();
            triggerFlash();
        }
    });

    scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    scriptProcessor.onaudioprocess = (event) => {
        try {
            recognizer.acceptWaveform(event.inputBuffer);
        } catch (e) {
            console.error('acceptWaveform failed:', e);
        }
    };
    source.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);

    setVoiceStatus('listening');
}

function stopVoiceRecognition() {
    if (scriptProcessor) {
        scriptProcessor.disconnect();
        scriptProcessor = null;
    }
    if (recognizer) {
        recognizer.remove();
        recognizer = null;
    }
    if (micStream) {
        micStream.getTracks().forEach((track) => track.stop());
        micStream = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    setVoiceStatus(voskModel ? 'ready' : 'unavailable');
}

function triggerFlash() {
    document.body.classList.add('flash-active');
    setTimeout(() => {
        document.body.classList.remove('flash-active');
    }, 300);
}

// Installation Logic
let deferredPrompt;
const installBtn = document.getElementById('install-btn');

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.style.display = 'block';
});

installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to the install prompt: ${outcome}`);
        deferredPrompt = null;
        installBtn.style.display = 'none';
    }
});

function startMatch() {
    console.log('Starting match...');
    state.isListening = true;
    elements.overlay.style.display = 'none';
    elements.listeningIndicator.style.display = 'flex';

    if (voskModel) {
        startVoiceRecognition();
    } else {
        setVoiceStatus('loading');
    }
}

function endMatch() {
    console.log('Ending match manually.');
    state.isListening = false;
    elements.overlay.style.display = 'flex';
    elements.listeningIndicator.style.display = 'none';

    stopVoiceRecognition();
}

// Event Listeners
elements.homePlus.addEventListener('click', () => changeScore('home', 1));
elements.homeMinus.addEventListener('click', () => changeScore('home', -1));
elements.awayPlus.addEventListener('click', () => changeScore('away', 1));
elements.awayMinus.addEventListener('click', () => changeScore('away', -1));

elements.resetBtn.addEventListener('click', () => {
    if (confirm('Reset scores?')) {
        state.home = 0;
        state.away = 0;
        updateUI();
        save();
    }
});

elements.startBtn.addEventListener('click', startMatch);
elements.startBtn.addEventListener('pointerup', (e) => {
    e.preventDefault();
    startMatch();
});

const endMatchBtn = document.getElementById('end-match-btn');
const handleEndMatch = (e) => {
    if (e) e.preventDefault();
    endMatch();
};
endMatchBtn.addEventListener('click', handleEndMatch);
endMatchBtn.addEventListener('pointerup', handleEndMatch);

// Fullscreen Logic
const fullscreenBtn = document.getElementById('fullscreen-btn');
fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.error(`Error attempting to enable full-screen mode: ${err.message}`);
        });
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
});

// Init call
init();
loadVoiceModel();

const TEAM_LABELS = { home: 'Blue', away: 'Red' };
const WIN_SCORE = 11;
const WIN_MARGIN = 2;

const state = {
    home: 0,
    away: 0,
    isListening: false,
    gameOver: false
};

// Snapshots of {home, away, gameOver} taken before every change, so any
// mistake (wrong team, wrong word, accidental win) can be undone.
const MAX_HISTORY = 50;
let history = [];

const elements = {
    homeScore: document.getElementById('home-score'),
    awayScore: document.getElementById('away-score'),
    homePlus: document.getElementById('home-plus'),
    homeMinus: document.getElementById('home-minus'),
    awayPlus: document.getElementById('away-plus'),
    awayMinus: document.getElementById('away-minus'),
    undoBtn: document.getElementById('undo-btn'),
    resetBtn: document.getElementById('reset-btn'),
    startBtn: document.getElementById('start-btn'),
    overlay: document.getElementById('overlay'),
    listeningIndicator: document.getElementById('listening-indicator'),
    winnerBanner: document.getElementById('winner-banner')
};

// Initialize State from LocalStorage
function init() {
    const saved = localStorage.getItem('scoretracker_state');
    if (saved) {
        const parsed = JSON.parse(saved);
        state.home = parsed.home || 0;
        state.away = parsed.away || 0;
        state.gameOver = !!parsed.gameOver;
        history = Array.isArray(parsed.history) ? parsed.history : [];
        updateUI();
        if (state.gameOver) {
            showWinnerBanner(state.home > state.away ? 'home' : 'away');
        }
    }
}

function save() {
    localStorage.setItem('scoretracker_state', JSON.stringify({
        home: state.home,
        away: state.away,
        gameOver: state.gameOver,
        history
    }));
}

function pushHistory() {
    history.push({ home: state.home, away: state.away, gameOver: state.gameOver });
    if (history.length > MAX_HISTORY) history.shift();
}

function undo() {
    const previous = history.pop();
    if (!previous) return false;
    state.home = previous.home;
    state.away = previous.away;
    state.gameOver = previous.gameOver;
    if (state.gameOver) {
        showWinnerBanner(state.home > state.away ? 'home' : 'away');
    } else {
        hideWinnerBanner();
        if ('speechSynthesis' in window) speechSynthesis.cancel();
    }
    updateUI();
    save();
    return true;
}

function updateUI() {
    elements.homeScore.textContent = state.home;
    elements.awayScore.textContent = state.away;
    elements.undoBtn.disabled = history.length === 0;

    // Add visual feedback
    elements.homeScore.classList.add('bump');
    elements.awayScore.classList.add('bump');
    setTimeout(() => {
        elements.homeScore.classList.remove('bump');
        elements.awayScore.classList.remove('bump');
    }, 200);
}

function changeScore(side, delta) {
    if (state.gameOver) return;

    pushHistory();
    state[side] = Math.max(0, state[side] + delta);
    updateUI();
    save();

    if (delta > 0) {
        playPointSound();
        checkForWin();
    }
}

function checkForWin() {
    const leader = state.home > state.away ? 'home' : state.away > state.home ? 'away' : null;
    if (!leader) return;

    const leaderScore = state[leader];
    const otherScore = leader === 'home' ? state.away : state.home;

    if (leaderScore >= WIN_SCORE && leaderScore - otherScore >= WIN_MARGIN) {
        state.gameOver = true;
        save();
        // Mic stays on after a win so "undo" still works if the win was a mistake.
        playWinSound();
        announceWinner(TEAM_LABELS[leader]);
        showWinnerBanner(leader);
    }
}

function showWinnerBanner(side) {
    elements.winnerBanner.textContent = `${TEAM_LABELS[side]} Wins!`;
    elements.winnerBanner.className = side === 'home' ? 'winner-blue' : 'winner-red';
    elements.winnerBanner.hidden = false;
}

function hideWinnerBanner() {
    elements.winnerBanner.hidden = true;
    elements.winnerBanner.className = '';
}

// Sound Effects (Web Audio API — synthesized, no audio files needed, fully offline)
let sfxContext = null;

function getSfxContext() {
    if (!sfxContext) {
        sfxContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (sfxContext.state === 'suspended') {
        sfxContext.resume();
    }
    return sfxContext;
}

function playTone(freq, duration, type, gain, delay) {
    const ctx = getSfxContext();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    const startTime = ctx.currentTime + (delay || 0);
    gainNode.gain.setValueAtTime(gain, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration / 1000);
    osc.start(startTime);
    osc.stop(startTime + duration / 1000 + 0.02);
}

function playPointSound() {
    // Quick ascending two-note chime on every point scored.
    playTone(523.25, 100, 'sine', 0.25, 0);    // C5
    playTone(659.25, 120, 'sine', 0.25, 0.08); // E5
}

function playWinSound() {
    // Ascending fanfare for match point.
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, i) => playTone(freq, 220, 'triangle', 0.3, i * 0.15));
}

function announceWinner(teamLabel) {
    if (!('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(`${teamLabel} wins!`);
    utterance.rate = 1;
    utterance.pitch = 1;
    setTimeout(() => speechSynthesis.speak(utterance), 700);
}

// Speech Recognition (Vosk — runs fully on-device via WASM, no cloud calls,
// so it keeps working with zero connectivity once the model is cached).
const VOSK_MODEL_URL = 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz';
const VOICE_GRAMMAR = JSON.stringify(['point blue', 'point red', 'undo point', 'end match', '[unk]']);

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

        if (text.includes('undo point')) {
            if (undo()) triggerFlash();
        } else if (text.includes('point blue')) {
            changeScore('home', 1);
            triggerFlash();
        } else if (text.includes('point red')) {
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
    if (state.gameOver) {
        // Previous game finished: Start Match means a fresh game, not the old banner.
        state.home = 0;
        state.away = 0;
        state.gameOver = false;
        history = [];
        hideWinnerBanner();
        updateUI();
        save();
    }
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

elements.undoBtn.addEventListener('click', undo);

elements.resetBtn.addEventListener('click', () => {
    if (confirm('Reset scores?')) {
        pushHistory();
        state.home = 0;
        state.away = 0;
        state.gameOver = false;
        hideWinnerBanner();
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

// Force-refresh: drop the service worker and caches, then reload from network.
// Checks connectivity first so going offline can't leave the app with no cache.
async function refreshApp() {
    const btn = document.getElementById('refresh-btn');
    btn.disabled = true;
    btn.textContent = 'Updating...';
    try {
        const probe = await fetch('index.html', { cache: 'no-store' });
        if (!probe.ok) throw new Error('HTTP ' + probe.status);
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map((r) => r.unregister()));
        }
        if (window.caches) {
            const names = await caches.keys();
            await Promise.all(names.map((n) => caches.delete(n)));
        }
        window.location.reload();
    } catch (e) {
        console.error('Refresh failed:', e);
        btn.disabled = false;
        btn.textContent = 'Update failed — need internet';
        setTimeout(() => { btn.textContent = 'Update App'; }, 3000);
    }
}
document.getElementById('refresh-btn').addEventListener('click', refreshApp);

// Init call
init();
loadVoiceModel();

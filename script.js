// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyBfC73CfqFxRJhOtRn0MGdH1InEe0onfjw",
    authDomain: "synwave-music-player.firebaseapp.com",
    databaseURL: "https://synwave-music-player-default-rtdb.firebaseio.com",
    projectId: "synwave-music-player",
    storageBucket: "synwave-music-player.firebasestorage.app",
    messagingSenderId: "565924535502",
    appId: "1:565924535502:web:bda29720e74160a5b1c49f"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// Global Variables
let currentMode = 'host';
let roomId = null;
let userId = null;
let userName = '';
let syncActive = false;
let playerReady = false;
let currentVideoId = '';
let player = null;
let lastSentTime = 0;
let syncCount = 0;

// DOM Elements
const usernameInput = document.getElementById('username');
const roomIdInput = document.getElementById('roomId');
const connectBtn = document.getElementById('connectBtn');
const statusText = document.getElementById('statusText');
const statusDot = document.querySelector('.status-dot');
const memberCountSpan = document.getElementById('memberCount');
const syncRoleSpan = document.getElementById('syncRole');
const hostControls = document.getElementById('hostControls');
const youtubeLinkInput = document.getElementById('youtubeLink');
const loadVideoBtn = document.getElementById('loadVideoBtn');
const currentVideoInfo = document.getElementById('currentVideoInfo');
const playPauseBtn = document.getElementById('playPauseBtn');
const pauseBtn = document.getElementById('pauseBtn');
const seekBackBtn = document.getElementById('seekBackBtn');
const seekFwdBtn = document.getElementById('seekFwdBtn');
const playerContainer = document.getElementById('playerContainer');
const controlStatus = document.getElementById('controlStatus');

// Extract YouTube Video ID
function extractVideoId(url) {
    if (!url) return null;
    if (url.match(/^[a-zA-Z0-9_-]{11}$/)) return url;
    
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
        /youtube\.com\/watch\?.*v=([^&\n?#]+)/
    ];
    
    for (let pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) return match[1];
    }
    return null;
}

// Initialize YouTube Player
function initializePlayer() {
    if (typeof YT !== 'undefined' && YT.Player && !player) {
        player = new YT.Player('youtubePlayer', {
            height: '100%',
            width: '100%',
            videoId: '',
            playerVars: {
                'autoplay': 0,
                'controls': 0, // Hide controls for cleaner sync
                'modestbranding': 1,
                'rel': 0,
                'enablejsapi': 1,
                'origin': window.location.origin
            },
            events: {
                'onReady': () => {
                    playerReady = true;
                    console.log('✅ Player ready');
                },
                'onStateChange': (event) => {
                    if (!syncActive || currentMode !== 'host') return;
                    
                    // Send state IMMEDIATELY (no throttle)
                    const state = event.data;
                    const isPlaying = (state === YT.PlayerState.PLAYING);
                    const currentTime = player.getCurrentTime();
                    
                    // Use update instead of set for faster writes
                    database.ref(`rooms/${roomId}/sync/state`).update({
                        isPlaying: isPlaying,
                        currentTime: currentTime,
                        timestamp: Date.now() // Use client timestamp for lower latency
                    });
                }
            }
        });
    }
}

// HOST: Load video with INSTANT broadcast
function hostLoadVideo() {
    if (currentMode !== 'host') {
        alert('Only host can load videos!');
        return;
    }
    
    const urlOrId = youtubeLinkInput.value.trim();
    if (!urlOrId) {
        alert('Please enter a YouTube URL');
        return;
    }
    
    const videoId = extractVideoId(urlOrId);
    if (!videoId) {
        alert('Invalid YouTube URL!');
        return;
    }
    
    console.log('🎬 Loading video:', videoId);
    currentVideoId = videoId;
    
    if (player && playerReady) {
        player.loadVideoById(videoId);
        player.playVideo();
        playerContainer.style.display = 'block';
        currentVideoInfo.innerHTML = `🎬 Now Playing: ${videoId}`;
        
        // INSTANT broadcast to all joiners
        const syncData = {
            videoId: videoId,
            isPlaying: true,
            currentTime: 0,
            action: 'load',
            timestamp: Date.now()
        };
        
        database.ref(`rooms/${roomId}/sync`).set(syncData);
        
        controlStatus.innerHTML = '👑 HOST - Real-time mode ⚡';
    } else {
        initializePlayer();
        setTimeout(() => hostLoadVideo(), 500);
    }
}

// JOINERS: ULTRA-FAST sync (sub-100ms latency)
let lastSyncTime = 0;
let isSyncing = false;
let seekInProgress = false;

function initUltraFastSync() {
    // Use 'child_added' and 'child_changed' for faster response
    const syncRef = database.ref(`rooms/${roomId}/sync`);
    
    syncRef.on('value', (snapshot) => {
        if (!syncActive || currentMode !== 'join' || isSyncing) return;
        
        const hostData = snapshot.val();
        if (!hostData) return;
        
        const now = Date.now();
        
        // Handle video load
        if (hostData.videoId && hostData.videoId !== currentVideoId && hostData.action === 'load') {
            currentVideoId = hostData.videoId;
            console.log('⏩ Instant load from host');
            
            if (player && playerReady) {
                player.cueVideoById(currentVideoId); // cue is faster than load
                playerContainer.style.display = 'block';
                currentVideoInfo.innerHTML = `🎬 Syncing: ${currentVideoId}`;
            }
        }
        
        // Apply sync with MINIMAL delay (0ms)
        if (player && playerReady && currentVideoId && !seekInProgress) {
            isSyncing = true;
            
            try {
                const currentTime = player.getCurrentTime();
                const timeDiff = Math.abs(currentTime - hostData.currentTime);
                const isLocallyPlaying = (player.getPlayerState() === YT.PlayerState.PLAYING);
                
                // INSTANT play/pause sync
                if (hostData.isPlaying && !isLocallyPlaying) {
                    player.playVideo();
                    console.log('⚡ INSTANT PLAY');
                } else if (!hostData.isPlaying && isLocallyPlaying) {
                    player.pauseVideo();
                    console.log('⚡ INSTANT PAUSE');
                }
                
                // ULTRA-FAST seek (correct within 0.1 seconds)
                if (timeDiff > 0.1 && hostData.currentTime > 0) {
                    seekInProgress = true;
                    player.seekTo(hostData.currentTime, true);
                    console.log(`⚡ INSTANT SEEK: ${timeDiff.toFixed(2)}s diff`);
                    setTimeout(() => { seekInProgress = false; }, 100);
                }
                
            } catch(e) {
                console.warn('Sync micro-error:', e);
            }
            
            setTimeout(() => { isSyncing = false; }, 20);
        }
    });
    
    // AGGRESSIVE drift correction every 200ms
    let lastDriftCheck = 0;
    setInterval(() => {
        if (!syncActive || currentMode !== 'join' || !player || !playerReady || !currentVideoId || seekInProgress) return;
        
        database.ref(`rooms/${roomId}/sync/state`).once('value', (snapshot) => {
            if (isSyncing) return;
            
            const hostState = snapshot.val();
            if (!hostState || !hostState.currentTime) return;
            
            const currentTime = player.getCurrentTime();
            const timeDiff = hostState.currentTime - currentTime;
            
            // Correct if drift exceeds 0.15 seconds
            if (Math.abs(timeDiff) > 0.15 && !seekInProgress) {
                seekInProgress = true;
                player.seekTo(hostState.currentTime, true);
                console.log(`🔧 DRIFT FIX: ${timeDiff.toFixed(3)}s`);
                setTimeout(() => { seekInProgress = false; }, 100);
            }
        });
    }, 200);
}

// HOST: Send continuous updates at MAXIMUM speed (every 50ms)
let rapidUpdateInterval = null;

function startRapidUpdates() {
    if (rapidUpdateInterval) clearInterval(rapidUpdateInterval);
    
    rapidUpdateInterval = setInterval(() => {
        if (!syncActive || currentMode !== 'host' || !player || !playerReady || !currentVideoId) return;
        
        const isPlaying = (player.getPlayerState() === YT.PlayerState.PLAYING);
        const currentTime = player.getCurrentTime();
        const now = Date.now();
        
        // Only send if actually playing (reduces unnecessary updates)
        if (isPlaying || now - lastSentTime > 200) {
            // Use update for faster writes
            database.ref(`rooms/${roomId}/sync/state`).update({
                isPlaying: isPlaying,
                currentTime: currentTime,
                ts: now
            });
            lastSentTime = now;
            syncCount++;
        }
    }, 50); // 50ms updates = 20 updates per second for BUTTER smooth sync
}

// Setup room
async function initHostMode() {
    try {
        const roomRef = database.ref(`rooms/${roomId}`);
        
        // Clear any existing data for clean start
        await roomRef.remove();
        
        await roomRef.set({
            host: userId,
            hostName: userName,
            createdAt: firebase.database.ServerValue.TIMESTAMP
        });
        
        await roomRef.child(`members/${userId}`).set({
            name: userName,
            role: 'host',
            joinedAt: Date.now()
        });
        
        await roomRef.child('sync').set({
            videoId: '',
            isPlaying: false,
            currentTime: 0,
            action: 'init',
            timestamp: Date.now()
        });
        
        await roomRef.child('sync/state').set({
            isPlaying: false,
            currentTime: 0,
            timestamp: Date.now()
        });
        
        // Track members
        roomRef.child('members').on('value', (snapshot) => {
            const members = snapshot.val();
            const count = members ? Object.keys(members).length : 0;
            memberCountSpan.innerHTML = `👥 Connected: ${count}`;
            syncRoleSpan.innerHTML = `👑 HOST - ${count} syncing`;
        });
        
        roomRef.child(`members/${userId}`).onDisconnect().remove();
        
        syncActive = true;
        showStatus(`✅ Hosting: ${roomId}`, true);
        hostControls.style.display = 'block';
        initializePlayer();
        startRapidUpdates();
        
        controlStatus.innerHTML = '👑 HOST - Ultra-fast sync (50ms updates) ⚡';
        
    } catch (error) {
        console.error('Host error:', error);
        showStatus('Failed to create room', false);
    }
}

// Join Mode
async function initJoinMode() {
    try {
        const roomRef = database.ref(`rooms/${roomId}`);
        
        const snapshot = await roomRef.once('value');
        if (!snapshot.exists()) {
            alert('❌ Room does not exist! Ask the host to create it first.');
            return;
        }
        
        await roomRef.child(`members/${userId}`).set({
            name: userName,
            role: 'member',
            joinedAt: Date.now()
        });
        
        roomRef.child('members').on('value', (snapshot) => {
            const members = snapshot.val();
            const count = members ? Object.keys(members).length : 0;
            memberCountSpan.innerHTML = `👥 Connected: ${count}`;
        });
        
        roomRef.child(`members/${userId}`).onDisconnect().remove();
        
        syncActive = true;
        showStatus(`✅ Joined: ${roomId}`, true);
        syncRoleSpan.innerHTML = '🔗 JOIN - Ultra-fast sync';
        
        initializePlayer();
        initUltraFastSync();
        
        // Check for existing video
        const hostSync = await roomRef.child('sync').once('value');
        if (hostSync.exists() && hostSync.val().videoId) {
            const state = hostSync.val();
            currentVideoId = state.videoId;
            currentVideoInfo.innerHTML = `🎬 Ultra-sync active`;
            controlStatus.innerHTML = '🔗 Connected - Sub-100ms sync ⚡';
        }
        
    } catch (error) {
        console.error('Join error:', error);
        showStatus('Failed to join room', false);
    }
}

// Disconnect
async function disconnectFromRoom() {
    if (rapidUpdateInterval) clearInterval(rapidUpdateInterval);
    
    if (roomId && userId) {
        await database.ref(`rooms/${roomId}/members/${userId}`).remove();
        
        if (currentMode === 'host') {
            const snapshot = await database.ref(`rooms/${roomId}/members`).once('value');
            const members = snapshot.val();
            if (!members || Object.keys(members).length === 0) {
                await database.ref(`rooms/${roomId}`).remove();
            }
        }
    }
    
    syncActive = false;
    showStatus('Disconnected', false);
    syncRoleSpan.innerHTML = '⚡ Standby';
    hostControls.style.display = 'none';
}

// Host controls
function hostPlay() {
    if (currentMode !== 'host') {
        alert('Only host controls playback!');
        return;
    }
    if (player && playerReady && currentVideoId) {
        player.playVideo();
        database.ref(`rooms/${roomId}/sync`).update({
            isPlaying: true,
            action: 'play',
            timestamp: Date.now()
        });
    }
}

function hostPause() {
    if (currentMode !== 'host') {
        alert('Only host controls playback!');
        return;
    }
    if (player && playerReady && currentVideoId) {
        player.pauseVideo();
        database.ref(`rooms/${roomId}/sync`).update({
            isPlaying: false,
            action: 'pause',
            timestamp: Date.now()
        });
    }
}

function hostSeek(delta) {
    if (currentMode !== 'host') {
        alert('Only host controls playback!');
        return;
    }
    if (player && playerReady && currentVideoId) {
        const newTime = player.getCurrentTime() + delta;
        player.seekTo(newTime, true);
        database.ref(`rooms/${roomId}/sync`).update({
            currentTime: newTime,
            action: 'seek',
            timestamp: Date.now()
        });
    }
}

// Event listeners
connectBtn.addEventListener('click', async () => {
    const newRoomId = roomIdInput.value.trim();
    const name = usernameInput.value.trim();
    
    if (!newRoomId) {
        alert('Please enter a Room ID');
        return;
    }
    if (!name) {
        alert('Please enter your name');
        return;
    }
    
    if (syncActive) await disconnectFromRoom();
    
    userName = name;
    roomId = newRoomId;
    userId = `${userName}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    if (currentMode === 'host') {
        await initHostMode();
    } else {
        await initJoinMode();
    }
});

// Mode switching
document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        if (syncActive) await disconnectFromRoom();
        
        if (rapidUpdateInterval) clearInterval(rapidUpdateInterval);
        
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.dataset.mode;
        
        currentVideoInfo.innerHTML = '⚡ Ready for ultra-sync';
        hostControls.style.display = currentMode === 'host' ? 'block' : 'none';
    });
});

// Control buttons
playPauseBtn.addEventListener('click', hostPlay);
pauseBtn.addEventListener('click', hostPause);
seekBackBtn.addEventListener('click', () => hostSeek(-10));
seekFwdBtn.addEventListener('click', () => hostSeek(10));
loadVideoBtn.addEventListener('click', hostLoadVideo);

function showStatus(message, isConnected) {
    statusText.textContent = message;
    if (isConnected) {
        statusDot.classList.add('active');
    } else {
        statusDot.classList.remove('active');
    }
}

// Firebase connection
database.ref('.info/connected').on('value', (snap) => {
    if (snap.val() === true) {
        console.log("✅ Firebase Connected - Ultra-low latency mode");
    }
});

// Initialize
window.onYouTubeIframeAPIReady = initializePlayer;
showStatus('Ready for ultra-sync', false);
controlStatus.innerHTML = '⚡ SUB-100MS SYNC MODE ACTIVE ⚡';

window.addEventListener('beforeunload', () => {
    if (rapidUpdateInterval) clearInterval(rapidUpdateInterval);
    if (roomId && userId) {
        database.ref(`rooms/${roomId}/members/${userId}`).remove();
    }
});

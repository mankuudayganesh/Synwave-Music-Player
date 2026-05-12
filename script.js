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
let lastSyncTime = 0;
let syncCheckInterval = null;

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

// Initialize YouTube Player with optimized settings
function initializePlayer() {
    if (typeof YT !== 'undefined' && YT.Player && !player) {
        player = new YT.Player('youtubePlayer', {
            height: '100%',
            width: '100%',
            videoId: '',
            playerVars: {
                'autoplay': 0,
                'controls': 1,
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
                    
                    // Throttle updates to every 100ms max
                    const now = Date.now();
                    if (now - lastSyncTime < 50) return;
                    lastSyncTime = now;
                    
                    const state = event.data;
                    const isPlaying = (state === YT.PlayerState.PLAYING);
                    const currentTime = player.getCurrentTime();
                    
                    // Send immediate update
                    database.ref(`rooms/${roomId}/sync/hostState`).set({
                        isPlaying: isPlaying,
                        currentTime: currentTime,
                        videoId: currentVideoId,
                        timestamp: firebase.database.ServerValue.TIMESTAMP
                    });
                },
                'onPlaybackQualityChange': () => {},
                'onPlaybackRateChange': () => {}
            }
        });
    }
}

// HOST: Load video with instant broadcast
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
        
        // Instant broadcast to all joiners
        const syncRef = database.ref(`rooms/${roomId}/sync`);
        syncRef.set({
            videoId: videoId,
            isPlaying: true,
            currentTime: 0,
            action: 'load',
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
        
        controlStatus.innerHTML = '👑 HOST - Broadcasting in real-time ⚡';
    } else {
        initializePlayer();
        setTimeout(() => hostLoadVideo(), 500);
    }
}

// JOINERS: Ultra-fast sync with host
let isApplyingSync = false;

function initFastSync() {
    const syncRef = database.ref(`rooms/${roomId}/sync`);
    
    // Listen for real-time updates with high priority
    syncRef.on('value', (snapshot) => {
        if (!syncActive || currentMode !== 'join' || isApplyingSync) return;
        
        const hostData = snapshot.val();
        if (!hostData) return;
        
        // Handle new video load
        if (hostData.videoId && hostData.videoId !== currentVideoId) {
            currentVideoId = hostData.videoId;
            console.log('⏩ Loading video from host:', currentVideoId);
            
            if (player && playerReady) {
                player.loadVideoById(currentVideoId);
                playerContainer.style.display = 'block';
                currentVideoInfo.innerHTML = `🎬 Live Sync: ${currentVideoId}`;
            }
        }
        
        // Apply sync without delay
        if (player && playerReady && currentVideoId) {
            isApplyingSync = true;
            
            try {
                const currentTime = player.getCurrentTime();
                const timeDiff = Math.abs(currentTime - hostData.currentTime);
                
                // Sync play/pause instantly
                if (hostData.isPlaying && player.getPlayerState() !== YT.PlayerState.PLAYING) {
                    player.playVideo();
                    console.log('▶️ Sync: Play');
                } else if (!hostData.isPlaying && player.getPlayerState() === YT.PlayerState.PLAYING) {
                    player.pauseVideo();
                    console.log('⏸️ Sync: Pause');
                }
                
                // Sync position if difference > 0.3 seconds (faster correction)
                if (timeDiff > 0.3 && hostData.currentTime > 0) {
                    player.seekTo(hostData.currentTime, true);
                    console.log(`⏩ Sync: Seek to ${hostData.currentTime.toFixed(1)}s (diff: ${timeDiff.toFixed(2)}s)`);
                }
            } catch(e) {
                console.warn('Sync error:', e);
            }
            
            setTimeout(() => { isApplyingSync = false; }, 50);
        }
    });
    
    // Additional aggressive sync every 500ms for drift correction
    if (syncCheckInterval) clearInterval(syncCheckInterval);
    syncCheckInterval = setInterval(() => {
        if (!syncActive || currentMode !== 'join' || !player || !playerReady || !currentVideoId) return;
        
        database.ref(`rooms/${roomId}/sync`).once('value', (snapshot) => {
            if (isApplyingSync) return;
            
            const hostData = snapshot.val();
            if (!hostData || !hostData.currentTime) return;
            
            const currentTime = player.getCurrentTime();
            const timeDiff = Math.abs(currentTime - hostData.currentTime);
            
            // Aggressive correction if drift > 0.5 seconds
            if (timeDiff > 0.5 && !isApplyingSync) {
                isApplyingSync = true;
                player.seekTo(hostData.currentTime, true);
                console.log(`🔄 Drift correction: ${timeDiff.toFixed(2)}s`);
                setTimeout(() => { isApplyingSync = false; }, 100);
            }
        });
    }, 500);
}

// HOST: Send continuous position updates (every 100ms)
let positionUpdateInterval = null;

function startHostPositionUpdates() {
    if (positionUpdateInterval) clearInterval(positionUpdateInterval);
    
    positionUpdateInterval = setInterval(() => {
        if (!syncActive || currentMode !== 'host' || !player || !playerReady || !currentVideoId) return;
        
        const isPlaying = (player.getPlayerState() === YT.PlayerState.PLAYING);
        const currentTime = player.getCurrentTime();
        
        // Send position update without spamming
        database.ref(`rooms/${roomId}/sync/hostState`).set({
            isPlaying: isPlaying,
            currentTime: currentTime,
            videoId: currentVideoId,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
    }, 100); // Send every 100ms for smooth sync
}

// Setup room
async function initHostMode() {
    try {
        const roomRef = database.ref(`rooms/${roomId}`);
        
        await roomRef.set({
            host: userId,
            hostName: userName,
            createdAt: firebase.database.ServerValue.TIMESTAMP
        });
        
        await roomRef.child(`members/${userId}`).set({
            name: userName,
            role: 'host',
            joinedAt: firebase.database.ServerValue.TIMESTAMP,
            ping: firebase.database.ServerValue.TIMESTAMP
        });
        
        await roomRef.child('sync').set({
            videoId: '',
            isPlaying: false,
            currentTime: 0,
            action: 'init',
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
        
        // Track members in real-time
        roomRef.child('members').on('value', (snapshot) => {
            const members = snapshot.val();
            const count = members ? Object.keys(members).length : 0;
            memberCountSpan.innerHTML = `👥 Connected: ${count}`;
            syncRoleSpan.innerHTML = `👑 HOST - ${count} device${count !== 1 ? 's' : ''} syncing`;
            
            // Update ping timestamps
            if (members) {
                Object.keys(members).forEach(mid => {
                    if (mid !== userId) {
                        database.ref(`rooms/${roomId}/members/${mid}/ping`).set(firebase.database.ServerValue.TIMESTAMP);
                    }
                });
            }
        });
        
        roomRef.child(`members/${userId}`).onDisconnect().remove();
        
        syncActive = true;
        showStatus(`✅ Hosting: ${roomId}`, true);
        hostControls.style.display = 'block';
        initializePlayer();
        startHostPositionUpdates();
        
        controlStatus.innerHTML = '👑 HOST MODE - Real-time sync enabled ⚡';
        
        console.log('✅ Host mode ready - Ultra-low latency sync active');
        
    } catch (error) {
        console.error('Host error:', error);
        showStatus('Failed to create room', false);
    }
}

// Initialize Join Mode
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
            joinedAt: firebase.database.ServerValue.TIMESTAMP,
            ping: firebase.database.ServerValue.TIMESTAMP
        });
        
        // Track member count
        roomRef.child('members').on('value', (snapshot) => {
            const members = snapshot.val();
            const count = members ? Object.keys(members).length : 0;
            memberCountSpan.innerHTML = `👥 Connected: ${count}`;
        });
        
        roomRef.child(`members/${userId}`).onDisconnect().remove();
        
        syncActive = true;
        showStatus(`✅ Joined: ${roomId}`, true);
        syncRoleSpan.innerHTML = '🔗 JOIN MODE - Real-time sync';
        
        initializePlayer();
        initFastSync(); // Ultra-fast sync for joiners
        
        // Check if host already playing
        const hostSync = await roomRef.child('sync').once('value');
        if (hostSync.exists() && hostSync.val().videoId) {
            const state = hostSync.val();
            currentVideoId = state.videoId;
            currentVideoInfo.innerHTML = `🎬 Live Syncing...`;
            controlStatus.innerHTML = '🔗 Connected - Real-time sync active ⚡';
        } else {
            controlStatus.innerHTML = '🔗 Connected - Waiting for host...';
        }
        
        console.log('✅ Join mode ready - Low latency sync enabled');
        
    } catch (error) {
        console.error('Join error:', error);
        showStatus('Failed to join room', false);
    }
}

// Disconnect
async function disconnectFromRoom() {
    if (positionUpdateInterval) clearInterval(positionUpdateInterval);
    if (syncCheckInterval) clearInterval(syncCheckInterval);
    
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

// Control functions
function hostPlay() {
    if (currentMode !== 'host') {
        alert('Only host can control playback!');
        return;
    }
    if (player && playerReady && currentVideoId) {
        player.playVideo();
        // Immediate broadcast
        database.ref(`rooms/${roomId}/sync`).update({
            isPlaying: true,
            action: 'play',
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
    }
}

function hostPause() {
    if (currentMode !== 'host') {
        alert('Only host can control playback!');
        return;
    }
    if (player && playerReady && currentVideoId) {
        player.pauseVideo();
        database.ref(`rooms/${roomId}/sync`).update({
            isPlaying: false,
            action: 'pause',
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
    }
}

function hostSeek(delta) {
    if (currentMode !== 'host') {
        alert('Only host can control playback!');
        return;
    }
    if (player && playerReady && currentVideoId) {
        const newTime = player.getCurrentTime() + delta;
        player.seekTo(newTime, true);
        database.ref(`rooms/${roomId}/sync`).update({
            currentTime: newTime,
            action: 'seek',
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
    }
}

// Connect button
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
        
        if (positionUpdateInterval) clearInterval(positionUpdateInterval);
        if (syncCheckInterval) clearInterval(syncCheckInterval);
        
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.dataset.mode;
        
        currentVideoInfo.innerHTML = '⚡ No video loaded';
        hostControls.style.display = currentMode === 'host' ? 'block' : 'none';
        
        controlStatus.innerHTML = currentMode === 'host' 
            ? '👑 HOST mode - You control everything!' 
            : '🔗 JOIN mode - Auto-syncs with host!';
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

// Firebase connection check
database.ref('.info/connected').on('value', (snap) => {
    if (snap.val() === true) {
        console.log("✅ Firebase Connected - Ultra-low latency mode");
    }
});

// Initialize
window.onYouTubeIframeAPIReady = initializePlayer;
showStatus('Ready to connect', false);
controlStatus.innerHTML = '⚡ Ultra-low latency mode enabled!';

window.addEventListener('beforeunload', () => {
    if (positionUpdateInterval) clearInterval(positionUpdateInterval);
    if (syncCheckInterval) clearInterval(syncCheckInterval);
    if (roomId && userId) {
        database.ref(`rooms/${roomId}/members/${userId}`).remove();
    }
});

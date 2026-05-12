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
let isSyncing = false;

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
                'controls': 1,
                'modestbranding': 1,
                'rel': 0,
                'enablejsapi': 1
            },
            events: {
                'onReady': () => {
                    playerReady = true;
                    console.log('✅ Player ready');
                },
                'onStateChange': (event) => {
                    if (!syncActive || currentMode !== 'host' || isSyncing) return;
                    
                    const state = event.data;
                    const isPlaying = (state === YT.PlayerState.PLAYING);
                    const currentTime = player.getCurrentTime();
                    
                    // Host broadcasts state to all joiners
                    database.ref(`rooms/${roomId}/hostState`).set({
                        isPlaying: isPlaying,
                        currentTime: currentTime,
                        videoId: currentVideoId,
                        timestamp: firebase.database.ServerValue.TIMESTAMP
                    });
                }
            }
        });
    }
}

// HOST: Load video and tell everyone
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
    
    console.log('🎬 Host loading video:', videoId);
    currentVideoId = videoId;
    
    if (player && playerReady) {
        player.loadVideoById(videoId);
        player.playVideo();
        playerContainer.style.display = 'block';
        currentVideoInfo.innerHTML = `🎬 Now Playing: ${videoId}`;
        
        // Broadcast video to all joiners
        database.ref(`rooms/${roomId}/hostState`).set({
            videoId: videoId,
            isPlaying: true,
            currentTime: 0,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
        
        controlStatus.innerHTML = '👑 You are HOST - Everyone follows you!';
    } else {
        initializePlayer();
        setTimeout(() => hostLoadVideo(), 1000);
    }
}

// JOINERS: Listen to host and sync
function listenToHost() {
    const hostStateRef = database.ref(`rooms/${roomId}/hostState`);
    hostStateRef.on('value', (snapshot) => {
        if (!syncActive || currentMode !== 'join') return;
        
        const hostState = snapshot.val();
        if (!hostState) return;
        
        // Check if host changed video
        if (hostState.videoId && hostState.videoId !== currentVideoId) {
            console.log('📺 Host changed video:', hostState.videoId);
            currentVideoId = hostState.videoId;
            
            if (player && playerReady) {
                player.loadVideoById(hostState.videoId);
                playerContainer.style.display = 'block';
                currentVideoInfo.innerHTML = `🎬 Syncing with Host: ${hostState.videoId}`;
            }
        }
        
        // Sync playback state and position
        setTimeout(() => {
            if (player && playerReady && player.getCurrentTime) {
                isSyncing = true;
                
                // Sync play/pause
                if (hostState.isPlaying && player.getPlayerState() !== YT.PlayerState.PLAYING) {
                    player.playVideo();
                    console.log('▶️ Synced: Play');
                } else if (!hostState.isPlaying && player.getPlayerState() === YT.PlayerState.PLAYING) {
                    player.pauseVideo();
                    console.log('⏸️ Synced: Pause');
                }
                
                // Sync seek position
                const currentTime = player.getCurrentTime();
                if (Math.abs(currentTime - hostState.currentTime) > 1) {
                    player.seekTo(hostState.currentTime, true);
                    console.log('⏩ Synced: Seek to', hostState.currentTime);
                }
                
                setTimeout(() => { isSyncing = false; }, 500);
            }
        }, 500);
    });
}

// HOST: Control playback (broadcasts automatically via onStateChange)
function hostPlay() {
    if (currentMode !== 'host') {
        alert('Only host can control playback!');
        return;
    }
    if (player && playerReady && currentVideoId) {
        player.playVideo();
    }
}

function hostPause() {
    if (currentMode !== 'host') {
        alert('Only host can control playback!');
        return;
    }
    if (player && playerReady && currentVideoId) {
        player.pauseVideo();
    }
}

function hostSeek(delta) {
    if (currentMode !== 'host') {
        alert('Only host can control playback!');
        return;
    }
    if (player && playerReady && currentVideoId) {
        const currentTime = player.getCurrentTime();
        player.seekTo(currentTime + delta, true);
    }
}

// Setup room and member presence
async function initHostMode() {
    try {
        const roomRef = database.ref(`rooms/${roomId}`);
        
        await roomRef.set({
            host: userId,
            hostName: userName,
            createdAt: firebase.database.ServerValue.TIMESTAMP,
            active: true
        });
        
        await roomRef.child(`members/${userId}`).set({
            name: userName,
            role: 'host',
            joinedAt: firebase.database.ServerValue.TIMESTAMP
        });
        
        await roomRef.child('hostState').set({
            videoId: '',
            isPlaying: false,
            currentTime: 0,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
        
        // Track members
        roomRef.child('members').on('value', (snapshot) => {
            const members = snapshot.val();
            const count = members ? Object.keys(members).length : 0;
            memberCountSpan.innerHTML = `👥 Members in room: ${count}`;
            syncRoleSpan.innerHTML = `👑 You are HOST - ${count} member${count !== 1 ? 's' : ''} following you`;
        });
        
        roomRef.child(`members/${userId}`).onDisconnect().remove();
        
        syncActive = true;
        showStatus(`✅ Hosting room: ${roomId}`, true);
        hostControls.style.display = 'block';
        initializePlayer();
        
        controlStatus.innerHTML = '👑 HOST MODE ACTIVE - Your controls affect everyone!';
        
    } catch (error) {
        console.error('Host error:', error);
        showStatus('Failed to create room', false);
    }
}

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
            joinedAt: firebase.database.ServerValue.TIMESTAMP
        });
        
        // Track members
        roomRef.child('members').on('value', (snapshot) => {
            const members = snapshot.val();
            const count = members ? Object.keys(members).length : 0;
            memberCountSpan.innerHTML = `👥 Members in room: ${count}`;
        });
        
        roomRef.child(`members/${userId}`).onDisconnect().remove();
        
        syncActive = true;
        showStatus(`✅ Joined room: ${roomId}`, true);
        syncRoleSpan.innerHTML = '🔗 JOIN MODE - Waiting for host...';
        
        initializePlayer();
        listenToHost();
        
        // Check if host already playing
        const hostState = await roomRef.child('hostState').once('value');
        if (hostState.exists() && hostState.val().videoId) {
            const state = hostState.val();
            currentVideoId = state.videoId;
            currentVideoInfo.innerHTML = `🎬 Syncing with host...`;
            controlStatus.innerHTML = '🔗 Synced with HOST - Following their playback!';
        } else {
            controlStatus.innerHTML = '🔗 Connected - Waiting for HOST to play a video...';
        }
        
    } catch (error) {
        console.error('Join error:', error);
        showStatus('Failed to join room', false);
    }
}

// Disconnect
async function disconnectFromRoom() {
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
    controlStatus.innerHTML = '💡 Connect to a room to start';
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
        
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.dataset.mode;
        
        currentVideoInfo.innerHTML = '⚡ No video loaded';
        hostControls.style.display = currentMode === 'host' ? 'block' : 'none';
        
        if (currentMode === 'host') {
            controlStatus.innerHTML = '👑 Switch to HOST mode and connect to control';
        } else {
            controlStatus.innerHTML = '🔗 Switch to JOIN mode and connect to follow host';
        }
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
        console.log("✅ Firebase Connected!");
    }
});

// Initialize
window.onYouTubeIframeAPIReady = initializePlayer;
showStatus('Ready to connect', false);
controlStatus.innerHTML = '💡 Host creates room, Joiners auto-sync!';

window.addEventListener('beforeunload', () => {
    if (roomId && userId) {
        database.ref(`rooms/${roomId}/members/${userId}`).remove();
    }
});

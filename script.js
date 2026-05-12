// Firebase Configuration (Replace with your own Firebase project)
const firebaseConfig = {
    apiKey: "AIzaSyD1Vg3ZjGYK1G7-1w9Ya3A8vqpH9dFTl6k",
    authDomain: "syncwave-media.firebaseapp.com",
    databaseURL: "https://syncwave-media-default-rtdb.firebaseio.com",
    projectId: "syncwave-media",
    storageBucket: "syncwave-media.appspot.com",
    messagingSenderId: "884210395412",
    appId: "1:884210395412:web:ad7f9e3c5b8a2d1e9f7c4b"
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
let isPlaying = false;
let syncInterval = null;
let player = null;

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
const seekBackBtn = document.getElementById('seekBackBtn');
const seekFwdBtn = document.getElementById('seekFwdBtn');
const playerContainer = document.getElementById('playerContainer');

// Extract YouTube Video ID
function extractVideoId(url) {
    if (!url) return null;
    
    // If it's already a video ID (11 characters)
    if (url.match(/^[a-zA-Z0-9_-]{11}$/)) {
        return url;
    }
    
    // YouTube URL patterns
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&\n?#]+)/,
        /youtube\.com\/watch\?.*v=([^&\n?#]+)/
    ];
    
    for (let pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) {
            return match[1];
        }
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
                'enablejsapi': 1,
                'origin': window.location.origin
            },
            events: {
                'onReady': onPlayerReady,
                'onStateChange': onPlayerStateChange,
                'onError': onPlayerError
            }
        });
    }
}

function onPlayerReady() {
    playerReady = true;
    console.log('✅ Player ready');
    showStatus('Player ready', syncActive);
}

function onPlayerStateChange(event) {
    if (!syncActive || !playerReady) return;
    
    const state = event.data;
    
    if (currentMode === 'host') {
        // Update playing state
        isPlaying = (state === YT.PlayerState.PLAYING);
        
        if (player && currentVideoId) {
            const currentTime = player.getCurrentTime();
            broadcastMediaState(currentVideoId, isPlaying, currentTime);
        }
    } else if (currentMode === 'join') {
        isPlaying = (state === YT.PlayerState.PLAYING);
    }
}

function onPlayerError(event) {
    console.error('YouTube Player Error:', event);
    showStatus('Error loading video. Check URL!', syncActive);
}

// Host: Broadcast to all members
function broadcastMediaState(videoId, playing, currentTime) {
    if (!roomId) return;
    
    const roomRef = database.ref(`rooms/${roomId}/mediaState`);
    roomRef.set({
        videoId: videoId,
        isPlaying: playing,
        currentTime: currentTime,
        lastUpdated: firebase.database.ServerValue.TIMESTAMP,
        hostId: userId,
        hostName: userName,
        timestamp: Date.now()
    }).catch(err => console.error('Broadcast error:', err));
}

// Joiners: Watch for changes from host
function watchForMediaChanges() {
    const roomRef = database.ref(`rooms/${roomId}/mediaState`);
    roomRef.on('value', (snapshot) => {
        if (!syncActive || currentMode !== 'join') return;
        
        const mediaState = snapshot.val();
        if (!mediaState || !mediaState.videoId) return;
        
        console.log('Received media update:', mediaState);
        
        // Load new video if changed
        if (mediaState.videoId !== currentVideoId) {
            currentVideoId = mediaState.videoId;
            loadVideoInPlayer(mediaState.videoId);
            currentVideoInfo.innerHTML = `🎬 Syncing: ${mediaState.videoId}`;
            syncRoleSpan.textContent = '🔗 Syncing with host...';
        }
        
        // Sync playback state and position
        setTimeout(() => {
            if (player && playerReady) {
                // Sync play/pause
                if (mediaState.isPlaying && player.getPlayerState() !== YT.PlayerState.PLAYING) {
                    player.playVideo();
                } else if (!mediaState.isPlaying && player.getPlayerState() === YT.PlayerState.PLAYING) {
                    player.pauseVideo();
                }
                
                // Sync time (if difference > 1.5 seconds)
                const currentTime = player.getCurrentTime();
                if (Math.abs(currentTime - mediaState.currentTime) > 1.5) {
                    player.seekTo(mediaState.currentTime, true);
                }
            }
        }, 500);
    });
}

// Load video in player
function loadVideoInPlayer(videoId) {
    if (!player || !playerReady) {
        console.log('Waiting for player to be ready...');
        setTimeout(() => loadVideoInPlayer(videoId), 500);
        return;
    }
    
    console.log('Loading video:', videoId);
    player.loadVideoById(videoId);
    currentVideoId = videoId;
    
    // Show player container
    playerContainer.style.display = 'block';
}

// Host: Load video and broadcast
function hostLoadVideo() {
    const urlOrId = youtubeLinkInput.value.trim();
    
    if (!urlOrId) {
        alert('Please enter a YouTube URL or Video ID');
        return;
    }
    
    const videoId = extractVideoId(urlOrId);
    
    if (!videoId) {
        alert('Invalid YouTube URL! Example: https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        return;
    }
    
    console.log('Loading video:', videoId);
    currentVideoId = videoId;
    
    // Load in player
    if (player && playerReady) {
        player.loadVideoById(videoId);
        player.playVideo();
        isPlaying = true;
        
        // Update UI
        currentVideoInfo.innerHTML = `🎬 Playing: ${videoId}`;
        syncRoleSpan.textContent = '👑 Broadcasting to ${memberCount} members...';
        
        // Broadcast to all joiners
        setTimeout(() => {
            broadcastMediaState(videoId, true, 0);
        }, 500);
    } else {
        // Initialize player first
        initializePlayer();
        setTimeout(() => hostLoadVideo(), 1000);
    }
}

// Setup user presence
function setupPresence() {
    const userStatusRef = database.ref(`rooms/${roomId}/members/${userId}`);
    userStatusRef.set({
        name: userName,
        role: currentMode,
        joinedAt: firebase.database.ServerValue.TIMESTAMP
    });
    
    userStatusRef.onDisconnect().remove();
    
    // Update member count
    const membersRef = database.ref(`rooms/${roomId}/members`);
    membersRef.on('value', (snapshot) => {
        const members = snapshot.val();
        const count = members ? Object.keys(members).length : 0;
        memberCountSpan.textContent = `👥 Members: ${count}`;
        
        if (currentMode === 'host' && syncRoleSpan) {
            syncRoleSpan.textContent = `👑 Host - ${count} member${count !== 1 ? 's' : ''} connected`;
        }
    });
}

// Initialize Host Mode
async function initHostMode() {
    try {
        const roomRef = database.ref(`rooms/${roomId}`);
        
        await roomRef.set({
            host: userId,
            hostName: userName,
            createdAt: firebase.database.ServerValue.TIMESTAMP,
            active: true
        });
        
        // Initialize members
        await roomRef.child(`members/${userId}`).set({
            name: userName,
            role: 'host',
            joinedAt: firebase.database.ServerValue.TIMESTAMP
        });
        
        // Initialize empty media state
        await roomRef.child('mediaState').set({
            videoId: '',
            isPlaying: false,
            currentTime: 0,
            lastUpdated: firebase.database.ServerValue.TIMESTAMP
        });
        
        setupPresence();
        syncActive = true;
        
        showStatus(`✅ Hosting room: ${roomId}`, true);
        syncRoleSpan.textContent = '👑 Host Mode - Ready to share video!';
        
        // Initialize YouTube player
        initializePlayer();
        
        // Show host controls
        hostControls.style.display = 'block';
        
    } catch (error) {
        console.error('Host init error:', error);
        showStatus('Failed to create room', false);
    }
}

// Initialize Join Mode
async function initJoinMode() {
    try {
        const roomRef = database.ref(`rooms/${roomId}`);
        
        // Check if room exists
        const snapshot = await roomRef.once('value');
        if (!snapshot.exists()) {
            alert('❌ Room does not exist! Ask the host to create it first.');
            return;
        }
        
        // Join room
        await roomRef.child(`members/${userId}`).set({
            name: userName,
            role: 'member',
            joinedAt: firebase.database.ServerValue.TIMESTAMP
        });
        
        setupPresence();
        syncActive = true;
        
        showStatus(`✅ Joined room: ${roomId}`, true);
        syncRoleSpan.textContent = '🔗 Waiting for host to play video...';
        
        // Initialize YouTube player
        initializePlayer();
        
        // Start watching for media changes
        watchForMediaChanges();
        
        // Check if there's already a video playing
        const mediaState = await roomRef.child('mediaState').once('value');
        if (mediaState.exists() && mediaState.val().videoId) {
            const state = mediaState.val();
            currentVideoId = state.videoId;
            loadVideoInPlayer(state.videoId);
            currentVideoInfo.innerHTML = `🎬 Loading host's video...`;
        }
        
    } catch (error) {
        console.error('Join error:', error);
        showStatus('Failed to join room', false);
    }
}

// Disconnect from room
async function disconnectFromRoom() {
    if (roomId && userId) {
        await database.ref(`rooms/${roomId}/members/${userId}`).remove();
        
        // If host and no members left, clean up room
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
    syncRoleSpan.textContent = '⚡ Standby';
    hostControls.style.display = 'none';
}

// Control functions
function togglePlayPause() {
    if (!player || !playerReady || !currentVideoId) {
        alert('Load a video first!');
        return;
    }
    
    if (isPlaying) {
        player.pauseVideo();
        isPlaying = false;
    } else {
        player.playVideo();
        isPlaying = true;
    }
    
    if (currentMode === 'host') {
        setTimeout(() => {
            broadcastMediaState(currentVideoId, isPlaying, player.getCurrentTime());
        }, 100);
    }
}

function seekTo(delta) {
    if (!player || !playerReady || !currentVideoId) {
        alert('Load a video first!');
        return;
    }
    
    const currentTime = player.getCurrentTime();
    player.seekTo(currentTime + delta, true);
    
    if (currentMode === 'host') {
        setTimeout(() => {
            broadcastMediaState(currentVideoId, isPlaying, player.getCurrentTime());
        }, 100);
    }
}

// Connect button handler
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
    
    // Disconnect from previous room
    if (syncActive) {
        await disconnectFromRoom();
    }
    
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
        if (syncActive) {
            await disconnectFromRoom();
        }
        
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.dataset.mode;
        
        // Reset UI
        currentVideoId = '';
        currentVideoInfo.innerHTML = '⚡ No video loaded';
        
        if (currentMode === 'host') {
            hostControls.style.display = 'block';
        } else {
            hostControls.style.display = 'none';
        }
    });
});

// Control button handlers
playPauseBtn.addEventListener('click', togglePlayPause);
seekBackBtn.addEventListener('click', () => seekTo(-10));
seekFwdBtn.addEventListener('click', () => seekTo(10));
loadVideoBtn.addEventListener('click', hostLoadVideo);

// Helper function to show status
function showStatus(message, isConnected) {
    statusText.textContent = message;
    if (isConnected) {
        statusDot.classList.add('active');
    } else {
        statusDot.classList.remove('active');
    }
}

// Initialize YouTube API
window.onYouTubeIframeAPIReady = function() {
    initializePlayer();
};

// Initial show
showStatus('Ready to connect', false);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (roomId && userId) {
        database.ref(`rooms/${roomId}/members/${userId}`).remove();
    }
});
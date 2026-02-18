// Main entry point and initialization
import { validWords as validWordsArray } from "./assets/validWords.js";
import { answerWords } from "./assets/answerWords.js";
import * as State from './state.js';
import { generateRoomId, generateUsername, showMessage } from './utils.js';
import { handleConnection, broadcastToAll, sendChatMessage } from './network.js';
import { handleKeyPress, forfeitRound } from './game.js';
import { showLobby, updatePlayersDisplay, backToMenu, closeRoom, readyUp, cleanup } from './ui.js';

// Convert to Set for O(1) lookup
export const validWords = new Set(validWordsArray.map(word => word.toUpperCase()));

// Event listeners
document.getElementById('createMatchBtn').addEventListener('click', createMatch);
document.getElementById('joinMatchBtn').addEventListener('click', joinMatch);
document.getElementById('startMatchBtn').addEventListener('click', startMatch);
document.getElementById('leaveLobbyBtn').addEventListener('click', leaveLobby);
document.getElementById('leaveGameBtn').addEventListener('click', leaveGame);
document.getElementById('forfeitBtn').addEventListener('click', forfeitRound);
document.getElementById('leaveReadyBtn').addEventListener('click', leaveGame);
document.getElementById('readyBtn').addEventListener('click', readyUp);
document.getElementById('backToMenuBtn').addEventListener('click', backToMenu);
document.getElementById('copyRoomIdBtn').addEventListener('click', copyRoomId);
document.getElementById('chatSend').addEventListener('click', sendChatMessage);
document.getElementById('chatInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
});

document.addEventListener('keydown', handleKeyPress);

document.getElementById('joinRoomInput').addEventListener('input', (e) => {
    const value = e.target.value.toUpperCase();
    e.target.value = value;
    document.getElementById('joinMatchBtn').disabled = value.length !== 6;
});

document.getElementById('joinRoomInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && e.target.value.length === 6) {
        joinMatch();
    }
});

// Load saved username from localStorage
const savedUsername = localStorage.getItem('wordleUsername');
if (savedUsername) {
    document.getElementById('usernameInput').value = savedUsername;
}

// Handle page close
window.addEventListener('beforeunload', () => {
    if (State.peer && State.peer.id) {
        if (State.isHost) {
            broadcastToAll({ type: 'closeRoom' });
        } else {
            broadcastToAll({ type: 'playerLeft', playerId: State.peer.id });
        }
    }
});

// Main functions
export function createMatch() {
    State.setMyUsername(document.getElementById('usernameInput').value.trim() || generateUsername());
    
    // Save username to localStorage
    if (document.getElementById('usernameInput').value.trim()) {
        localStorage.setItem('wordleUsername', State.myUsername);
    }
    
    State.setRoomId(generateRoomId());
    State.setIsHost(true);

    attemptCreatePeer(0);
}

function attemptCreatePeer(retryCount) {
    if (retryCount >= 5) {
        showMessage('mainMenuMessage', 'Failed to create match after multiple attempts', 'error');
        return;
    }
    
    State.setPeer(new Peer(State.roomId));
    
    State.peer.on('open', (id) => {
        console.log('Peer created with ID:', id);
        State.players[State.peer.id] = { 
            username: State.myUsername, 
            ready: false, 
            score: 0, 
            board: [],
            finished: false,
            completionTime: null,
            success: false,
            disconnected: false,
            hasPlayed: false
        };
        State.totalScores[State.peer.id] = 0;
        showLobby();
    });

    State.peer.on('connection', (conn) => {
        handleConnection(conn);
    });

    State.peer.on('error', (err) => {
        console.error('Peer error:', err);
        if (err.type === 'unavailable-id') {
            // ID collision, try again with new ID
            State.peer.destroy();
            State.setRoomId(generateRoomId());
            attemptCreatePeer(retryCount + 1);
        } else {
            showMessage('mainMenuMessage', 'Error creating match: ' + err.message, 'error');
        }
    });
}

export function joinMatch() {
    if (State.isJoining) {
        showMessage('mainMenuMessage', 'Already joining...', 'info');
        return;
    }
    
    const targetRoomId = document.getElementById('joinRoomInput').value.toUpperCase();
    
    if (State.joinedRoomId === targetRoomId && State.peer && State.peer.id) {
        showMessage('mainMenuMessage', 'Already in this room', 'info');
        return;
    }
    
    State.setIsJoining(true);
    State.setMyUsername(document.getElementById('usernameInput').value.trim() || generateUsername());
    
    // Save username to localStorage
    if (document.getElementById('usernameInput').value.trim()) {
        localStorage.setItem('wordleUsername', State.myUsername);
    }
    
    State.setRoomId(targetRoomId);
    State.setIsHost(false);

    const randomId = 'player_' + Math.random().toString(36).substr(2, 9);
    State.setPeer(new Peer(randomId));

    State.peer.on('open', () => {
        const conn = State.peer.connect(State.roomId);
        handleConnection(conn);
        
        conn.on('open', () => {
            State.setJoinedRoomId(State.roomId);
            conn.send({ type: 'join', username: State.myUsername, playerId: State.peer.id });
        });

        conn.on('error', (err) => {
            console.error('Connection error:', err);
            showMessage('mainMenuMessage', 'Failed to connect to room', 'error');
            State.setIsJoining(false);
            State.setJoinedRoomId(null);
            cleanup();
        });
    });

    State.peer.on('error', (err) => {
        console.error('Peer error:', err);
        showMessage('mainMenuMessage', 'Room not found', 'error');
        State.setIsJoining(false);
        State.setJoinedRoomId(null);
        cleanup();
    });
    
    // Timeout for connection
    setTimeout(() => {
        if (State.isJoining && document.getElementById('mainMenu').classList.contains('active')) {
            showMessage('mainMenuMessage', 'Connection timeout', 'error');
            State.setIsJoining(false);
            State.setJoinedRoomId(null);
            cleanup();
        }
    }, 10000);
}

export function startMatch() {
    if (!State.isHost) return;
    
    const startBtn = document.getElementById('startMatchBtn');
    
    // Check if there are at least 2 connected players
    const connectedPlayers = Object.values(State.players).filter(p => !p.disconnected).length;
    if (connectedPlayers < 2) {
        alert('You need at least 2 players to start a match!');
        return;
    }
    
    // Change button text to indicate starting
    startBtn.textContent = 'Starting...';
    startBtn.disabled = true;
    
    // Send ping to all players to verify they're still connected
    State.activePingPlayers.clear();
    State.activePingPlayers.add(State.peer.id);
    
    const expectedResponses = connectedPlayers - 1;
    
    if (expectedResponses === 0) {
        beginMatch();
        return;
    }
    
    // Broadcast ping
    broadcastToAll({ type: 'ping', timestamp: Date.now() });
    
    // Wait for pong responses
    setTimeout(() => {
        // Mark players who didn't respond as disconnected
        Object.keys(State.players).forEach(playerId => {
            if (!State.activePingPlayers.has(playerId) && !State.players[playerId].disconnected) {
                console.log('Marking inactive player as disconnected:', playerId);
                State.players[playerId].disconnected = true;
            }
        });
        
        updatePlayersDisplay();
        broadcastToAll({ type: 'playerUpdate', players: State.players, totalScores: State.totalScores });
        
        // Check again if we have enough players
        const stillConnected = Object.values(State.players).filter(p => !p.disconnected).length;
        if (stillConnected < 2) {
            alert('Not enough active players to start a match!');
            startBtn.textContent = 'Start Game';
            startBtn.disabled = false;
            return;
        }
        
        beginMatch();
    }, 2000);
}

export function beginMatch() {
    State.setIsGameActive(true);
    State.setHasGameStarted(true);
    
    // Mark all currently connected players as having played
    Object.values(State.players).forEach(player => {
        if (!player.disconnected) {
            player.hasPlayed = true;
        }
    });
    
    State.setCurrentWord(answerWords[Math.floor(Math.random() * answerWords.length)].toUpperCase());
    
    broadcastToAll({ 
        type: 'startGame', 
        word: State.currentWord,
        round: State.currentRound
    });
    
    import('./ui.js').then(({ startGame }) => startGame());
}

export function leaveLobby() {
    if (State.isHost) {
        if (State.peer && State.peer.id) {
            broadcastToAll({ type: 'closeRoom', fromLobby: !State.hasGameStarted });
        }
        State.setRoomClosed(true);
        setTimeout(() => {
            cleanup();
            backToMenu();
        }, 100);
    } else {
        if (State.peer && State.peer.id) {
            broadcastToAll({ type: 'playerLeft', playerId: State.peer.id });
        }
        cleanup();
        backToMenu();
    }
}

export function leaveGame() {
    if (State.isHost) {
        if (State.peer && State.peer.id) {
            broadcastToAll({ type: 'closeRoom', fromLobby: false });
        }
        State.setRoomClosed(true);
        import('./ui.js').then(({ showResultsScreen }) => showResultsScreen());
    } else {
        if (State.peer && State.peer.id) {
            broadcastToAll({ type: 'playerLeft', playerId: State.peer.id });
        }
        cleanup();
        backToMenu();
    }
}

export function copyRoomId() {
    const roomIdText = document.getElementById('roomIdDisplay').textContent;
    
    // Use modern clipboard API if available
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(roomIdText).then(() => {
            const btn = document.getElementById('copyRoomIdBtn');
            const originalText = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => {
                btn.textContent = originalText;
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy:', err);
            fallbackCopy(roomIdText);
        });
    } else {
        fallbackCopy(roomIdText);
    }
}

function fallbackCopy(text) {
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    document.body.appendChild(textArea);
    textArea.select();
    
    try {
        document.execCommand('copy');
        const btn = document.getElementById('copyRoomIdBtn');
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
    } catch (err) {
        console.error('Fallback copy failed:', err);
        alert('Failed to copy. Room ID: ' + text);
    }
    
    document.body.removeChild(textArea);
}

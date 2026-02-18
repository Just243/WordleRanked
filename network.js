// Network and P2P connection handling
import * as State from './state.js';
import { showMessage, addChatMessage, clearChat } from './utils.js';
import { 
    updatePlayersDisplay, 
    updateOtherPlayersBoards, 
    updateReadyDisplay,
    showLobby,
    startGame,
    showReadyScreen,
    showResultsScreen,
    checkAllPlayersFinished,
    backToMenu,
    closeRoom
} from './ui.js';

export function broadcastToAll(data) {
    if (!State.connections || State.connections.length === 0) return;
    
    State.connections.forEach(conn => {
        if (conn && conn.open) {
            try {
                conn.send(data);
            } catch (e) {
                console.log('Error sending to connection:', e);
            }
        }
    });
}

export function broadcastBoardUpdate() {
    const boardData = State.guesses.map(g => g.result);
    State.players[State.peer.id].board = boardData;
    
    broadcastToAll({
        type: 'boardUpdate',
        playerId: State.peer.id,
        board: boardData
    });
}

export function handleConnection(conn) {
    State.setConnections([...State.connections, conn]);
    
    // Store the peer ID for this connection
    conn.metadata = conn.metadata || {};

    conn.on('data', (data) => {
        // Store playerId in connection metadata when we learn it
        if (data.playerId && !conn.metadata.playerId) {
            conn.metadata.playerId = data.playerId;
        }
        handleMessage(data, conn);
    });

    conn.on('close', () => {
        State.setConnections(State.connections.filter(c => c !== conn));
        const playerId = conn.metadata.playerId;
        
        if (playerId && State.players[playerId]) {
            // Mark as disconnected instead of deleting
            State.players[playerId].disconnected = true;
            State.readyPlayers.delete(playerId);
            
            // Notify other players
            if (State.isHost) {
                broadcastToAll({ type: 'playerLeft', playerId: playerId });
            }
            
            updatePlayersDisplay();
            updateOtherPlayersBoards();
            
            // Check if room should close (only if game started and only 1 connected player remains)
            if (State.hasGameStarted) {
                const connectedPlayers = Object.values(State.players).filter(p => !p.disconnected).length;
                if (connectedPlayers <= 1) {
                    closeRoom();
                }
            }
        }
    });
}

export function handleMessage(data, conn) {
    switch (data.type) {
        case 'join':
            if (State.isHost && !State.isGameActive && !State.roomClosed) {
                // Check for duplicate username
                const existingPlayer = Object.values(State.players).find(
                    p => p.username.toLowerCase() === data.username.toLowerCase() && !p.disconnected
                );
                
                if (existingPlayer) {
                    // Reject join due to duplicate name
                    conn.send({ 
                        type: 'joinRejected', 
                        reason: 'A player with that name is already in the room.' 
                    });
                    return;
                }
                
                // Check if player already exists
                if (!State.players[data.playerId]) {
                    State.players[data.playerId] = { 
                        username: data.username, 
                        ready: false, 
                        score: 0, 
                        board: [],
                        finished: false,
                        completionTime: null,
                        success: false,
                        disconnected: false,
                        hasPlayed: false
                    };
                    State.totalScores[data.playerId] = 0;
                }
                
                // Send current player list to new player
                conn.send({ 
                    type: 'playerList', 
                    players: State.players,
                    totalScores: State.totalScores,
                    roomId: State.roomId 
                });
                
                // Broadcast to all players
                broadcastToAll({ type: 'playerUpdate', players: State.players, totalScores: State.totalScores });
                updatePlayersDisplay();
            } else if (State.roomClosed) {
                // Room is closed, reject join
                conn.send({ type: 'roomClosed' });
            }
            break;

        case 'playerList':
            State.setPlayers(data.players);
            State.setTotalScores(data.totalScores);
            State.setRoomId(data.roomId);
            showLobby();
            break;

        case 'playerUpdate':
            State.setPlayers(data.players);
            if (data.totalScores) {
                State.setTotalScores(data.totalScores);
            }
            updatePlayersDisplay();
            break;

        case 'startGame':
            State.setCurrentWord(data.word);
            State.setCurrentRound(data.round);
            startGame();
            break;

        case 'boardUpdate':
            if (State.players[data.playerId]) {
                State.players[data.playerId].board = data.board;
                updateOtherPlayersBoards();
                
                // If host receives a board update, relay it to all other players
                if (State.isHost && data.playerId !== State.peer.id) {
                    broadcastToAll({
                        type: 'boardUpdate',
                        playerId: data.playerId,
                        board: data.board
                    });
                }
            }
            break;

        case 'gameComplete':
            if (State.players[data.playerId]) {
                State.players[data.playerId].completionTime = data.time;
                State.players[data.playerId].success = data.success;
                State.players[data.playerId].finished = true;
            }
            if (State.isHost) {
                checkAllPlayersFinished();
            }
            break;

        case 'roundResults':
            State.setPlayers(data.players);
            State.setTotalScores(data.totalScores);
            showReadyScreen(data.roundScores);
            break;

        case 'readyUpdate':
            if (State.isHost) {
                if (data.ready) {
                    State.readyPlayers.add(data.playerId);
                } else {
                    State.readyPlayers.delete(data.playerId);
                }
                updateReadyDisplay();
                broadcastToAll({ type: 'readyStatus', readyPlayers: Array.from(State.readyPlayers) });
                
                if (State.readyPlayers.size === Object.keys(State.players).length) {
                    import('./ui.js').then(({ startNextRound }) => startNextRound());
                }
            }
            break;

        case 'readyStatus':
            State.setReadyPlayers(new Set(data.readyPlayers));
            updateReadyDisplay();
            break;

        case 'chat':
            // Don't add message if it's from ourselves
            if (data.senderId !== State.peer.id) {
                addChatMessage(data.username, data.message);
            }
            
            // If host receives a chat from a player, relay it to all other players
            if (State.isHost && data.senderId !== State.peer.id) {
                broadcastToAll({ 
                    type: 'chat', 
                    username: data.username, 
                    message: data.message,
                    senderId: data.senderId
                });
            }
            break;

        case 'closeRoom':
            if (data.fromLobby && !State.hasGameStarted) {
                // Room closed before game started
                alert('Host has closed the game.');
                import('./ui.js').then(({ cleanup }) => {
                    cleanup();
                    backToMenu();
                });
            } else {
                // Room closed after game started or ended
                showResultsScreen();
            }
            break;
            
        case 'roomClosed':
            // Tried to join a closed room
            alert('This room has been closed.');
            import('./ui.js').then(({ cleanup }) => {
                cleanup();
                backToMenu();
            });
            break;
            
        case 'joinRejected':
            // Join rejected (duplicate name, etc.)
            alert(data.reason || 'Unable to join room.');
            import('./ui.js').then(({ cleanup }) => {
                cleanup();
                backToMenu();
            });
            break;

        case 'playerLeft':
            if (State.players[data.playerId]) {
                const wasInGame = State.hasGameStarted;
                
                // Mark player as disconnected but keep in rankings
                State.players[data.playerId].disconnected = true;
                State.readyPlayers.delete(data.playerId);
                
                // Host relays the disconnection to all other players
                if (State.isHost) {
                    broadcastToAll({ type: 'playerLeft', playerId: data.playerId });
                }
                
                updatePlayersDisplay();
                updateOtherPlayersBoards();
                updateReadyDisplay();
                
                // Only close room if game has started and only 1 connected player remains
                const connectedPlayers = Object.values(State.players).filter(p => !p.disconnected).length;
                if (wasInGame && connectedPlayers <= 1) {
                    closeRoom();
                }
            }
            break;
            
        case 'ping':
            // Respond with pong to confirm we're active
            broadcastToAll({ type: 'pong', playerId: State.peer.id });
            break;
            
        case 'pong':
            // Host receives pong responses and marks players as active
            if (State.isHost && data.playerId) {
                State.activePingPlayers.add(data.playerId);
                console.log('Received pong from:', data.playerId);
            }
            break;
    }
}

export function sendChatMessage() {
    const input = document.getElementById('chatInput');
    if (!input) return;
    
    const message = input.value.trim();
    
    if (message) {
        // Add message to own chat first
        addChatMessage(State.myUsername, message);
        
        // Then broadcast to others (host will relay if needed)
        broadcastToAll({
            type: 'chat',
            username: State.myUsername,
            message: message,
            senderId: State.peer.id
        });
        
        input.value = '';
    }
}

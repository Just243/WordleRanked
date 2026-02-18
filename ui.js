// UI management and screen updates
import * as State from './state.js';
import { broadcastToAll } from './network.js';
import { clearChat } from './utils.js';
import { initializeBoard, initializeKeyboard, resetGameState } from './game.js';
import { answerWords } from './assets/answerWords.js';

export function showLobby() {
    State.setIsJoining(false);
    document.getElementById('mainMenu').classList.remove('active');
    document.getElementById('lobbyScreen').classList.add('active');
    document.getElementById('roomIdDisplay').textContent = State.roomId;

    const leaveBtn = document.getElementById('leaveLobbyBtn');
    const startBtn = document.getElementById('startMatchBtn');

    if (State.isHost) {
        startBtn.style.display = 'block';
        startBtn.textContent = 'Start Game';
        startBtn.disabled = false;
        document.getElementById('waitingMessage').style.display = 'none';
        leaveBtn.textContent = 'Close Game';
    } else {
        startBtn.style.display = 'none';
        document.getElementById('waitingMessage').style.display = 'block';
        leaveBtn.textContent = 'Leave Match';
    }

    updatePlayersDisplay();
}

export function updatePlayersDisplay() {
    const list = document.getElementById('playersList');
    if (!list) return;

    list.innerHTML = '';

    Object.entries(State.players).forEach(([playerId, player]) => {
        // In lobby, only show connected players
        if (player.disconnected) return;

        const div = document.createElement('div');
        div.className = 'player-item';
        div.textContent = player.username + (playerId === State.peer.id ? ' (You)' : '');
        if (playerId === State.roomId) {
            div.textContent += ' (Host)';
        }
        list.appendChild(div);
    });
}

export function startGame() {
    document.getElementById('lobbyScreen').classList.remove('active');
    document.getElementById('readyScreen').classList.remove('active');
    document.getElementById('gameScreen').classList.add('active');

    const leaveBtn = document.getElementById('leaveGameBtn');
    leaveBtn.textContent = State.isHost ? 'Close Game' : 'Leave Match';

    // Reset forfeit button
    const forfeitBtn = document.getElementById('forfeitBtn');
    if (forfeitBtn) {
        forfeitBtn.textContent = 'Forfeit Round';
        forfeitBtn.disabled = false;
        forfeitBtn.style.background = '#b59f3b';
        forfeitBtn.style.opacity = '1';
    }

    resetGameState();
    initializeBoard();
    initializeKeyboard();
    clearChat();
    updateOtherPlayersBoards();

    State.setGameStartTime(Date.now());
    State.setIsGameActive(true);
    updateGameStatus();
}

export function updateGameStatus() {
    const status = document.getElementById('gameStatus');
    if (!status) return;

    const elapsed = State.gameStartTime ? ((Date.now() - State.gameStartTime) / 1000).toFixed(1) : '0.0';
    const myScore = (State.peer && State.peer.id && State.totalScores[State.peer.id]) ? State.totalScores[State.peer.id] : 0;

    let statusMessage = '';
    if (State.gameEndTime) {
        if (State.peer && State.peer.id && State.players[State.peer.id]?.success) {
            statusMessage = '<div style="color: #6aaa64;">✓ Word Solved! Waiting for other players...</div>';
        } else {
            statusMessage = '<div style="color: #818384;">✗ Failed. Waiting for other players...</div>';
        }
    }

    status.innerHTML = `
        <div class="game-info">
            <div><strong>Round ${State.currentRound}</strong></div>
            <div class="timer">Time: ${elapsed}s</div>
            <div class="score-display">
                <span class="label">Your Total Score:</span>
                <span class="value">${myScore}</span>
            </div>
        </div>
        ${statusMessage}
    `;

    if (State.isGameActive && State.peer) {
        setTimeout(updateGameStatus, 100);
    }
}

export function updateOtherPlayersBoards() {
    const container = document.getElementById('otherPlayersBoards');
    if (!container) return;

    container.innerHTML = '';

    const grid = document.createElement('div');
    grid.className = 'other-players-grid';

    Object.entries(State.players).forEach(([playerId, player]) => {
        if (playerId === State.peer.id) return;
        if (player.disconnected) return;

        const playerDiv = document.createElement('div');
        playerDiv.className = 'other-player';

        const nameDiv = document.createElement('div');
        nameDiv.className = 'other-player-name';
        nameDiv.textContent = player.username;
        nameDiv.title = player.username;
        playerDiv.appendChild(nameDiv);

        const miniBoard = document.createElement('div');
        miniBoard.className = 'mini-board';

        for (let i = 0; i < 6; i++) {
            const row = document.createElement('div');
            row.className = 'mini-row';

            for (let j = 0; j < 5; j++) {
                const tile = document.createElement('div');
                tile.className = 'mini-tile';

                if (player.board[i] && player.board[i][j]) {
                    tile.classList.add(player.board[i][j]);
                }

                row.appendChild(tile);
            }

            miniBoard.appendChild(row);
        }

        playerDiv.appendChild(miniBoard);
        grid.appendChild(playerDiv);
    });

    container.appendChild(grid);
}

export function checkAllPlayersFinished() {
    // Only check connected players
    const connectedPlayers = Object.values(State.players).filter(p => !p.disconnected);
    const allFinished = connectedPlayers.every(p => p.finished === true);

    if (allFinished) {
        calculateScores();
    }
}

export function calculateScores() {
    const finishedPlayers = Object.entries(State.players)
        .filter(([_, p]) => p.success && p.completionTime)
        .sort((a, b) => a[1].completionTime - b[1].completionTime);

    const roundScores = {};

    if (finishedPlayers.length > 0) {
        const firstPlaceTime = finishedPlayers[0][1].completionTime;

        finishedPlayers.forEach(([playerId, player], index) => {
            if (index === 0) {
                roundScores[playerId] = 15;
            } else {
                roundScores[playerId] = Math.round((firstPlaceTime / player.completionTime) * 10);
            }

            State.players[playerId].score = roundScores[playerId];
            State.totalScores[playerId] = (State.totalScores[playerId] || 0) + roundScores[playerId];
        });
    }

    // Everyone who failed or forfeited gets 0
    Object.keys(State.players).forEach(playerId => {
        if (!roundScores[playerId]) {
            roundScores[playerId] = 0;
            State.players[playerId].score = 0;
        }
    });

    broadcastToAll({
        type: 'roundResults',
        players: State.players,
        totalScores: State.totalScores,
        roundScores: roundScores
    });

    showReadyScreen(roundScores);
}

export function showReadyScreen(roundScores) {
    State.setIsGameActive(false);
    document.getElementById('gameScreen').classList.remove('active');
    document.getElementById('readyScreen').classList.add('active');

    const leaveBtn = document.getElementById('leaveReadyBtn');
    leaveBtn.textContent = State.isHost ? 'Close Game' : 'Leave Match';

    const scoreboard = document.getElementById('roundScoreboard');
    scoreboard.innerHTML = '<h2>Round ' + State.currentRound + ' Results</h2>';

    // Only show connected players in round results
    const connectedPlayers = Object.entries(State.players)
        .filter(([_, p]) => !p.disconnected)
        .sort((a, b) => (roundScores[b[0]] || 0) - (roundScores[a[0]] || 0));

    connectedPlayers.forEach(([playerId, player]) => {
        const div = document.createElement('div');
        div.className = 'score-item';
        if (playerId === State.peer.id) div.classList.add('highlight');

        const info = document.createElement('div');
        info.innerHTML = `<strong>${player.username}</strong><br>Time: ${player.completionTime ? player.completionTime.toFixed(2) + 's' : 'Did not finish'}`;

        const score = document.createElement('div');
        score.innerHTML = `<strong>${roundScores[playerId] || 0} pts</strong><br>Total: ${State.totalScores[playerId] || 0}`;

        div.appendChild(info);
        div.appendChild(score);
        scoreboard.appendChild(div);
    });

    State.readyPlayers.clear();
    updateReadyDisplay();
}

export function updateReadyDisplay() {
    const list = document.getElementById('readyPlayersList');
    if (!list) return;

    list.innerHTML = '';

    Object.entries(State.players).forEach(([playerId, player]) => {
        // Only show connected players in ready status
        if (player.disconnected) return;

        const div = document.createElement('div');
        div.className = 'player-item';
        if (State.readyPlayers.has(playerId)) {
            div.classList.add('ready');
        }
        div.textContent = player.username + (State.readyPlayers.has(playerId) ? ' ✓' : '');
        list.appendChild(div);
    });
}

export function readyUp() {
    if (State.readyPlayers.has(State.peer.id)) return;

    State.readyPlayers.add(State.peer.id);
    updateReadyDisplay();

    if (State.isHost) {
        broadcastToAll({ type: 'readyStatus', readyPlayers: Array.from(State.readyPlayers) });

        if (State.readyPlayers.size === Object.keys(State.players).length) {
            startNextRound();
        }
    } else {
        broadcastToAll({ type: 'readyUpdate', playerId: State.peer.id, ready: true });
    }
}

export function startNextRound() {
    State.setCurrentRound(State.currentRound + 1);
    State.readyPlayers.clear();

    State.setCurrentWord(answerWords[Math.floor(Math.random() * answerWords.length)].toUpperCase());

    broadcastToAll({
        type: 'startGame',
        word: State.currentWord,
        round: State.currentRound
    });

    startGame();
}

export function showResultsScreen() {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('resultsScreen').classList.add('active');

    const scoreboard = document.getElementById('finalScoreboard');

    // Check if any rounds were actually completed
    const hasAnyScores = Object.values(State.totalScores).some(score => score > 0);
    const playersWhoPlayed = Object.entries(State.totalScores)
        .filter(([playerId]) => State.players[playerId]?.hasPlayed)
        .sort((a, b) => b[1] - a[1]);

    if (!hasAnyScores || playersWhoPlayed.length === 0) {
        scoreboard.innerHTML = '<h2>Match Ended</h2><p style="text-align: center; padding: 20px;">The match was closed before any rounds were completed.</p>';
        return;
    }

    scoreboard.innerHTML = '<h2>Final Standings</h2>';

    playersWhoPlayed.forEach(([playerId, score], index) => {
        const player = State.players[playerId];
        if (!player) return;

        const div = document.createElement('div');
        div.className = 'score-item';
        if (playerId === State.peer.id) div.classList.add('highlight');

        const info = document.createElement('div');
        const disconnectedLabel = player.disconnected ? ' (Disconnected)' : '';
        info.innerHTML = `<strong>#${index + 1} ${player.username}${disconnectedLabel}</strong>`;

        const scoreDiv = document.createElement('div');
        scoreDiv.innerHTML = `<strong>${score} points</strong>`;

        div.appendChild(info);
        div.appendChild(scoreDiv);
        scoreboard.appendChild(div);
    });
}

export function closeRoom() {
    if (State.isHost && State.peer && State.peer.id) {
        broadcastToAll({ type: 'closeRoom', fromLobby: !State.hasGameStarted });
    }
    State.setRoomClosed(true);
    showResultsScreen();
}

export function backToMenu() {
    cleanup();
    clearChat();
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('mainMenu').classList.add('active');
    document.getElementById('joinRoomInput').value = '';
    document.getElementById('joinMatchBtn').disabled = true;
}

export function cleanup() {
    if (State.connections && State.connections.length > 0) {
        State.connections.forEach(conn => {
            try {
                if (conn) conn.close();
            } catch (e) {
                console.log('Error closing connection:', e);
            }
        });
    }
    State.setConnections([]);

    if (State.peer) {
        try {
            State.peer.destroy();
        } catch (e) {
            console.log('Error destroying peer:', e);
        }
        State.setPeer(null);
    }

    State.setPlayers({});
    State.setTotalScores({});
    State.readyPlayers.clear();
    State.activePingPlayers.clear();
    State.setIsHost(false);
    State.setIsGameActive(false);
    State.setCurrentRound(1);
    State.setGameStartTime(null);
    State.setGameEndTime(null);
    State.setCurrentRow(0);
    State.setCurrentTile(0);
    State.setGuesses([]);
    State.setKeyboardState({});
    State.setIsJoining(false);
    State.setJoinedRoomId(null);
    State.setRoomClosed(false);
    State.setHasGameStarted(false);
}

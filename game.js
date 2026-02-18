// Wordle game logic
import * as State from './state.js';
import { broadcastToAll, broadcastBoardUpdate } from './network.js';
import { addChatMessage } from './utils.js';
import { validWords } from './main.js';

export function initializeBoard() {
    const board = document.getElementById('wordleBoard');
    if (!board) return;

    board.innerHTML = '';

    for (let i = 0; i < 6; i++) {
        const row = document.createElement('div');
        row.className = 'wordle-row';

        for (let j = 0; j < 5; j++) {
            const tile = document.createElement('div');
            tile.className = 'tile';
            tile.id = `tile-${i}-${j}`;
            row.appendChild(tile);
        }

        board.appendChild(row);
    }
}

export function initializeKeyboard() {
    const keyboard = document.getElementById('keyboard');
    if (!keyboard) return;

    keyboard.innerHTML = '';

    const rows = [
        ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
        ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
        ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'BACK']
    ];

    rows.forEach(row => {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'keyboard-row';

        row.forEach(key => {
            const button = document.createElement('button');
            button.className = 'key' + (key.length > 1 ? ' wide' : '');
            button.textContent = key === 'BACK' ? '←' : key;
            button.onclick = () => handleKeyPress({ key: key === 'BACK' ? 'Backspace' : key });

            if (State.keyboardState[key]) {
                button.classList.add(State.keyboardState[key]);
            }

            rowDiv.appendChild(button);
        });

        keyboard.appendChild(rowDiv);
    });
}

export function handleKeyPress(e) {
    // Don't handle keyboard if chat input is focused
    if (document.activeElement.id === 'chatInput') return;

    const activeScreen = document.querySelector('.screen.active');

    // Ready up with Enter on ready screen
    if (activeScreen && activeScreen.id === 'readyScreen' && e.key === 'Enter') {
        import('./ui.js').then(({ readyUp }) => readyUp());
        return;
    }

    if (!State.isGameActive || State.gameEndTime) return;
    if (!activeScreen || activeScreen.id !== 'gameScreen') return;

    const key = e.key.toUpperCase();

    if (key === 'ENTER') {
        submitGuess();
    } else if (key === 'BACKSPACE') {
        deleteLetter();
    } else if (/^[A-Z]$/.test(key)) {
        addLetter(key);
    }
}

export function addLetter(letter) {
    if (State.currentTile < 5) {
        const tile = document.getElementById(`tile-${State.currentRow}-${State.currentTile}`);
        if (!tile) return;

        tile.textContent = letter;
        tile.classList.add('filled');
        State.setCurrentTile(State.currentTile + 1);
    }
}

export function deleteLetter() {
    if (State.currentTile > 0) {
        State.setCurrentTile(State.currentTile - 1);
        const tile = document.getElementById(`tile-${State.currentRow}-${State.currentTile}`);
        if (!tile) return;

        tile.textContent = '';
        tile.classList.remove('filled');
    }
}

export function submitGuess() {
    if (State.currentTile !== 5) return;

    const guess = [];
    for (let i = 0; i < 5; i++) {
        const tile = document.getElementById(`tile-${State.currentRow}-${i}`);
        if (tile) guess.push(tile.textContent);
    }
    const guessWord = guess.join('');

    if (!validWords.has(guessWord.toUpperCase())) {
        // Invalid word - clear the row
        for (let i = 0; i < 5; i++) {
            const tile = document.getElementById(`tile-${State.currentRow}-${i}`);
            if (tile) {
                tile.textContent = '';
                tile.classList.remove('filled');
            }
        }
        State.setCurrentTile(0);
        return;
    }

    const result = checkGuess(guessWord);
    State.setGuesses([...State.guesses, { word: guessWord, result: result }]);

    // Update tiles
    for (let i = 0; i < 5; i++) {
        const tile = document.getElementById(`tile-${State.currentRow}-${i}`);
        if (tile) tile.classList.add(result[i]);

        // Update keyboard
        const letter = guess[i];
        const currentState = State.keyboardState[letter];
        if (!currentState || result[i] === 'correct') {
            State.keyboardState[letter] = result[i];
        } else if (currentState !== 'correct' && result[i] === 'present') {
            State.keyboardState[letter] = 'present';
        } else if (!currentState) {
            State.keyboardState[letter] = result[i];
        }
    }

    initializeKeyboard();
    broadcastBoardUpdate();

    if (guessWord === State.currentWord) {
        State.setGameEndTime(Date.now());
        const completionTime = (State.gameEndTime - State.gameStartTime) / 1000;
        endGame(true, completionTime);
    } else if (State.currentRow === 5) {
        State.setGameEndTime(Date.now());
        endGame(false, null);
    } else {
        State.setCurrentRow(State.currentRow + 1);
        State.setCurrentTile(0);
    }
}

export function checkGuess(guess) {
    const result = Array(5).fill('absent');
    const wordArray = State.currentWord.split('');
    const guessArray = guess.split('');

    // FIRST PASS: Check for correct letters (green tiles)
    // Mark exact position matches and remove them from the pool
    for (let i = 0; i < 5; i++) {
        if (guessArray[i] === wordArray[i]) {
            result[i] = 'correct';
            wordArray[i] = null;
        }
    }

    // SECOND PASS: Check for present letters (yellow tiles)
    // Only check letters that aren't already marked as correct
    for (let i = 0; i < 5; i++) {
        if (result[i] !== 'correct') {
            const index = wordArray.indexOf(guessArray[i]);
            if (index !== -1) {
                result[i] = 'present';
                wordArray[index] = null;
            }
        }
    }

    return result;
}

export function endGame(success, completionTime) {
    State.players[State.peer.id].completionTime = completionTime;
    State.players[State.peer.id].success = success;
    State.players[State.peer.id].finished = true;

    broadcastToAll({
        type: 'gameComplete',
        playerId: State.peer.id,
        time: completionTime,
        success: success
    });

    if (State.isHost) {
        import('./ui.js').then(({ checkAllPlayersFinished }) => checkAllPlayersFinished());
    }
}

export function forfeitRound() {
    if (State.gameEndTime) return; // Already finished

    State.setGameEndTime(Date.now());

    // Update forfeit button
    const forfeitBtn = document.getElementById('forfeitBtn');
    if (forfeitBtn) {
        forfeitBtn.textContent = 'Forfeited';
        forfeitBtn.disabled = true;
        forfeitBtn.style.background = '#3a3a3c';
        forfeitBtn.style.opacity = '0.5';
    }

    // Notify other players
    const forfeitMessage = `${State.myUsername} has forfeited the round.`;
    addChatMessage('System', forfeitMessage);

    broadcastToAll({
        type: 'chat',
        username: 'System',
        message: forfeitMessage,
        senderId: State.peer.id
    });

    endGame(false, null);
}

export function resetGameState() {
    State.setCurrentRow(0);
    State.setCurrentTile(0);
    State.setGuesses([]);
    State.setGameEndTime(null);
    State.setKeyboardState({});

    // Reset player boards
    Object.keys(State.players).forEach(playerId => {
        State.players[playerId].board = [];
        State.players[playerId].completionTime = null;
        State.players[playerId].success = false;
        State.players[playerId].finished = false;
    });
}

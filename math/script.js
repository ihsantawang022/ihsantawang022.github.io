document.addEventListener('DOMContentLoaded', () => {

    // --- 1. PENGUMPULAN ELEMEN UI ---
    const ui = {
        mainMenu: document.getElementById('main-menu'),
        modeSelection: document.getElementById('mode-selection'),
        operationSelection: document.getElementById('operation-selection'),
        difficultySelection: document.getElementById('difficulty-selection'),
        gameContainer: document.getElementById('game-container'),
        resultContainer: document.getElementById('result-container'),
        
        startBtn: document.getElementById('start-btn'),
        playAgainBtn: document.getElementById('play-again-btn'),

        scoreDisplay: document.getElementById('score'),
        answerPreview: document.getElementById('answer-preview'),
        divider: document.querySelector('.divider'),

        player1: {
            box: document.getElementById('player1-box'),
            question: document.getElementById('q1'),
            options: document.getElementById('opt1'),
            progressBar: document.getElementById('progress-bar-P1')
        },
        player2: {
            box: document.getElementById('player2-box'),
            question: document.getElementById('q2'),
            options: document.getElementById('opt2'),
            progressBar: document.getElementById('progress-bar-P2')
        },
        backgroundMusic: document.getElementById('background-music'),
        clickSound: document.getElementById('click-sound'),
        // ELEMEN SUARA KEMENANGAN DIAMBIL
        winSound: document.getElementById('win-sound')
    };
    
    // --- KONTROL MUSIK LATAR ---
    let isMusicStarted = false;
    function tryPlayMusic() {
        if (ui.backgroundMusic && !isMusicStarted) {
            ui.backgroundMusic.play().then(() => {
                isMusicStarted = true;
                document.body.removeEventListener('click', tryPlayMusic);
            }).catch(error => {
                console.log("Browser memblokir pemutaran otomatis, menunggu interaksi pengguna selanjutnya.");
            });
        }
    }
    document.body.addEventListener('click', tryPlayMusic);

    // --- KONTROL SUARA KLIK ---
    function playClickSound() {
        if (ui.clickSound) {
            ui.clickSound.currentTime = 0;
            ui.clickSound.play().catch(e => console.log("Gagal memutar suara klik:", e));
        }
    }
    document.addEventListener('click', playClickSound);


    // --- 2. STATE MANAGEMENT GAME ---
    let gameState = {};

    function resetGameState() {
        gameState = {
            mode: 'one-player',
            operation: 'addition',
            difficulty: 'easy',
            questionCount: 0,
            maxQuestions: 10,
            scores: { P1: 0, P2: 0 },
            history: [],
            timers: { P1: null, P2: null },
            currentQuestions: { P1: null, P2: null },
        };
    }

    // --- 3. FUNGSI LOGIKA GAME ---

    function startGame() {
        showView('gameContainer');
        nextQuestion();
    }

    function nextQuestion() {
        gameState.questionCount++;
        
        clearTimers();
        setPlayerBlur('P1', false);
        setPlayerBlur('P2', false);
        
        gameState.currentQuestions.P1 = createQuestionData();
        updatePlayerUI('P1');

        if (gameState.mode === 'two-player') {
            gameState.currentQuestions.P2 = createQuestionData();
            updatePlayerUI('P2');
            ui.player2.box.style.display = 'flex';
            ui.divider.style.display = 'block';
        } else {
            ui.player2.box.style.display = 'none';
            ui.divider.style.display = 'none';
        }

        setupTurn('P1');
    }
    
    function setupTurn(player) {
        if (gameState.mode === 'two-player') {
            setPlayerBlur('P1', player !== 'P1');
            setPlayerBlur('P2', player !== 'P2');
        }
        startTimer(player);
    }

    function processAnswer(player, selectedValue) {
        if (gameState.currentQuestions[player].isAnswered) return;

        stopTimer(player);
        const question = gameState.currentQuestions[player];
        question.isAnswered = true;
        question.selectedAnswer = selectedValue;
        question.isCorrect = (selectedValue == question.correctAnswer);

        if (question.isCorrect) {
            gameState.scores[player]++;
        }
        
        updateAnswerUI(player);
        handleTurnEnd(player);
    }
    
    function handleTimeout(player) {
        if (gameState.currentQuestions[player].isAnswered) return;
        
        const question = gameState.currentQuestions[player];
        question.isAnswered = true;
        question.selectedAnswer = "Waktu Habis";
        question.isCorrect = false;

        updateAnswerUI(player, true);
        handleTurnEnd(player);
    }

    function handleTurnEnd(player) {
        if (gameState.mode === 'one-player') {
            setTimeout(nextQuestionOrEnd, 1200);
        } else { // Two-player mode
            if (player === 'P1') {
                setupTurn('P2');
            } else {
                setTimeout(nextQuestionOrEnd, 1500);
            }
        }
    }
    
    function nextQuestionOrEnd() {
        recordHistory();
        if (gameState.questionCount >= gameState.maxQuestions) {
            endGame();
        } else {
            nextQuestion();
        }
    }

    function recordHistory() {
        const q1 = gameState.currentQuestions.P1;
        if (!q1) return;
        
        const p1Result = {
            question: q1.questionText,
            selected: q1.selectedAnswer,
            correct: q1.correctAnswer, 
            isCorrect: q1.isCorrect
        };

        let p2Result = null;
        if (gameState.mode === 'two-player') {
            const q2 = gameState.currentQuestions.P2;
            p2Result = {
                question: q2.questionText,
                selected: q2.selectedAnswer,
                correct: q2.correctAnswer,
                isCorrect: q2.isCorrect
            };
        }
        gameState.history.push({ p1: p1Result, p2: p2Result });
    }

    function endGame() {
        showView('resultContainer');
        const scoreP1 = gameState.scores.P1;
        const scoreP2 = gameState.scores.P2;
        
        let finalScoreText, gameOutcomeMessage;
        let didWin = false; // Flag untuk menandai kemenangan

        if (gameState.mode === 'one-player') {
            finalScoreText = `Skor Anda: ${scoreP1} / ${gameState.maxQuestions}`;
            if (scoreP1 === gameState.maxQuestions) {
                gameOutcomeMessage = "<br>Sempurna! Selamat!";
                didWin = true; // Menang jika skor sempurna
            } else {
                gameOutcomeMessage = "<br>Game Selesai!";
            }
        } else { // two-player mode
            finalScoreText = `Skor P1: ${scoreP1} | Skor P2: ${scoreP2}`;
            if (scoreP1 > scoreP2) {
                gameOutcomeMessage = "<br>Pemain 1 Menang!";
                didWin = true;
            } else if (scoreP2 > scoreP1) {
                gameOutcomeMessage = "<br>Pemain 2 Menang!";
                didWin = true;
            } else {
                gameOutcomeMessage = "<br>Seri!";
            }
        }
        ui.scoreDisplay.innerHTML = `${finalScoreText}${gameOutcomeMessage}`;
        
        // Putar suara kemenangan jika menang
        if (didWin && ui.winSound) {
            ui.winSound.play().catch(e => console.log("Gagal memutar suara kemenangan:", e));
        }
        
        renderHistoryTable();
    }


    // --- 4. FUNGSI PEMBUATAN SOAL ---
    function createQuestionData() {
        let num1, num2, questionText, correctAnswer, op;
        let currentOperation = gameState.operation;
        if (currentOperation === 'mixed') {
            const ops = ['addition', 'subtraction', 'multiplication', 'division'];
            currentOperation = ops[Math.floor(Math.random() * ops.length)];
        }
        
        const ranges = { easy: [1, 10], medium: [10, 50], hard: [50, 200] };
        const currentRange = ranges[gameState.difficulty];

        switch (currentOperation) {
            case 'subtraction':
                op = '−';
                num1 = Math.floor(Math.random() * (currentRange[1] - currentRange[0] + 1)) + currentRange[0];
                num2 = Math.floor(Math.random() * (currentRange[1] - currentRange[0] + 1)) + currentRange[0];
                if (num1 < num2) [num1, num2] = [num2, num1];
                if (num1 === num2) num1++;
                correctAnswer = num1 - num2;
                break;
            case 'multiplication':
                op = '×';
                const mulRanges = { easy: [2, 9], medium: [5, 12], hard: [10, 20] };
                const mulRange = mulRanges[gameState.difficulty];
                num1 = Math.floor(Math.random() * (mulRange[1] - mulRange[0] + 1)) + mulRange[0];
                num2 = Math.floor(Math.random() * (mulRange[1] - mulRange[0] + 1)) + mulRange[0];
                correctAnswer = num1 * num2;
                break;
            case 'division':
                op = '÷';
                const divRanges = { easy: [2, 9], medium: [5, 12], hard: [8, 15] };
                const divRange = divRanges[gameState.difficulty];
                num2 = Math.floor(Math.random() * (divRange[1] - divRange[0] + 1)) + divRange[0];
                const result = Math.floor(Math.random() * 8) + 2;
                num1 = num2 * result;
                correctAnswer = result;
                break;
            default: // Addition
                op = '+';
                num1 = Math.floor(Math.random() * (currentRange[1] - currentRange[0] + 1)) + currentRange[0];
                num2 = Math.floor(Math.random() * (currentRange[1] - currentRange[0] + 1)) + currentRange[0];
                correctAnswer = num1 + num2;
                break;
        }

        questionText = `${num1} ${op} ${num2}`;
        const optionsSet = new Set([correctAnswer]);
        while (optionsSet.size < 4) {
            const variation = Math.floor(correctAnswer * 0.5) + 5;
            const fakeAnswer = correctAnswer + Math.floor(Math.random() * variation * 2) - variation;
            if (fakeAnswer !== correctAnswer && fakeAnswer >= 0) optionsSet.add(Math.round(fakeAnswer));
        }
        
        return {
            questionText,
            correctAnswer,
            options: Array.from(optionsSet).sort(() => Math.random() - 0.5),
            isAnswered: false,
            isCorrect: false,
            selectedAnswer: null,
            timerStart: 0
        };
    }

    // --- 5. FUNGSI PEMBARUAN TAMPILAN (UI) ---

    function showView(viewName) {
        ui.mainMenu.style.display = 'none';
        ui.gameContainer.style.display = 'none';
        ui.resultContainer.style.display = 'none';

        if (viewName === 'gameContainer' || viewName === 'resultContainer') {
            ui[viewName].style.display = 'flex';
        } else {
            ui.mainMenu.style.display = 'flex';
            
            ui.startBtn.style.display = 'none';
            ui.modeSelection.style.display = 'none';
            ui.operationSelection.style.display = 'none';
            ui.difficultySelection.style.display = 'none';

            if (viewName === 'mainMenu') {
                ui.startBtn.style.display = 'inline-block';
            } else if (ui[viewName]) {
                ui[viewName].style.display = 'flex';
            }
        }
    }

    function renderHistoryTable() {
        const previewContainer = document.getElementById('answer-preview-wrapper');
        if (!previewContainer) return;
        previewContainer.innerHTML = ''; 

        const table = document.createElement('table');

        let headerHtml = '';
        if (gameState.mode === 'one-player') {
            headerHtml = `<thead><tr><th>No.</th><th>Soal</th><th>Jawabanmu (Benar)</th><th>Hasil</th></tr></thead>`;
        } else {
            headerHtml = `<thead><tr><th>No.</th><th>Soal (P1)</th><th>Jwb (P1)</th><th>Soal (P2)</th><th>Jwb (P2)</th></tr></thead>`;
        }

        const bodyHtml = gameState.history.map((entry, idx) => {
            const p1 = entry.p1;
            const p2 = entry.p2;
            
            const p1AnswerCell = `<td class="${p1.isCorrect ? 'correct-text' : 'wrong-text'}">${p1.selected} (${p1.correct})</td>`;
            
            if (gameState.mode === 'one-player') {
                return `<tr>
                    <td>${idx + 1}</td>
                    <td>${p1.question}</td>
                    ${p1AnswerCell}
                    <td>${p1.isCorrect ? '✔️' : '❌'}</td>
                </tr>`;
            } else {
                const p2AnswerCell = `<td class="${p2.isCorrect ? 'correct-text' : 'wrong-text'}">${p2.selected} (${p2.correct})</td>`;
                return `<tr>
                    <td>${idx + 1}</td>
                    <td>${p1.question}</td>
                    ${p1AnswerCell}
                    <td>${p2.question}</td>
                    ${p2AnswerCell}
                </tr>`;
            }
        }).join('');

        table.innerHTML = `${headerHtml}<tbody>${bodyHtml}</tbody>`;
        previewContainer.appendChild(table);
    }
    
    function setPlayerBlur(player, shouldBlur) {
        const key = 'player' + player.slice(-1);
        const box = ui[key].box;
        shouldBlur ? box.classList.add('blurred-content') : box.classList.remove('blurred-content');
    }

    function updatePlayerUI(player) {
        const key = 'player' + player.slice(-1);
        const playerUI = ui[key];
        const questionData = gameState.currentQuestions[player];
        
        playerUI.question.textContent = questionData.questionText;
        playerUI.options.innerHTML = '';
        
        questionData.options.forEach(val => {
            const btn = document.createElement("button");
            btn.className = "option-btn";
            btn.textContent = val;
            btn.addEventListener('click', () => processAnswer(player, val));
            playerUI.options.appendChild(btn);
        });
    }

    function updateAnswerUI(player, isTimeout = false) {
        const key = 'player' + player.slice(-1);
        const playerUI = ui[key];
        const questionData = gameState.currentQuestions[player];
        const buttons = playerUI.options.querySelectorAll('button');

        buttons.forEach(btn => {
            btn.disabled = true;
            const btnValue = parseInt(btn.textContent);
            if (btnValue === questionData.correctAnswer) {
                btn.classList.add("correct");
            } else if (!isTimeout && btnValue == questionData.selectedAnswer) {
                btn.classList.add("wrong");
            }
        });
    }

    // --- 6. FUNGSI TIMER ---
    const TIMER_DURATION = 10000;

    function startTimer(player) {
        const key = 'player' + player.slice(-1);
        const question = gameState.currentQuestions[player];
        question.timerStart = Date.now();
        
        function frame() {
            const elapsed = Date.now() - question.timerStart;
            const remainingPercentage = Math.max(0, 100 - (elapsed / TIMER_DURATION) * 100);
            ui[key].progressBar.style.width = `${remainingPercentage}%`;

            if (remainingPercentage > 0) {
                gameState.timers[player] = requestAnimationFrame(frame);
            } else {
                handleTimeout(player);
            }
        }
        gameState.timers[player] = requestAnimationFrame(frame);
    }
    
    function stopTimer(player) {
        if(gameState.timers[player]) cancelAnimationFrame(gameState.timers[player]);
    }

    function clearTimers() {
        stopTimer('P1');
        stopTimer('P2');
        if(ui.player1.progressBar) ui.player1.progressBar.style.width = '100%';
        if(ui.player2.progressBar) ui.player2.progressBar.style.width = '100%';
    }

    // --- 7. INISIALISASI EVENT LISTENER ---
    function initEventListeners() {
        ui.startBtn.addEventListener('click', () => {
            showView('modeSelection');
        });
        
        ui.modeSelection.addEventListener('click', e => {
            if (e.target.tagName !== 'BUTTON') return;
            resetGameState();
            gameState.mode = e.target.id;
            showView('operationSelection');
        });
        
        ui.operationSelection.addEventListener('click', e => {
            const button = e.target.closest('.op-btn');
            if (!button) return;
            gameState.operation = button.dataset.op;
            showView('difficultySelection');
        });

        ui.difficultySelection.addEventListener('click', e => {
            if (e.target.tagName !== 'BUTTON') return;
            gameState.difficulty = e.target.id.replace('difficulty-', '');
            startGame();
        });

        ui.playAgainBtn.addEventListener('click', () => {
            showView('mainMenu');
        });
    }

    // --- MULAI APLIKASI ---
    initEventListeners();
    showView('mainMenu');
    resetGameState();
});

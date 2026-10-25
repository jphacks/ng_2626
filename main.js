
"use strict";

// ========================================
// 1. HTML要素を取得
// ========================================

const canvas = document.getElementById("artCanvas");
const status = document.getElementById("status");
const motionReadout = document.getElementById("motionReadout");
// const startButton = document.getElementById("startButton");
const clearButton = document.getElementById("clearButton");
const correctButton = document.getElementById("correctButton");
const pauseButton = document.getElementById("pauseButton");
const promptButton = document.getElementById("promptButton");
const wordDisplay = document.getElementById("Word");

// ▼ 完成・署名・保存のために追加した要素
const finishButton = document.getElementById("finishButton");     // 「完成」ボタン
const signControls = document.getElementById("signControls");     // 署名中だけ表示する操作エリア
const redoSignButton = document.getElementById("redoSignButton"); // 「自分の署名を書き直す」ボタン
const finishPanel = document.getElementById("finishPanel");       // 完成後に表示するタイトル・保存エリア
const titleInput = document.getElementById("titleInput");         // タイトルの入力欄
const saveButton = document.getElementById("saveButton");         // 「画像を保存・共有」ボタン


const ctx = canvas?.getContext("2d");
// 線の波打ちと残像を管理する
let waveStrength = 0;
let wavePhase = 0;

// 過去の軌跡を保存する透明キャンバス
const trailCanvas = document.createElement("canvas");
const trailCtx = trailCanvas.getContext("2d");

// 残像の消える速さ（大きいほど早く消える）
const trailFade = 0.005;
//pythonサーバーの状態を取得
let serverAvailable = false;

// Pythonで生成した、にじみ・混色済みの画像
let refinedImage = null;

// いまの画面のモード
//   "draw"   … 作品を描いている
//   "sign"   … 完成ボタンを押したあと，1人ずつ署名している（寄せ書き）
//   "finish" … 署名が終わり，タイトルを付けて保存する
let appMode = "draw";

correctButton.disabled = true;
correctButton.textContent = "補正サーバー未接続";

async function checkPythonServer() {
    // index.htmlを直接開いた場合は描画専用モード
    if (location.protocol === "file:") {
        serverAvailable = false;
        correctButton.disabled = true;
        correctButton.textContent = "補正にはサーバーが必要";
        return;
    }

    try {
        const response = await fetch("/api/health", {
            signal: AbortSignal.timeout(2000)
        });

        if (!response.ok) {
            throw new Error("サーバー応答エラー");
        }

        const data = await response.json();
        serverAvailable = data.ok === true;
    } catch {
        serverAvailable = false;
    }

    // 署名中・完成後は，サーバーがつながっていても補正ボタンを押せなくする
    correctButton.disabled = !serverAvailable || appMode !== "draw";
    correctButton.textContent = serverAvailable
        ? "形状を補正"
        : "補正サーバー未接続";
}

// 起動時に確認し、その後も定期的に確認
checkPythonServer();
setInterval(checkPythonServer, 5000);

// 必須要素が取得できなければ、ここで原因を表示する
const missingElements = [];

if (!canvas) missingElements.push("#artCanvas");
if (!status) missingElements.push("#status");
if (!motionReadout) missingElements.push("#motionReadout");
// if (!startButton) missingElements.push("#startButton");
if (!clearButton) missingElements.push("#clearButton");
if (!ctx) missingElements.push("Canvas 2D context");
if (!pauseButton) missingElements.push("#pauseButton");
if (!promptButton) missingElements.push("#promptButton");
if (!wordDisplay) missingElements.push("#Word");
if (!finishButton) missingElements.push("#finishButton");
if (!signControls) missingElements.push("#signControls");
if (!redoSignButton) missingElements.push("#redoSignButton");
if (!finishPanel) missingElements.push("#finishPanel");
if (!titleInput) missingElements.push("#titleInput");
if (!saveButton) missingElements.push("#saveButton");

if (missingElements.length > 0) {
    console.error(
        "OTOIRO：HTML要素が見つかりません:",
        missingElements.join(", ")
    );
    throw new Error("HTMLのIDとJavaScriptを確認してください");
}

// ========================================
// 2. 状態を管理
// ========================================

let isStarted = false;
let strokes = [];
let originalStrokes = [];

let shakeOffsetX = 0;
let shakeOffsetY = 0;
let previousMotion = null;
let motionTrail = [];
const maxMotionTrailPoints = 500;

// 一時停止と交代の状態
let isPaused = false;
let currentPlayer = 0;      // 何人目か（0始まり）
let motionGranted = false;  // センサーの許可が取れたか

// ---- 署名（寄せ書き）の状態 ----
// 署名の線は，作品の線（strokes）とは別の配列に入れる．
// こうすると署名には「にじみ」「揺れ」「形状の補正」がかからず，
// その人の署名だけを消して書き直すこともできる．
let signatures = [];             // 署名の線をすべて保存する配列
const signTouches = new Map();   // 署名中に触れている指（pointerIdごと）
const drawnPlayers = new Set();  // 実際に作品を描いた人の番号（署名する人の一覧に使う）
let signers = [];                // 署名する人の番号を順番に並べたもの
let signerIndex = 0;             // signers の何番目の人が署名中か

// 署名の線の見た目（作品の線とは別の設定）
const SIGN_LINE_WIDTH = 2.5;     // 署名の線の太さ（作品の線は8）
const SIGN_OUTLINE_WIDTH = 7;    // 絵の上でも読めるように付ける縁取りの太さ
const SIGN_OUTLINE_COLOR = "rgba(10, 10, 20, 0.85)"; // 縁取りの色（背景に近い暗い色）

// ---- 完成画面・保存の状態 ----
let currentPrompt = "";          // 表示中のお題（タイトルの初期値と保存画像に使う）
let exportFile = null;           // 保存・共有用に作っておいた画像ファイル
let exportFileTitle = "";        // exportFile を作ったときのタイトル（変わったら作り直す）
let prepareTimer = null;         // タイトル入力中に何度も画像を作らないためのタイマー
// お題の表示設定
const promptWord = ["『周囲の音』を表現してみて", "今の気分を表現してみて", "好きな音楽のノリを線で"]

[Math.floor(Math.random() * 3)]; // お題の単語をランダムに選択
let showingPrompt = false;

// お題
const promptWords = ["今の気分を形で", "好きな音楽のノリを形で", "今いる場所の空気を形で", "未来の想像を形で", "周囲の音を形で", "最近の出来事を形で", "好きな季節を形で", "自分の感情を形で", "夢の中の景色を形で"];

promptButton.addEventListener("click", () => {
    const word = promptWords[Math.floor(Math.random() * promptWords.length)];
    wordDisplay.textContent = `お題：${word}`;

    // タイトルの初期値と保存画像で使うので覚えておく
    currentPrompt = word;
});

function drawMotionTrail() {
    if (motionTrail.length < 2) return;

    for (let i = 1; i < motionTrail.length; i++) {
        const progress = i / motionTrail.length;
        ctx.beginPath();
        ctx.moveTo(motionTrail[i - 1].x, motionTrail[i - 1].y);
        ctx.lineTo(motionTrail[i].x, motionTrail[i].y);
        ctx.strokeStyle = `rgba(82, 229, 255, ${progress * 0.22})`;
        ctx.lineWidth = 1;
        ctx.lineCap = "round";
        ctx.stroke();
    }
}

function getDeformedPoint(point, index, strokeIndex) {
    const phase = index * 0.25 + wavePhase + strokeIndex * 1.7;

    return {
        x: point.x + Math.sin(phase) * waveStrength,
        y: point.y + Math.cos(phase * 0.8) * waveStrength * 0.6
    };
}


function drawStrokeList(targetCtx, list, deform = false) {
    list.forEach((stroke, strokeIndex) => {
        const color = stroke.color || "#222222";
        const width = stroke.type === "tap"
            ? 6
            : (stroke.width || 3);

        const points = stroke.type === "tap"
            ? [{ x: stroke.x, y: stroke.y }]
            : stroke.points;

        if (!points || points.length === 0) return;

        // パスを作る共通関数
        function makePath() {
            targetCtx.beginPath();

            if (stroke.type === "tap") {
                const point = deform
                    ? getDeformedPoint(points[0], 0, strokeIndex)
                    : points[0];

                targetCtx.arc(
                    point.x,
                    point.y,
                    stroke.radius || width / 2,
                    0,
                    Math.PI * 2
                );
                return;
            }

            const first = deform
                ? getDeformedPoint(points[0], 0, strokeIndex)
                : points[0];

            targetCtx.moveTo(first.x, first.y);

            for (let i = 1; i < points.length; i++) {
                const point = deform
                    ? getDeformedPoint(points[i], i, strokeIndex)
                    : points[i];

                targetCtx.lineTo(point.x, point.y);
            }

            if (stroke.closed) {
                targetCtx.closePath();
            }
        }

        // 1. 外側の薄い墨のにじみ
        targetCtx.save();
        // 不透明度：振ったあとの濃さに合わせて 0.03 → 0.8 に変更
        // （以前は振ったときの残像が重なって初めて濃く見えていたため，
        //   起動直後は線が薄く見えていた）
        targetCtx.globalAlpha = 0.8;
        targetCtx.filter = "blur(6px)";
        targetCtx.strokeStyle = color;
        targetCtx.fillStyle = color;
        targetCtx.lineWidth = width * 2.5;
        targetCtx.lineCap = "round";
        targetCtx.lineJoin = "round";

        makePath();

        if (stroke.type === "tap" || points.length === 1) {
            targetCtx.fill();
        } else {
            targetCtx.stroke();
        }
        targetCtx.restore();

        // 2. 中間の墨
        targetCtx.save();
        // 不透明度：0.04 → 1（振ったあとの濃さに合わせる）
        targetCtx.globalAlpha = 1;
        targetCtx.filter = "blur(1.5px)";
        targetCtx.strokeStyle = color;
        targetCtx.fillStyle = color;
        targetCtx.lineWidth = width * 1.5;
        targetCtx.lineCap = "round";
        targetCtx.lineJoin = "round";

        makePath();

        if (stroke.type === "tap" || points.length === 1) {
            targetCtx.fill();
        } else {
            targetCtx.stroke();
        }
        targetCtx.restore();

        // 3. 中心の濃い墨
        targetCtx.save();
        // 不透明度：0.07 → 1（振ったあとの濃さに合わせる）
        targetCtx.globalAlpha = 1;
        targetCtx.filter = "none";
        targetCtx.strokeStyle = color;
        targetCtx.fillStyle = color;
        targetCtx.lineWidth = width;
        targetCtx.lineCap = "round";
        targetCtx.lineJoin = "round";

        makePath();

        if (stroke.type === "tap" || points.length === 1) {
            targetCtx.fill();
        } else {
            targetCtx.stroke();
        }
        targetCtx.restore();
    });
}


function renderStrokes(list = strokes) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Pythonで生成した画像があれば、それを表示する
    if (refinedImage && list === strokes) {
        ctx.drawImage(
            refinedImage,
            0,
            0,
            canvas.width,
            canvas.height
        );

        // にじみ画像の上に、端末を振った残像を重ねる
        ctx.drawImage(trailCanvas, 0, 0);
    } else {
        // 通常の描画モード
        ctx.drawImage(trailCanvas, 0, 0);

        ctx.save();
        ctx.globalAlpha = 1;
        drawStrokeList(ctx, list, true);
        ctx.restore();
    }

    // 署名は作品の一番上に重ねる（効果なしの細い線）
    drawSignatures(ctx);
}

function handleDeviceMotion(event) {
    const acceleration = event.accelerationIncludingGravity
        || event.acceleration;

    if (
        !acceleration ||
        acceleration.x == null ||
        acceleration.y == null
    ) {
        console.log("加速度データを取得できません");
        return;
    }

    if (previousMotion) {
        const dx = acceleration.x - previousMotion.x;
        const dy = acceleration.y - previousMotion.y;
        const magnitude = Math.hypot(dx, dy);

        // 振ったときの揺れを大きくする
        shakeOffsetX = Math.max(
            -25,
            Math.min(25, shakeOffsetX + dx * 3)
        );

        shakeOffsetY = Math.max(
            -25,
            Math.min(25, shakeOffsetY + dy * 3)
        );
        // 加速度の変化量から波の強さを計算

        waveStrength = Math.min(
            35,
            waveStrength + magnitude * 1.8
        );

        // 波の位相を進める
        wavePhase += magnitude * 0.25;

    }

    previousMotion = {
        x: acceleration.x,
        y: acceleration.y
    };
}

function animateShake() {
    // 署名中・完成後は作品を固定する
    // （揺れや残像を更新せず，今の状態を描き直すだけにする）
    if (appMode !== "draw") {
        renderStrokes();
        if (isStarted) {
            requestAnimationFrame(animateShake);
        }
        return;
    }

    // 波の揺れを徐々に弱める
    waveStrength *= 0.97;
    if (waveStrength < 0.05) {
        waveStrength = 0;
    }

    // 波を少しずつ進める
    wavePhase += 0.04;

    // 残像を少しずつ透明にする
    trailCtx.save();
    trailCtx.globalCompositeOperation = "lighter";
    trailCtx.fillStyle = `rgba(0, 0, 0, ${trailFade})`;
    trailCtx.fillRect(0, 0, trailCanvas.width, trailCanvas.height);
    trailCtx.fillRect(
        0,
        0,
        trailCanvas.width,
        trailCanvas.height
    );
    trailCtx.restore();

    // 波打った線を残像キャンバスへ追加
    if (waveStrength > 0.5) {
        trailCtx.save();
        trailCtx.globalAlpha = 0.35;
        drawStrokeList(trailCtx, strokes, true);
        trailCtx.restore();
    }

    renderStrokes();

    if (isStarted) {
        requestAnimationFrame(animateShake);
    }
}
async function enableMotionSensor() {
    if (!("DeviceMotionEvent" in window)) {
        console.warn("DeviceMotionEventに対応していません");
        return false;
    }

    try {
        // iOSなど、明示的な許可が必要なブラウザ
        if (
            typeof DeviceMotionEvent.requestPermission === "function"
        ) {
            const permission =
                await DeviceMotionEvent.requestPermission();

            if (permission !== "granted") {
                console.warn("モーションセンサーが許可されませんでした");
                return false;
            }
        }

        // 古いリスナーの重複登録を防ぐ
        window.removeEventListener(
            "devicemotion",
            handleDeviceMotion
        );

        previousMotion = null;

        window.addEventListener(
            "devicemotion",
            handleDeviceMotion
        );

        console.log("モーションセンサーのイベントを登録しました");
        return true;

    } catch (error) {
        console.error("センサーの初期化に失敗しました:", error);
        return false;
    }
}

// 許可済みならセンサーを再開する
function startMotion() {
    if (!motionGranted) return;

    window.removeEventListener("devicemotion", handleDeviceMotion);
    previousMotion = null;
    window.addEventListener("devicemotion", handleDeviceMotion);
    motionReadout.textContent = "";
}

// センサーを止めて，揺れもリセットする
function stopMotion() {
    window.removeEventListener("devicemotion", handleDeviceMotion);
    previousMotion = null;
    waveStrength = 0;
    motionReadout.textContent = "一時停止中（センサー停止）";
}

// 今の人の色を返す
function getPlayerColor() {
    return colors[currentPlayer % colors.length];
}

// pointerIdごとに、各指の座標と色を記録する
const activeTouches = new Map();

// 色のセット（あとで中身を差し替えてください）
const colorSets = [
    ["#52e5ff", "#ff6bd6", "#ffe66d", "#7cff6b", "#b388ff"], // セット1：ネオン
    ["#ff3b3b", "#ff9f1c", "#ffe600", "#00e676", "#2979ff"], // セット2：ビビッド原色
    ["#ff4f8b", "#ff7a3d", "#c86bff", "#3dd9ff", "#3dffb0"], // セット3：トロピカル
    ["#00f5d4", "#00bbf9", "#9b5de5", "#f15bb5", "#fee440"], // セット4：ポップ
];

// ランダムに1セット選ぶ
const colors = colorSets[Math.floor(Math.random() * colorSets.length)];

// 音声の状態を保存する
const audioState = {
    context: null
};
const SOUND_VOLUME = 1.0; // 音量を小さくする（0.0〜1.0）

// 関数を短く呼び出せるようにする
const fn = window.OTOIROFunctions;

if (!fn) {
    throw new Error("functions.jsが読み込まれていません");
}

// ========================================
// 3. キャンバスの準備
// ========================================

function resizeCanvas() {
    fn.resizeCanvas(canvas, ctx);

    // 残像キャンバスも同じサイズにする
    trailCanvas.width = canvas.width;
    trailCanvas.height = canvas.height;

    renderStrokes();

}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// ========================================
// 4. 起動と同時に描画を開始
// ========================================

let motionRequested = false;

function startInteraction() {
    if (isStarted) return;

    isStarted = true;
    status.textContent = "画面に触れて描こう";
    requestAnimationFrame(animateShake);

    console.log("OTOIRO：操作を開始しました");
}

async function requestMotionOnce() {
    if (motionRequested) return;
    motionRequested = true;

    motionGranted = await enableMotionSensor();
    if (!motionGranted) {
        motionReadout.textContent = "加速度センサーを利用できません";
    }
}

// 一時停止して次の人へ交代
function pauseDrawing() {
    if (isPaused) return;

    isPaused = true;
    activeTouches.clear();
    stopMotion();

    currentPlayer++;
    pauseButton.disabled = true;
    status.textContent =
        `${currentPlayer + 1}人目の番です．画面に触れると描き始めます`;
}

// 次の人が触れたら再開
function resumeDrawing() {
    isPaused = false;
    startMotion();
    pauseButton.disabled = false;
}

pauseButton.addEventListener("click", () => {
    // 署名中は「次の人の署名へ」ボタンとして使う
    if (appMode === "sign") {
        nextSigner();
        return;
    }

    // 描画中は今までどおり描き手を交代する
    pauseDrawing();
});

startInteraction();

// ========================================
// 5. 指が触れたとき
// ========================================

canvas.addEventListener("pointerdown", (event) => {
    console.log("pointerdown:", event.pointerType, event.pointerId);

    /*    if (!isStarted) {
            status.textContent = "先に開始ボタンを押してください";
            return;
        }
    */

    if (event.pointerType === "mouse" && event.button !== 0) {
        return;
    }

    // 完成画面では，キャンバスに触れても何も描かない
    if (appMode === "finish") {
        return;
    }

    // 署名中は，作品ではなく署名の線として記録する
    if (appMode === "sign") {
        event.preventDefault();
        startSignStroke(event);
        return;
    }

    event.preventDefault();

    // 一時停止中なら，このタッチで再開する
    if (isPaused) {
        resumeDrawing();
    }

    const pos = fn.getPosition(event, canvas);
    const color = getPlayerColor();   // 指の本数ではなく人で決める

    activeTouches.set(event.pointerId, {
        startX: pos.x,
        startY: pos.y,
        x: pos.x,
        y: pos.y,
        color,
        player: currentPlayer,        // 追加
        moved: false,
        stroke: {
            points: [{ x: pos.x, y: pos.y }],
            color,
            player: currentPlayer,    // 追加
            width: 8,
            closed: false
        }
    });

    // キャンバスの外へ指が動いても追跡する
    canvas.setPointerCapture(event.pointerId);


    const count = activeTouches.size;
    fn.updateStatus(status, count);
    fn.playSound(audioState, count, 0.15);
});

// ========================================
// 6. 指が動いたとき
// ========================================

canvas.addEventListener("pointermove", (event) => {
    // 署名中は署名用の処理に任せる
    if (appMode === "sign") {
        moveSignStroke(event);
        return;
    }

    const touch = activeTouches.get(event.pointerId);


    if (!touch) return;

    event.preventDefault();

    const pos = fn.getPosition(event, canvas);
    const dx = pos.x - touch.startX;
    const dy = pos.y - touch.startY;
    const distance = Math.hypot(dx, dy);

    if (!touch.moved) {
        if (distance <= 8) return;

        touch.moved = true;
        strokes.push(touch.stroke);
        drawnPlayers.add(touch.player); // この人は作品を描いた（署名する人の一覧に入れる）
        status.textContent = "スワイプ中";
    }

    ctx.beginPath();
    ctx.moveTo(touch.x, touch.y);
    ctx.lineTo(pos.x, pos.y);

    ctx.strokeStyle = touch.color;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.stroke();

    // 描いた座標を補正用に保存
    touch.stroke.points.push({ x: pos.x, y: pos.y });

    // 次の描画に備えて座標を更新
    touch.x = pos.x;
    touch.y = pos.y;
});

// ========================================
// 7. 指を離したとき
// ========================================

function endTouch(event) {
    // 署名中は署名用の処理に任せる（タップの円や音は出さない）
    if (appMode === "sign") {
        endSignStroke(event);
        return;
    }

    const touch = activeTouches.get(event.pointerId);
    if (!touch) return;

    // 最初に指を離したときにセンサーの許可を求める
    if (event.type === "pointerup") {
        requestMotionOnce();
    }

    if (event.type === "pointerup" && !touch.moved) {
        strokes.push({
            type: "tap",
            x: touch.startX,
            y: touch.startY,
            radius: 5 + Math.random() * 20,
            color: touch.color,
            player: touch.player
        });
        drawnPlayers.add(touch.player); // タップだけの人も署名する人の一覧に入れる
    }

    activeTouches.delete(event.pointerId);
    renderStrokes();
    fn.updateStatus(status, activeTouches.size);
    if (event.type === "pointerup") {
        status.textContent = touch.moved ? "スワイプしました" : "タップしました";
    } else {
        status.textContent = "操作がキャンセルされました";
    }

    console.log("指を離しました。残り:", activeTouches.size);
}

canvas.addEventListener("pointerup", endTouch);
canvas.addEventListener("pointercancel", endTouch);
// ========================================
// 8. pythonサーバに補正依頼
// ========================================

correctButton.addEventListener("click", async () => {
    // 署名中・完成後は作品を変えない
    if (appMode !== "draw") return;

    if (!serverAvailable) {
        status.textContent = "Pythonサーバーを起動してください";
        return;
    }
    if (strokes.length === 0) {
        status.textContent = "先にキャンバスに描いてください";
        return;
    }

    // 指で描いている途中の線があれば補正前に終了扱いにする
    activeTouches.clear();

    // 元の作品を保存しておく
    originalStrokes = JSON.parse(JSON.stringify(strokes));

    correctButton.disabled = true;
    status.textContent = "形状を解析・補正しています...";

    try {
        const response = await fetch("/api/refine", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                width: canvas.clientWidth,
                height: canvas.clientHeight,
                strokes
            })
        });

        if (!response.ok) {
            throw new Error(`サーバーエラー: ${response.status}`);
        }

        const result = await response.json();

        strokes = result.strokes;
        renderStrokes(strokes);

        status.textContent =
            `補正完了：${result.message || "形状を整えました"}`;
    } catch (error) {
        console.error(error);
        status.textContent =
            "補正できませんでした。Pythonサーバーを確認してください";
    } finally {
        correctButton.disabled = !serverAvailable || appMode !== "draw";
    }
});



// ========================================
// 9. リセットボタン
// ========================================

clearButton.addEventListener("click", () => {
    status.textContent = "画面をリセットしました";
    console.log("OTOIRO：画面をリセットしました");

    strokes = [];
    originalStrokes = [];
    activeTouches.clear();
    trailCtx.clearRect(
        0,
        0,
        trailCanvas.width,
        trailCanvas.height
    );

    waveStrength = 0;
    wavePhase = 0;

    shakeOffsetX = 0;
    shakeOffsetY = 0;
    previousMotion = null;
    wordDisplay.textContent = "";
    // 1人目からやり直す
    currentPlayer = 0;
    isPaused = false;
    pauseButton.disabled = false;

    // 署名・完成画面の状態も最初に戻す
    signatures = [];
    signTouches.clear();
    drawnPlayers.clear();
    signers = [];
    signerIndex = 0;
    currentPrompt = "";
    titleInput.value = "";
    exportFile = null;
    exportFileTitle = "";
    setMode("draw");

    startMotion();
    renderStrokes();
});

// ========================================
// 10. 画面のモード切り替え
// ========================================
//
// 流れ：描く（draw）→「完成」→ 署名（sign）→ 完成画面（finish）
// モードが変わるたびに，ボタンの表示や押せる／押せないをここでまとめて切り替える．

function setMode(mode) {
    appMode = mode;

    const isDraw = mode === "draw";
    const isSign = mode === "sign";
    const isFinish = mode === "finish";

    // 描画中だけ使うボタン
    promptButton.disabled = !isDraw;
    correctButton.disabled = !isDraw || !serverAvailable;
    finishButton.hidden = !isDraw;

    // 「次の人へ」ボタン
    //   描画中 … 描き手の交代
    //   署名中 … 署名する人の交代（文言は updateSignStatus で変える）
    //   完成後 … 使わないので隠す
    pauseButton.hidden = isFinish;
    pauseButton.disabled = false;
    if (isDraw) {
        pauseButton.textContent = "次の人へ";
    }

    // 署名中は，うっかり作品を消さないようにリセットを押せなくする
    // （完成後は「新しく描き直す」ために押せるようにしておく）
    clearButton.disabled = isSign;

    // 署名中・完成後だけ表示するエリア
    signControls.hidden = !isSign;
    finishPanel.hidden = !isFinish;
}

// ========================================
// 11. 署名モード（寄せ書き）
// ========================================

// 人の番号から色を返す（描いたときと同じ色で署名する）
function getColorForPlayer(player) {
    return colors[player % colors.length];
}

// いま署名している人の番号
function getCurrentSigner() {
    return signers[signerIndex];
}

// 「完成」ボタン：署名モードに入る
function startSigning() {
    // 1本も描いていなければ署名に進まない
    if (drawnPlayers.size === 0) {
        status.textContent = "先にキャンバスに描いてください";
        return;
    }

    // 作品を描いた人の番号を小さい順に並べ，この順番で署名してもらう
    // （「次の人へ」を押したあと誰も描かなかった番号は含まれない）
    signers = [...drawnPlayers].sort((a, b) => a - b);
    signerIndex = 0;

    // 描きかけの指の情報を捨て，交代待ちの状態も解除する
    activeTouches.clear();
    isPaused = false;

    // 加速度センサーを止め，揺れを0にして作品を固定する
    // （端末を手渡ししても作品や署名がゆがまないようにするため）
    stopMotion();
    waveStrength = 0;
    motionReadout.textContent = "署名中（揺れは止めています）";

    setMode("sign");
    updateSignStatus();
}

finishButton.addEventListener("click", startSigning);

// 画面上部に「誰が署名する番か」を表示する
function updateSignStatus() {
    const color = getColorForPlayer(getCurrentSigner());
    const isLast = signerIndex === signers.length - 1;

    // 色の丸（●）で，どの色の人の番かがひと目でわかるようにする
    status.innerHTML =
        `<span style="color:${color}">●</span> ` +
        `${signerIndex + 1} / ${signers.length} 人目の署名です．` +
        "空いているところにサインしてください";

    // 最後の人のときは，ボタンの文言を「署名を終える」に変える
    pauseButton.textContent = isLast ? "署名を終える" : "次の人の署名へ";
}

// 「次の人の署名へ」「署名を終える」ボタンを押したとき
function nextSigner() {
    signTouches.clear();

    // まだ署名していない人がいれば，次の人に交代
    if (signerIndex < signers.length - 1) {
        signerIndex++;
        updateSignStatus();
        return;
    }

    // 全員の署名が終わったら完成画面へ
    showFinishPanel();
}

// 「自分の署名を書き直す」：今の人の署名だけを消す
// （作品やほかの人の署名は消えない）
redoSignButton.addEventListener("click", () => {
    const player = getCurrentSigner();
    signatures = signatures.filter((stroke) => stroke.player !== player);
    signTouches.clear();
    renderStrokes();
});

// 署名中に指が触れたとき
function startSignStroke(event) {
    const pos = fn.getPosition(event, canvas);
    const player = getCurrentSigner();

    const stroke = {
        points: [pos],
        color: getColorForPlayer(player),
        player
    };

    // 触れた瞬間に追加しておく
    // （濁点や「i」の点のように，動かさずに離した点も署名として残すため）
    signatures.push(stroke);
    signTouches.set(event.pointerId, stroke);

    // キャンバスの外へ指が動いても追跡する
    canvas.setPointerCapture(event.pointerId);
}

// 署名中に指が動いたとき：座標を足していくだけ（描画は毎フレーム行う）
function moveSignStroke(event) {
    const stroke = signTouches.get(event.pointerId);
    if (!stroke) return;

    event.preventDefault();
    stroke.points.push(fn.getPosition(event, canvas));
}

// 署名中に指を離したとき
function endSignStroke(event) {
    signTouches.delete(event.pointerId);
}

// 署名を描く
// 作品の線とは違い，にじみ・揺れなしの細い線で描く．
// 絵の上でも読めるように，先に暗い色の縁取りを描き，その上に本体を描く．
function drawSignatures(targetCtx) {
    // 1周目で全員分の縁取り，2周目で全員分の本体を描く
    // （先に縁取りをまとめて描くと，ほかの人の縁取りが署名の本体に重ならない）
    for (const pass of ["outline", "main"]) {
        const isOutline = pass === "outline";
        const width = isOutline ? SIGN_OUTLINE_WIDTH : SIGN_LINE_WIDTH;

        signatures.forEach((stroke) => {
            const points = stroke.points;
            if (!points || points.length === 0) return;

            const color = isOutline ? SIGN_OUTLINE_COLOR : stroke.color;

            targetCtx.save();
            targetCtx.strokeStyle = color;
            targetCtx.fillStyle = color;
            targetCtx.lineWidth = width;
            targetCtx.lineCap = "round";
            targetCtx.lineJoin = "round";
            targetCtx.beginPath();

            if (points.length === 1) {
                // 点だけのときは小さな丸を塗る
                targetCtx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
                targetCtx.fill();
            } else {
                targetCtx.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) {
                    targetCtx.lineTo(points[i].x, points[i].y);
                }
                targetCtx.stroke();
            }

            targetCtx.restore();
        });
    }
}

// ========================================
// 12. 完成画面（タイトル）
// ========================================

// タイトルが空欄のときに使う名前（お題があればお題）
function getDefaultTitle() {
    return currentPrompt || "みんなの作品";
}

// 実際に使うタイトル（入力があればそれ，なければ初期値）
function getTitle() {
    return titleInput.value.trim() || getDefaultTitle();
}

// 全員の署名が終わったら呼ばれる
function showFinishPanel() {
    setMode("finish");

    // 空欄のときに何という名前になるかを薄く表示しておく
    titleInput.placeholder = `空欄なら「${getDefaultTitle()}」`;

    status.textContent = "完成！タイトルを付けて保存しよう";
    motionReadout.textContent = "";

    // 保存ボタンを押す前に，画像を先に作っておく（理由は prepareExportFile を参照）
    prepareExportFile();
}

// タイトルを入力するたびに画像を作り直す
// （1文字ごとに作ると重いので，入力が0.3秒止まってから作る）
titleInput.addEventListener("input", () => {
    clearTimeout(prepareTimer);
    prepareTimer = setTimeout(prepareExportFile, 300);
});

// ========================================
// 13. 画像の保存・共有
// ========================================

const EXPORT_SCALE = 2;    // 保存画像の解像度の倍率（大きいほどきれいだが重くなる）
const FOOTER_HEIGHT = 84;  // 画像の下に付ける，タイトル・日付の帯の高さ

// 日付を文字にする（sep="." なら 2026.10.25，sep="" なら 20261025）
function formatDate(date, sep) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return [y, m, d].join(sep);
}

// ファイル名に使えない記号を取り除く
function sanitizeFileName(name) {
    const cleaned = name.replace(/[\\/:*?"<>|\r\n\t]/g, "").trim().slice(0, 50);
    return cleaned || "無題";
}

// 保存用の画像（キャンバス）を作る
//   ┌──────────────┐
//   │ 背景＋作品＋署名 │
//   ├──────────────┤
//   │ タイトル         │
//   │ 日付・お題  OTOIRO│
//   └──────────────┘
function buildExportCanvas(title) {
    // 最新の状態を画面に描いておく
    renderStrokes();

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    const out = document.createElement("canvas");
    out.width = Math.round(w * EXPORT_SCALE);
    out.height = Math.round((h + FOOTER_HEIGHT) * EXPORT_SCALE);

    const o = out.getContext("2d");
    o.scale(EXPORT_SCALE, EXPORT_SCALE);

    // 1. 背景
    // 画面の背景はCSSで付けているため，キャンバスの中身には含まれない．
    // そのまま保存すると背景が透明になるので，同じグラデーションを描き直す．
    o.fillStyle = "#10101b";
    o.fillRect(0, 0, w, h + FOOTER_HEIGHT);

    const gradient = o.createRadialGradient(
        w / 2, h / 2, 0,
        w / 2, h / 2, Math.hypot(w / 2, h / 2)
    );
    gradient.addColorStop(0, "#19192c");
    gradient.addColorStop(1, "#090910");
    o.fillStyle = gradient;
    o.fillRect(0, 0, w, h);

    // 2. 作品と署名（いま画面に表示されている絵をそのまま写す）
    o.drawImage(canvas, 0, 0, w, h);

    // 3. 下の帯：タイトル
    o.textBaseline = "top";
    o.fillStyle = "#ffffff";
    o.font = "bold 22px sans-serif";
    o.fillText(title, 20, h + 16, w - 40); // 長いタイトルは帯の幅に縮める

    // 4. 下の帯：日付・お題・アプリ名
    o.fillStyle = "#b8b8d0";
    o.font = "13px sans-serif";
    const info = [
        formatDate(new Date(), "."),
        currentPrompt ? `お題：${currentPrompt}` : ""
    ].filter(Boolean).join("　");
    o.fillText(info, 20, h + 52, w - 120);

    o.textAlign = "right";
    o.fillText("OTOIRO", w - 20, h + 52);

    return out;
}

// 保存用の画像ファイルを作っておく
// iPhoneの共有メニューは「ボタンを押した直後」にしか開けないため，
// 押してから画像を作り始めると間に合わずに失敗することがある．
// そこで，完成画面に入ったときとタイトルを変えたときに，先に作っておく．
async function prepareExportFile() {
    const title = getTitle();
    const out = buildExportCanvas(title);

    const blob = await new Promise((resolve) => out.toBlob(resolve, "image/png"));
    if (!blob) {
        exportFile = null;
        return;
    }

    // ファイル名：OTOIRO_タイトル_20261025.png
    const fileName =
        `OTOIRO_${sanitizeFileName(title)}_${formatDate(new Date(), "")}.png`;

    exportFile = new File([blob], fileName, { type: "image/png" });
    exportFileTitle = title;
}

// ファイルを端末にダウンロードする（共有メニューが使えないとき用）
function downloadFile(file) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();

    // 少し待ってから一時的なURLを片付ける
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 「画像を保存・共有」ボタン
saveButton.addEventListener("click", async () => {
    // まだ画像がない，またはタイトルが変わっていれば作り直す
    if (!exportFile || exportFileTitle !== getTitle()) {
        clearTimeout(prepareTimer);
        await prepareExportFile();
    }

    if (!exportFile) {
        status.textContent = "画像を作成できませんでした";
        return;
    }

    // スマホなど共有メニューが使える環境では，共有メニューを開く
    // （AirDrop・LINE・「画像を保存」などから参加者に送れる）
    if (navigator.canShare && navigator.canShare({ files: [exportFile] })) {
        try {
            await navigator.share({ files: [exportFile], title: getTitle() });
            status.textContent = "共有しました";
            return;
        } catch (error) {
            // 共有メニューを閉じただけなら何もしない
            if (error.name === "AbortError") {
                status.textContent = "共有をキャンセルしました";
                return;
            }
            // それ以外の失敗はダウンロードに切り替える
            console.warn("共有できなかったのでダウンロードに切り替えます:", error);
        }
    }

    // PCなど共有メニューがない環境では，そのままダウンロードする
    downloadFile(exportFile);
    status.textContent = `「${exportFile.name}」を保存しました`;
});


console.log("OTOIRO：JavaScriptの読み込み完了");





window.OTOIROFunctions = {
  // キャンバスの大きさを調整する
  resizeCanvas(canvas, ctx) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    // CSS上の座標と描画座標を合わせる
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  },

  // イベントの座標をキャンバス内の座標に変換する
  getPosition(event, canvas) {
    const rect = canvas.getBoundingClientRect();

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  },

  // タップ位置に波紋を描く
  drawRipple(ctx, x, y, color) {
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 7;
    ctx.stroke();
  },

  // タップ位置にランダムな大きさの円を描く
  drawRipple(ctx, x, y, color) {
    const radius = 5 + Math.random() * 20;
    // 半径は5〜25pxのランダムな値

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.stroke();
  },

  // 音を鳴らす
<<<<<<< Updated upstream
  playSound(audioState, fingerCount) {
=======
  // ========================================
  //
  // 音量を上げるための工夫（タブレットの小さいスピーカーでも聞こえるように）
  //   1. 音量の初期値を 0.15 → 1 に上げる（main.js から渡す値）
  //   2. 1オクターブ上の音（倍音）を重ねて，耳に届きやすい音色にする
  //   3. 全体を増幅してから「リミッター」に通す
  //      リミッターは，音が大きくなりすぎて割れる（音割れ）手前で自動的に抑える仕組み．
  //      これにより，割れずに出せる最大の大きさで鳴らせる．
  //
  // 音量を調整したいときは，下の SOUND_BOOST を変える（大きいほど音が大きい）．
  async playSound(audioState, fingerCount, volume = 1) {
    // 全体の増幅の倍率（1で増幅なし．3〜4くらいまでが目安）
    const SOUND_BOOST = 4;

    // 重ねる倍音（1オクターブ上）の大きさ（基本の音に対する割合）
    const OVERTONE_LEVEL = 0.5;

>>>>>>> Stashed changes
    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      console.warn("このブラウザはWeb Audio APIに対応していません");
      return;
    }

    if (!audioState.context) {
      audioState.context = new AudioContextClass();
    }

    const audio = audioState.context;

    if (audio.state === "suspended") {
      audio.resume();
    }

    const oscillator = audio.createOscillator();
    const gain = audio.createGain();

    const frequencies = {
      1: 440,
      2: 554,
      3: 659
    };

    oscillator.type = "sine";
    oscillator.frequency.value =
      frequencies[Math.min(fingerCount, 3)] || 440;

    gain.gain.setValueAtTime(0.12, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      audio.currentTime + 0.25
    );

    oscillator.connect(gain);
    gain.connect(audio.destination);

    oscillator.start();
    oscillator.stop(audio.currentTime + 0.25);
  },

  // 指の本数を画面に表示する
  updateStatus(status, count) {
    if (count === 0) {
      status.textContent = "画面に触れて始めよう";
    } else {
      status.textContent = `${count}本の指で操作中`;
    }
  }
};

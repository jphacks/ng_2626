

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

  // ========================================
  // 音を鳴らす
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
    const SOUND_BOOST = 3;

    // 重ねる倍音（1オクターブ上）の大きさ（基本の音に対する割合）
    const OVERTONE_LEVEL = 0.5;

    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      console.warn("このブラウザはWeb Audio APIに対応していません");
      return;
    }

    try {
      // AudioContextを作成する
      if (
        !audioState.context ||
        audioState.context.state === "closed"
      ) {
        audioState.context = new AudioContextClass();
        audioState.output = null; // 新しいAudioContextでは出口を作り直す
      }

      const audio = audioState.context;

      // 音声の再開が終わるまで待つ
      if (audio.state === "suspended") {
        await audio.resume();
      }

      if (audio.state !== "running") {
        console.warn("音声を再生できません。状態:", audio.state);
        return;
      }

      // 音の出口（増幅 → リミッター → スピーカー）を最初の1回だけ作る
      // すべての音がここを通るので，複数の指で同時に鳴らしても音割れしにくい
      if (!audioState.output) {
        const boost = audio.createGain();
        boost.gain.value = SOUND_BOOST;

        // リミッター（強い圧縮をかけるコンプレッサー）
        const limiter = audio.createDynamicsCompressor();
        limiter.threshold.value = -10; // この大きさ（dB）を超えた分を抑える（同時に鳴っても割れないよう余裕を持たせる）
        limiter.knee.value = 0;       // 境目でなめらかにせず，しっかり抑える
        limiter.ratio.value = 20;     // 超えた分を1/20に抑える
        limiter.attack.value = 0.002; // 抑え始めるまでの時間（秒）
        limiter.release.value = 0.1;  // 抑えるのをやめるまでの時間（秒）

        boost.connect(limiter);
        limiter.connect(audio.destination);
        audioState.output = boost;
      }

      // 指の本数を1〜5本に制限する
      const count = Math.max(1, Math.min(fingerCount, 5));

      // 指の本数ごとに音程を変える
      // （以前は5本指の音程がなく，5本指のときにエラーで音が鳴らなかったので追加）
      const frequencies = {
        1: 440,
        2: 554,
        3: 659,
        4: 783,
        5: 880,
      };

      const duration = count === 5 ? 0.4 : 0.25;

      // 指定された音量を使う（0〜1）
      const safeVolume = Math.max(0, Math.min(volume, 1));

      // 0なら完全に無音にする
      if (safeVolume === 0) {
        return;
      }

      const now = audio.currentTime;

      // 音量の変化（エンベロープ）
      // いきなり最大にすると「プツッ」というノイズが出るので，ごく短い時間で立ち上げる
      const gain = audio.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(safeVolume, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      gain.connect(audioState.output);

      // 基本の音
      const oscillator = audio.createOscillator();
      oscillator.type = count === 5 ? "square" : "sine"; // 5本指だけ音色を変える
      oscillator.frequency.setValueAtTime(frequencies[count], now);
      oscillator.connect(gain);

      // 1オクターブ上の倍音（音色を明るくして聞こえやすくする）
      const overtone = audio.createOscillator();
      const overtoneGain = audio.createGain();
      overtone.type = "sine";
      overtone.frequency.setValueAtTime(frequencies[count] * 2, now);
      overtoneGain.gain.value = OVERTONE_LEVEL;
      overtone.connect(overtoneGain);
      overtoneGain.connect(gain);

      oscillator.start(now);
      overtone.start(now);
      oscillator.stop(now + duration);
      overtone.stop(now + duration);

      console.log(
        `音を再生：${count}本、音量=${safeVolume}`,
        `AudioContext=${audio.state}`
      );
    } catch (error) {
      console.error("音声の再生に失敗しました:", error);
    }
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

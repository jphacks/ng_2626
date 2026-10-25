

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

  // ========================================
  // 音を鳴らす
  // ========================================
  async playSound(audioState, fingerCount, volume = 10) {
    // ----------------------------------------
    // 音の設定
    // あとから音程・音色・長さを調整しやすいようにまとめる
    // ----------------------------------------

    // 全体の増幅倍率．タブレットでも聞こえやすい音量を維持する
    const SOUND_BOOST = 20;

    // 指の本数ごとの基本音の周波数（Hz）
    // 1〜4本指の音程は変更せず，5本指だけ220Hzにする
    const FREQUENCIES = {
      1: 440,
      2: 554,
      3: 659,
      4: 783,
      5: 880,
    };

    // 指の本数ごとの音色
    // 1〜4本指は従来どおりsine，5本指は柔らかいtriangleにする
    const OSCILLATOR_TYPES = {
      1: "sine",
      2: "sine",
      3: "sine",
      4: "sine",
      5: "sine"
    };

    // 音の長さ（秒）
    // 1〜4本指は0.25秒，5本指は0.4秒のままにする
    const DURATIONS = {
      1: 0.25,
      2: 0.25,
      3: 0.25,
      4: 0.25,
      5: 0.4
    };

    // 1オクターブ上に重ねる倍音の大きさ
    // 5本指だけ0.2に下げ，高音の強さを控えめにする
    // 1〜4本指は従来どおり0.5を維持する
    const OVERTONE_LEVELS = {
      1: 0.5,
      2: 0.5,
      3: 0.5,
      4: 0.5,
      5: 0.5
    };

    // ----------------------------------------
    // AudioContextの準備
    // ----------------------------------------

    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      console.warn("このブラウザはWeb Audio APIに対応していません");
      return;
    }

    try {
      // AudioContextが存在しない場合，または閉じている場合は作り直す
      if (
        !audioState.context ||
        audioState.context.state === "closed"
      ) {
        audioState.context = new AudioContextClass();

        // 新しいAudioContextでは音の出口も作り直す
        audioState.output = null;
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

      // ----------------------------------------
      // 音の出口を準備する
      // 増幅 → リミッター → スピーカーの順番は変更しない
      // ----------------------------------------

      if (!audioState.output) {
        const boost = audio.createGain();

        // 従来どおり全体の音量を3倍に増幅する
        boost.gain.value = SOUND_BOOST;

        // 音が大きくなりすぎたときに抑えるリミッター
        const limiter = audio.createDynamicsCompressor();
        limiter.threshold.value = -10;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.002;
        limiter.release.value = 0.1;

        // 接続順序は従来どおりにする
        boost.connect(limiter);
        limiter.connect(audio.destination);

        // すべての音が共通の出口を通るようにする
        audioState.output = boost;
      }

      // ----------------------------------------
      // 指の本数に応じた音を準備する
      // ----------------------------------------

      // 指の本数を1〜5本に制限する
      const count = Math.max(1, Math.min(fingerCount, 5));

      // 指定された音量を使う（0〜1）
      const safeVolume = Math.max(0, Math.min(volume, 1));

      // 音量が0の場合は再生しない
      if (safeVolume === 0) {
        return;
      }

      const now = audio.currentTime;
      const frequency = FREQUENCIES[count];
      const duration = DURATIONS[count];
      const overtoneLevel = OVERTONE_LEVELS[count];

      // ----------------------------------------
      // 音量の変化（エンベロープ）
      // ----------------------------------------

      // 急に音を出すときの「プツッ」というノイズを防ぐ
      // 従来どおり5ミリ秒で立ち上げる
      const gain = audio.createGain();

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(
        safeVolume,
        now + 0.005
      );

      // 指定した長さで音を減衰させる
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        now + duration
      );

      // 共通の増幅・リミッターにつなぐ
      gain.connect(audioState.output);

      // ----------------------------------------
      // 基本の音
      // ----------------------------------------

      const oscillator = audio.createOscillator();

      // 1〜4本指はsine，5本指はtriangleにする
      // 三角波は矩形波より高次の倍音が少なく，柔らかい音になる
      oscillator.type = OSCILLATOR_TYPES[count];

      // 指の本数に対応した音程を設定する
      oscillator.frequency.setValueAtTime(frequency, now);

      oscillator.connect(gain);

      // ----------------------------------------
      // 1オクターブ上の倍音
      // ----------------------------------------

      const overtone = audio.createOscillator();
      const overtoneGain = audio.createGain();

      // 倍音は従来どおりsineにする
      overtone.type = "sine";

      // 基本音の2倍の周波数を設定する
      // 5本指の場合は220Hz × 2 = 440Hzになる
      overtone.frequency.setValueAtTime(
        frequency * 2,
        now
      );

      // 5本指だけ0.2にし，倍音を控えめにする
      // 1〜4本指は従来どおり0.5
      overtoneGain.gain.value = overtoneLevel;

      overtone.connect(overtoneGain);
      overtoneGain.connect(gain);

      // ----------------------------------------
      // 再生開始・終了
      // ----------------------------------------

      oscillator.start(now);
      overtone.start(now);

      oscillator.stop(now + duration);
      overtone.stop(now + duration);

      console.log(
        `音を再生：${count}本`,
        `周波数=${frequency}Hz`,
        `音色=${OSCILLATOR_TYPES[count]}`,
        `倍音=${overtoneLevel}`,
        `音量=${safeVolume}`,
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

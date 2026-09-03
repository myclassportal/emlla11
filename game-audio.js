const GameAudio = {
    audioCtx: null,
    masterGain: null,
    compressor: null,
    isMuted: localStorage.getItem('game_sound_muted') === 'true',
    volumeBoost: 1.7,
    audioBufferCache: {},
    activeSourceNodes: [],
    playSequenceId: 0,

    getAudioContext() {
        if (!this.audioCtx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                this.audioCtx = new AudioCtx();
            }
        }
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
        this.setupMasterOutput();
        return this.audioCtx;
    },

    setupMasterOutput() {
        if (!this.audioCtx || this.masterGain) return;

        this.masterGain = this.audioCtx.createGain();
        this.masterGain.gain.value = this.volumeBoost;

        this.compressor = this.audioCtx.createDynamicsCompressor();
        this.compressor.threshold.setValueAtTime(-14, this.audioCtx.currentTime);
        this.compressor.knee.setValueAtTime(30, this.audioCtx.currentTime);
        this.compressor.ratio.setValueAtTime(10, this.audioCtx.currentTime);
        this.compressor.attack.setValueAtTime(0.003, this.audioCtx.currentTime);
        this.compressor.release.setValueAtTime(0.25, this.audioCtx.currentTime);

        this.masterGain.connect(this.compressor);
        this.compressor.connect(this.audioCtx.destination);
    },

    trimSilence(buffer) {
        const ctx = this.getAudioContext();
        if (!ctx || !buffer) return buffer;

        const channelData = buffer.getChannelData(0);
        let start = 0;
        let end = channelData.length - 1;
        const threshold = 0.008;

        while (start < end && Math.abs(channelData[start]) < threshold) {
            start++;
        }
        while (end > start && Math.abs(channelData[end]) < threshold) {
            end--;
        }

        const safePadding = Math.floor(buffer.sampleRate * 0.02);
        start = Math.max(0, start - safePadding);
        end = Math.min(channelData.length - 1, end + safePadding);

        const length = Math.max(1, end - start + 1);
        const trimmed = ctx.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
        for (let c = 0; c < buffer.numberOfChannels; c++) {
            trimmed.copyToChannel(buffer.getChannelData(c).subarray(start, end + 1), c);
        }
        return trimmed;
    },

    async getSoundBuffer(fileName) {
        if (this.audioBufferCache[fileName]) {
            return this.audioBufferCache[fileName];
        }

        const ctx = this.getAudioContext();
        if (!ctx) return null;

        try {
            const response = await fetch(`sounds/${fileName}.mp3`);
            const arrayBuffer = await response.arrayBuffer();
            const decoded = await ctx.decodeAudioData(arrayBuffer);
            const trimmed = this.trimSilence(decoded);
            this.audioBufferCache[fileName] = trimmed;
            return trimmed;
        } catch (e) {
            return null;
        }
    },

    async playList(files, onComplete) {
        if (this.isMuted || !files || files.length === 0) {
            if (onComplete) onComplete();
            return;
        }

        this.stop();
        const seqId = ++this.playSequenceId;
        const ctx = this.getAudioContext();
        if (!ctx) {
            if (onComplete) onComplete();
            return;
        }

        let startTime = ctx.currentTime + 0.02;

        for (let i = 0; i < files.length; i++) {
            if (this.playSequenceId !== seqId || this.isMuted) return;

            const fName = files[i];
            const buffer = await this.getSoundBuffer(fName);

            if (this.playSequenceId !== seqId || this.isMuted) return;
            if (!buffer) continue;

            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(this.masterGain || ctx.destination);

            const playAt = Math.max(ctx.currentTime, startTime);
            source.start(playAt);
            this.activeSourceNodes.push(source);

            startTime = playAt + buffer.duration + 0.12;
        }

        const totalDuration = Math.max(0, startTime - ctx.currentTime);
        setTimeout(() => {
            if (this.playSequenceId === seqId && onComplete) {
                onComplete();
            }
        }, totalDuration * 1000);
    },

    stop() {
        this.playSequenceId++;
        this.activeSourceNodes.forEach(node => {
            try { node.stop(); } catch (e) {}
        });
        this.activeSourceNodes = [];
    },

    playSFX(type) {
        if (this.isMuted) return;
        try {
            const ctx = this.getAudioContext();
            if (!ctx) return;
            const now = ctx.currentTime;

            if (type === 'click') {
                this.playTone(550, 'sine', now, 0.03, 0.08);
            } else if (type === 'correct') {
                this.playTone(523.25, 'triangle', now, 0.1, 0.22);
                this.playTone(659.25, 'triangle', now + 0.08, 0.2, 0.22);
            } else if (type === 'wrong') {
                this.playTone(349.23, 'sine', now, 0.12, 0.18);
                this.playTone(261.63, 'sine', now + 0.09, 0.22, 0.18);
            } else if (type === 'win') {
                const notes = [523.25, 659.25, 783.99, 1046.50];
                notes.forEach((freq, i) => this.playTone(freq, 'triangle', now + (i * 0.11), 0.24, 0.22));
            }
        } catch (e) {}
    },

    playTone(freq, type, startTime, duration, maxGain = 0.25, rampToFreq = null) {
        const ctx = this.audioCtx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, startTime);
        if (rampToFreq) {
            osc.frequency.exponentialRampToValueAtTime(rampToFreq, startTime + duration);
        }

        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.linearRampToValueAtTime(maxGain, startTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

        osc.connect(gain);
        gain.connect(this.masterGain || ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
    },

    toggleMute() {
        this.isMuted = !this.isMuted;
        localStorage.setItem('game_sound_muted', this.isMuted);
        if (this.isMuted) this.stop();
        return this.isMuted;
    }
};
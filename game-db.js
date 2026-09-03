const SUPABASE_URL = "https://db.essapour.ir";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlsem9mdGFrdWFvY2R0ZXpieWdhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NjczMjAsImV4cCI6MjA5NzE0MzMyMH0.hFoXNtWSepg6TbYKHitTbrOm3VimC6BKEy0xMMh19XM";

window.Portal = {
  isPortalMode: false,
  studentId: "",
  token: "",
  homeworkId: "",
  gameId: "",
  requiredStars: 3,
  previousPlays: 0,
  previousStars: 0,
  supabaseClient: null,
  studentName: "",
  _lastAuthCallbacks: null,
  _lastSubmitCallbacks: null,

  toPersianDigits(str) {
    if (str === undefined || str === null) return '';
    return str.toString().replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
  },

  getPersianDateTime() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('fa-IR', {year: 'numeric', month: '2-digit', day: '2-digit'});
    const timeStr = now.toLocaleTimeString('fa-IR', {hour: '2-digit', minute: '2-digit', second: '2-digit'});
    return `${dateStr} - ${timeStr}`;
  },

  isNetworkError(error) {
    if (!error) return false;
    const msg = (error.message || '').toLowerCase();
    const status = error.status || 0;
    return msg.includes('failed to fetch') || 
           msg.includes('network error') || 
           msg.includes('networkerror') || 
           msg.includes('load failed') || 
           msg.includes('timeout') ||
           msg.includes('abort') ||
           status === 0 || 
           status === 408 ||
           status === 502 || 
           status === 503 || 
           status === 504;
  },

  async fetchWithSmartTimeout(fn, timeouts = [3800, 5200], delayMs = 500) {
    const maxAttempts = timeouts.length;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const currentTimeout = timeouts[attempt - 1];
      let timerId = null;

      try {
        const timerPromise = new Promise((_, reject) => {
          timerId = setTimeout(() => {
            controller.abort();
            reject(new Error('TIMEOUT'));
          }, currentTimeout);
        });

        const fetchPromise = fn(controller.signal);
        const result = await Promise.race([fetchPromise, timerPromise]);

        if (timerId) clearTimeout(timerId);

        if (result && result.error) {
          if (this.isNetworkError(result.error) && attempt < maxAttempts) {
            throw new Error('NETWORK_FAIL');
          }
          return result;
        }
        return result;
      } catch (err) {
        if (timerId) clearTimeout(timerId);
        controller.abort();

        if (attempt < maxAttempts) {
          await new Promise(res => setTimeout(res, delayMs));
        } else {
          return { data: null, error: { message: 'Network Timeout', status: 0 } };
        }
      }
    }
  },

  async authenticate(callbacks) {
    this._lastAuthCallbacks = callbacks;
    const urlParams = new URLSearchParams(window.location.search);
    this.studentId = urlParams.get('student_id');
    this.token = urlParams.get('token');
    this.homeworkId = urlParams.get('homework_id');
    this.gameId = urlParams.get('game_id');
    this.requiredStars = parseInt(urlParams.get('required_stars')) || 3;

    if (this.studentId && this.token && this.homeworkId && this.gameId) {
      this.isPortalMode = true;
      this.showLoadingScreen(true, 'در حال آماده‌سازی اتصال به سرور...');

      try {
        this.showLoadingScreen(true, 'در حال احراز هویت و دریافت اطلاعات...', '50%');
        
        const hasSupabaseLib = (typeof supabase !== 'undefined' && supabase !== null) || (window.supabase !== undefined && window.supabase !== null);
        if (!hasSupabaseLib) {
          throw new Error("کتابخانه Supabase لود نشده است.");
        }

        const lib = window.supabase || supabase;
        this.supabaseClient = lib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          realtime: {
            autoConnect: false
          }
        });

        const { data: gameData, error: errGame } = await this.fetchWithSmartTimeout(
          (signal) => this.supabaseClient
            .rpc('get_student_game_data', {
              query_student_id: this.studentId,
              query_token: this.token,
              query_homework_id: this.homeworkId
            })
            .abortSignal(signal),
          [3800, 5200],
          500
        );

        if (errGame) throw errGame;

        if (gameData && gameData.student && gameData.student.name) {
          this.studentName = gameData.student.name;

          if (gameData.school && gameData.school.school_name) {
            const schoolTitleEl = document.getElementById('portal-school-title');
            const schoolGameEl = document.getElementById('school');
            if (schoolTitleEl) schoolTitleEl.textContent = gameData.school.school_name;
            if (schoolGameEl) schoolGameEl.textContent = gameData.school.school_name;
          }

          if (gameData.homework && gameData.homework.required_stars) {
            this.requiredStars = gameData.homework.required_stars || 3;
          }

          if (gameData.progress) {
            this.previousPlays = gameData.progress.play_count || 0;
            this.previousStars = gameData.progress.stars_earned || 0;
          }

          this.showLoadingScreen(true, 'اتصال موفق!', '100%');
          await new Promise(resolve => setTimeout(resolve, 300));
          this.showLoadingScreen(false);

          this.updateWelcomeUI();

          if (callbacks && typeof callbacks.onSuccess === 'function') {
            callbacks.onSuccess({
              name: this.studentName,
              plays: this.previousPlays,
              stars: this.previousStars,
              requiredStars: this.requiredStars
            });
          }
        } else {
          throw new Error("نمایه دانش‌آموز یا اطلاعات تکلیف یافت نشد.");
        }
      } catch (e) {
        console.error(e);
        this.showLoadingScreen(false);
        this.showErrorScreen(true);
        if (callbacks && typeof callbacks.onFailure === 'function') {
          callbacks.onFailure(e);
        }
      }
    } else {
      this.isPortalMode = false;
      if (callbacks && typeof callbacks.onGuestMode === 'function') {
        callbacks.onGuestMode();
      }
    }
  },

  updateWelcomeUI() {
    const welcomeTitle = document.querySelector('#welcome strong');
    const welcomeSubtitle = document.getElementById('welcome-sub-lbl');
    const nameInputContainer = document.getElementById('nameInput');

    if (welcomeTitle) {
      welcomeTitle.innerHTML = `سلام ${this.studentName} عزیز! 🌟`;
    }
    if (welcomeSubtitle) {
      welcomeSubtitle.innerHTML = `ستاره‌های فعلی تو: ${this.toPersianDigits(this.previousStars)} ⭐<br>ستاره‌های مورد نیاز برای این تکلیف: ${this.toPersianDigits(this.requiredStars)} ⭐`;
      welcomeSubtitle.style.lineHeight = "1.8";
    }
    if (nameInputContainer) {
      nameInputContainer.style.display = 'none';
    }

    const portalStudentWelcomeEl = document.getElementById('portal-student-welcome');
    if (portalStudentWelcomeEl) {
      portalStudentWelcomeEl.textContent = `سلام ${this.studentName} زرنگم! 🌟`;
    }

    const portalStudentNameEl = document.getElementById('portal-student-name');
    const portalPrevPlaysEl = document.getElementById('portal-prev-plays');
    const portalPrevStarsEl = document.getElementById('portal-prev-stars');
    const portalReqStarsEl = document.getElementById('portal-req-stars');

    if (portalStudentNameEl) portalStudentNameEl.textContent = this.studentName;
    if (portalPrevPlaysEl) portalPrevPlaysEl.textContent = this.toPersianDigits(this.previousPlays);
    if (portalPrevStarsEl) portalPrevStarsEl.textContent = this.toPersianDigits(this.previousStars) + ' ⭐';
    if (portalReqStarsEl) portalReqStarsEl.textContent = this.toPersianDigits(this.requiredStars) + ' ⭐';

    const portalWelcomeSec = document.getElementById('portal-welcome-section');
    const guestWelcomeSec = document.getElementById('guest-welcome-section');
    if (portalWelcomeSec) portalWelcomeSec.style.display = 'block';
    if (guestWelcomeSec) guestWelcomeSec.style.display = 'none';
  },

  showLoadingScreen(show, text = '', progressPercent = '0%') {
    const loadingScreen = document.getElementById('Screen-Loading');
    const loadingBar = document.getElementById('portal-loading-bar');
    const loadingText = document.getElementById('portal-loading-text');

    if (!loadingScreen) return;

    if (show) {
      loadingScreen.style.display = 'flex';
      const screens = ['screen-register', 'screen-game', 'screen-report', 'portal-submitting-screen', 'screen-assistant'];
      screens.forEach(s => {
        const el = document.getElementById(s);
        if (el) {
          el.classList.add('hidden');
          el.style.display = '';
        }
      });
      if (loadingBar) loadingBar.style.width = progressPercent;
      if (loadingText) loadingText.innerText = text;
    } else {
      loadingScreen.style.display = 'none';
    }
  },

  showErrorScreen(show) {
    const errSec = document.getElementById('portal-error-section');
    const regSec = document.getElementById('register-container');
    const regScreen = document.getElementById('screen-register');
    if (regScreen && show) regScreen.classList.remove('hidden');
    if (errSec) errSec.style.display = show ? 'block' : 'none';
    if (regSec) regSec.style.display = show ? 'none' : 'block';
  },

  async submitProgress(stars, callbacks) {
    if (callbacks) this._lastSubmitCallbacks = callbacks;
    
    const needsSubmitKey = `portal_needs_submit_${this.gameId}_${this.studentId}_${this.homeworkId}`;
    const pendingStarsKey = `portal_pending_stars_${this.gameId}_${this.studentId}_${this.homeworkId}`;

    if (stars !== null) {
      localStorage.setItem(needsSubmitKey, 'true');
      localStorage.setItem(pendingStarsKey, stars.toString());
    }

    const progressBar = document.getElementById('portal-progress-bar');
    const statusText = document.getElementById('portal-submit-status-text');
    const retryBtn = document.getElementById('portal-retry-submit-btn');
    const submitScreen = document.getElementById('portal-submitting-screen');

    if (submitScreen) submitScreen.style.display = 'flex';
    
    ['screen-register', 'screen-game', 'screen-report', 'Screen-Loading', 'screen-assistant'].forEach(s => {
      const el = document.getElementById(s);
      if (el) el.style.display = 'none';
    });

    if (progressBar) {
      progressBar.style.width = '0%';
      progressBar.style.backgroundColor = '#7b1fa2';
    }
    if (statusText) {
      statusText.style.color = '#555';
      statusText.innerText = 'در حال بسته‌بندی اطلاعات...';
    }
    if (retryBtn) retryBtn.style.display = 'none';

    try {
      if (progressBar) progressBar.style.width = '20%';
      await new Promise(resolve => setTimeout(resolve, 300));

      const pendingStars = parseInt(localStorage.getItem(pendingStarsKey)) || 0;
      const currentPlays = this.previousPlays + 1;
      const currentStars = this.previousStars + pendingStars;
      const currentPersianDateTime = this.getPersianDateTime();

      if (progressBar) progressBar.style.width = '50%';
      if (statusText) statusText.innerText = 'ارتباط با سرور پرتال کلاس...';

      const { error } = await this.fetchWithSmartTimeout(
        (signal) => this.supabaseClient
          .rpc('submit_game_progress', {
            query_student_id: this.studentId,
            query_token: this.token,
            query_homework_id: this.homeworkId,
            query_game_id: this.gameId,
            plays: currentPlays,
            stars: currentStars,
            duration: 0,
            played_at: currentPersianDateTime
          })
          .abortSignal(signal),
        [3500, 5000],
        400
      );

      if (progressBar) progressBar.style.width = '80%';
      await new Promise(resolve => setTimeout(resolve, 200));

      if (error) throw error;

      if (progressBar) progressBar.style.width = '100%';
      if (statusText) statusText.innerText = 'با موفقیت ثبت شد!';
      await new Promise(resolve => setTimeout(resolve, 400));

      localStorage.removeItem(needsSubmitKey);
      localStorage.removeItem(pendingStarsKey);

      if (submitScreen) submitScreen.style.display = 'none';

      this.previousPlays = currentPlays;
      this.previousStars = currentStars;

      if (callbacks && typeof callbacks.onSuccess === 'function') {
        callbacks.onSuccess({
          plays: currentPlays,
          stars: currentStars,
          goalReached: currentStars >= this.requiredStars
        });
      }
    } catch (err) {
      console.error(err);
      if (progressBar) progressBar.style.backgroundColor = '#d32f2f';
      if (statusText) {
        statusText.style.color = '#d32f2f';
        statusText.innerHTML = `❌ خطای ارسال اطلاعات!<br/>
        <span style="font-size: 11pt; font-weight: normal; color: #6a1b9a; display: block; margin-top: 5px; line-height:1.7;">
            <b>علت خطا:</b> اتصال اینترنتت قطع است یا سرور پرتال پاسخ نمی‌دهد.<br/>
            <b>راهنما:</b> لطفا داده گوشی را روشن کن و دکمه زیر را بزن. پیشرفت تو تا زمان ارسال در حافظه گوشی محفوظ است.
        </span>`;
      }
      if (retryBtn) retryBtn.style.display = 'block';

      if (callbacks && typeof callbacks.onFailure === 'function') {
        callbacks.onFailure(err);
      }
    }
  }
};

window.retryAuthentication = async function() {
  const errSec = document.getElementById('portal-error-section');
  const regSec = document.getElementById('register-container');
  if (errSec) errSec.style.display = 'none';
  if (regSec) regSec.style.display = 'block';

  if (Portal._lastAuthCallbacks) {
    await Portal.authenticate(Portal._lastAuthCallbacks);
  } else {
    location.reload();
  }
};

window.retrySubmission = async function() {
  const statusText = document.getElementById('portal-submit-status-text');
  const progressBar = document.getElementById('portal-progress-bar');
  if (statusText) statusText.style.color = '#555';
  if (progressBar) progressBar.style.backgroundColor = '#7b1fa2';
  await Portal.submitProgress(null, Portal._lastSubmitCallbacks);
};
(function () {
  const TOTAL = 5;
  let current = 1;

  /* ── dataLayer (GTM-MK7SRXJ9) ──────────────────────────────
     Eventos p/ mapear no GTM: pb_quiz_view, pb_quiz_step, pb_quiz_complete
     Params comuns em todo push: variante ('qualificado'|'semi'), funil ('playbook') */
  var PB_VARIANTE = 'qualificado';
  function dl(evt, params) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(Object.assign({ event: evt, variante: PB_VARIANTE, funil: 'playbook' }, params || {}));
  }
  var PB_QUESTIONS = { 1: 'como-vende', 2: 'obstaculos', 3: 'qualificacao-perguntas', 4: 'colaboradores', 5: 'disposicao' };
  function pbAnswerOf(step) {
    if (step === 2) {
      return Array.from(document.querySelectorAll('input[name="q2"]:checked')).map(function (cb) { return cb.value; }).join(',');
    }
    var el = document.querySelector('input[name="q' + step + '"]:checked');
    return el ? el.value : '';
  }

  const progressBar   = document.getElementById('progress-bar');
  const stepLabel     = document.getElementById('step-label');
  const stepNum       = document.getElementById('step-num');
  const btnBack       = document.getElementById('btn-back');
  const btnConfirm    = document.getElementById('btn-confirm');
  const btnSubmit     = document.getElementById('btn-submit');
  const quizNav       = document.getElementById('quiz-nav');
  const successScreen = document.getElementById('success-screen');

  /* ── Show step ── */
  function showStep(num, back) {
    for (let i = 1; i <= TOTAL; i++) {
      const wrapper = document.getElementById('wrapper-' + i) || (i === 1 ? document.querySelector('.steps-wrapper') : null);
      const step    = document.getElementById('step-' + i);
      if (!wrapper || !step) continue;
      if (i === num) {
        wrapper.style.display = '';
        step.classList.add('active');
        step.classList.toggle('anim-back', !!back);
        void step.offsetWidth; /* re-trigger animation */
      } else {
        wrapper.style.display = 'none';
        step.classList.remove('active');
      }
    }
  }

  /* ── Update UI ── */
  function updateUI() {
    stepLabel.textContent       = 'Pergunta ' + current + ' de ' + TOTAL;
    stepNum.textContent         = current;
    progressBar.style.width     = ((current / TOTAL) * 100) + '%';
    btnBack.classList.toggle('btn--hidden', current === 1);
    /* confirm button only visible on step 2 (checkboxes) */
    btnConfirm.classList.toggle('btn--hidden', current !== 2);
    /* hide submit button whenever navigating */
    btnSubmit.classList.add('btn--hidden');
  }

  /* ── Advance / submit ── */
  function advance() {
    if (current < TOTAL) {
      current++;
      dl('pb_quiz_step', {
        step: current,
        question: PB_QUESTIONS[current],
        answer_prev: pbAnswerOf(current - 1)
      });
      showStep(current, false);
      updateUI();
    } else {
      submitQuiz();
    }
  }

  /* ── URL params (vindos do faq03-playbook) ── */
  function getQueryParam(name) {
    try {
      return new URLSearchParams(window.location.search).get(name) || '';
    } catch (e) {
      return '';
    }
  }

  function newSubmissionId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'sid_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  }

  var REDIRECT_URL = 'https://playbook-calendly.fullsalessystem.com/';

  /* Repassa o lead pro calendario GHL (form_embed.js leva a query pro iframe).
     Sem isso o e-mail oculto do form ia vazio e o lead redigitava o telefone:
     telefone diferente = contato novo sem e-mail no GHL. */
  var PB_UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id', 'fbclid', 'gclid'];
  function calendarUrl() {
    var url;
    try { url = new URL(REDIRECT_URL); } catch (e) { return REDIRECT_URL; }
    var set = function (k, v) { if (v) url.searchParams.set(k, v); };
    var nome = getQueryParam('name').trim().replace(/\s+/g, ' ');
    /* whatsapp vem do playbook so com digitos: BR sem DDI (10/11), internacional com DDI */
    var digits = getQueryParam('whatsapp').replace(/\D+/g, '');
    set('email', getQueryParam('email'));
    set('phone', digits ? '+' + (digits.length === 10 || digits.length === 11 ? '55' : '') + digits : '');
    set('full_name', nome);
    set('first_name', nome.split(' ')[0]);
    set('last_name', nome.split(' ').slice(1).join(' '));
    PB_UTM_KEYS.forEach(function (k) { set(k, getQueryParam(k)); });
    return url.toString();
  }

  /* ── Submit ── */
  function submitQuiz() {
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Enviando…';

    var q1El = document.querySelector('input[name="q1"]:checked');
    var q2 = Array.from(document.querySelectorAll('input[name="q2"]:checked')).map(function (cb) { return cb.value; });
    var q3El = document.querySelector('input[name="q3"]:checked');
    var q4El = document.querySelector('input[name="q4"]:checked');
    var q5El = document.querySelector('input[name="q5"]:checked');
    var submissionId = newSubmissionId();

    /* pb_quiz_complete ANTES do fetch/redirect (delay de 250ms no .finally cobre o GTM) */
    dl('pb_quiz_complete', {
      q1: q1El ? q1El.value : '',
      q2: q2.join(','),
      q3: q3El ? q3El.value : '',
      q4: q4El ? q4El.value : '',
      q5: q5El ? q5El.value : '',
      resultado: q2.join(','),
      submission_id: submissionId
    });

    var payload = {
      submission_id: submissionId,
      submitted_at: new Date().toISOString(),
      page: window.location.href,
      email: getQueryParam('email'),
      whatsapp: getQueryParam('whatsapp'),
      nome: getQueryParam('name'),
      classification: getQueryParam('classification'),
      q1: q1El ? q1El.value : '',
      q2: q2,
      q3: q3El ? q3El.value : '',
      q4: q4El ? q4El.value : '',
      q5: q5El ? q5El.value : ''
    };

    function go() { window.location.href = calendarUrl(); }

    fetch('/api/quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    }).then(function (res) {
      if (!res.ok) console.warn('[quiz] api returned', res.status);
      btnSubmit.textContent = 'Enviado ✓';
    }).catch(function (err) {
      console.warn('[quiz] api error', err);
      btnSubmit.textContent = 'Enviado ✓';
    }).finally(function () {
      setTimeout(go, 250);
    });
  }

  btnSubmit.addEventListener('click', submitQuiz);

  /* ── Radio: auto-advance after short delay ── */
  document.querySelectorAll('input[type="radio"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      /* highlight selected option */
      document.querySelectorAll('input[name="' + radio.name + '"]').forEach(function (r) {
        r.closest('.option, .scale-option').classList.remove('selected');
      });
      radio.closest('.option, .scale-option').classList.add('selected');

      /* auto-advance (on last step, show submit button instead) */
      setTimeout(function () {
        if (current === TOTAL) {
          btnSubmit.classList.remove('btn--hidden');
        } else {
          advance();
        }
      }, 380);
    });
  });

  /* ── Checkboxes: highlight + show/hide confirm button ── */
  document.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      /* "Todos acima" mutual exclusion */
      if (cb.value === 'todos' && cb.checked) {
        document.querySelectorAll('input[name="q2"]').forEach(function (other) {
          if (other.value !== 'todos') {
            other.checked = false;
            other.closest('.option').classList.remove('selected');
          }
        });
      } else if (cb.value !== 'todos' && cb.checked) {
        const todos = document.getElementById('todos-acima');
        todos.checked = false;
        todos.closest('.option').classList.remove('selected');
      }
      cb.closest('.option').classList.toggle('selected', cb.checked);
    });
  });

  /* ── Confirm button (step 2) ── */
  btnConfirm.addEventListener('click', function () {
    if (!document.querySelector('input[name="q2"]:checked')) {
      /* shake if nothing selected */
      const card = document.getElementById('quiz-card');
      card.style.animation = 'none';
      void card.offsetWidth;
      card.style.animation = 'shake 0.4s ease';
      return;
    }
    advance();
  });

  /* ── Back ── */
  btnBack.addEventListener('click', function () {
    if (current > 1) {
      current--;
      showStep(current, true);
      updateUI();
    }
  });

  /* ── Shake keyframe ── */
  const style = document.createElement('style');
  style.textContent = '@keyframes shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-6px)} 40%,80%{transform:translateX(6px)} }';
  document.head.appendChild(style);

  /* init */
  updateUI();
  dl('pb_quiz_view', { step: 1, question: PB_QUESTIONS[1] });
})();

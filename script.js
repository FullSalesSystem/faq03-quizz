(function () {
  const TOTAL = 5;
  let current = 1;

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
      showStep(current, false);
      updateUI();
    } else {
      submitQuiz();
    }
  }

  /* ── Submit ── */
  function submitQuiz() {
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Enviado ✓';

    var q1 = document.querySelector('input[name="q1"]:checked');
    var q2 = Array.from(document.querySelectorAll('input[name="q2"]:checked')).map(function (cb) { return cb.value; });
    var q3 = document.querySelector('input[name="q3"]:checked');
    var q4 = document.querySelector('input[name="q4"]:checked');
    var q5 = document.querySelector('input[name="q5"]:checked');

    // TODO: integrar webhook novo + redirect condicional por classificação
    console.log('[QUIZ SUBMIT - awaiting integration]', {
      q1: q1 ? q1.value : null,
      q2: q2,
      q3: q3 ? q3.value : null,
      q4: q4 ? q4.value : null,
      q5: q5 ? q5.value : null
    });

    window.location.href = 'https://playbook-calendly.fullsalessystem.com/';
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
})();

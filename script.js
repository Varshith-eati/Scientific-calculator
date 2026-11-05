(() => {
  'use strict';

  // DOM Elements
  const calculatorEl = document.getElementById('calculator');
  const expressionDisplay = document.getElementById('expressionDisplay');
  const answerDisplay = document.getElementById('answerDisplay');
  const modeToggleBtn = document.getElementById('modeToggleBtn');
  const modeToggleLabel = document.getElementById('modeToggleLabel');
  const keypadModeBtn = document.getElementById('keypadModeBtn');
  const angleBadge = document.getElementById('angleBadge');
  const secondBadge = document.getElementById('secondBadge');
  const degRadBtn = document.getElementById('degRadBtn');
  const secondBtn = document.getElementById('secondBtn');
  const historyToggleBtn = document.getElementById('historyToggleBtn');
  const historyPanel = document.getElementById('historyPanel');
  const historyList = document.getElementById('historyList');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');

  // Calculator State
  const state = {
    mode: 'scientific', // 'scientific' | 'basic'
    angleUnit: 'DEG',   // 'DEG' | 'RAD'
    isSecond: false,
    tokens: [],         // Array of token objects: { display, eval }
    lastAnswer: 0,
    justEvaluated: false,
    history: []
  };

  // Helper: Format numeric output cleanly
  function formatNumber(num) {
    if (typeof num !== 'number' || Number.isNaN(num)) {
      return 'Error';
    }
    if (!Number.isFinite(num)) {
      return num > 0 ? '∞' : '-∞';
    }
    // Eliminate tiny floating point inaccuracies (e.g. sin(180 deg) = 1.22e-16 -> 0)
    if (Math.abs(num) < 1e-12) {
      num = 0;
    }
    const rounded = Number(num.toPrecision(12));
    const absVal = Math.abs(rounded);
    if (absVal !== 0 && (absVal >= 1e12 || absVal < 1e-7)) {
      return rounded.toExponential(6).replace(/\.?0+e/, 'e');
    }
    return String(rounded);
  }

  // Scientific helper functions exposed to evaluator
  const CalcMath = {
    toRad(x) {
      return state.angleUnit === 'DEG' ? (x * Math.PI) / 180 : x;
    },
    fromRad(x) {
      return state.angleUnit === 'DEG' ? (x * 180) / Math.PI : x;
    },
    sin(x) {
      if (state.angleUnit === 'DEG' && x % 180 === 0) return 0;
      return Math.sin(this.toRad(x));
    },
    cos(x) {
      if (state.angleUnit === 'DEG' && Math.abs(x % 180) === 90) return 0;
      return Math.cos(this.toRad(x));
    },
    tan(x) {
      if (state.angleUnit === 'DEG') {
        const mod180 = ((x % 180) + 180) % 180;
        if (mod180 === 90) return NaN;
        if (mod180 === 0) return 0;
        if (mod180 === 45) return 1;
        if (mod180 === 135) return -1;
      }
      return Math.tan(this.toRad(x));
    },
    asin(x) {
      return this.fromRad(Math.asin(x));
    },
    acos(x) {
      return this.fromRad(Math.acos(x));
    },
    atan(x) {
      return this.fromRad(Math.atan(x));
    },
    log10(x) {
      return x <= 0 ? NaN : Math.log10(x);
    },
    ln(x) {
      return x <= 0 ? NaN : Math.log(x);
    },
    sqrt(x) {
      return x < 0 ? NaN : Math.sqrt(x);
    },
    cbrt(x) {
      return Math.cbrt(x);
    },
    nthRoot(y, x) {
      if (y === 0) return NaN;
      if (x < 0) {
        if (Math.abs(y % 2) === 1) {
          return -Math.pow(-x, 1 / y);
        }
        return NaN;
      }
      return Math.pow(x, 1 / y);
    },
    fact(n) {
      if (n < 0 || !Number.isInteger(n)) return NaN;
      if (n > 170) return Infinity;
      let res = 1;
      for (let i = 2; i <= n; i++) res *= i;
      return res;
    }
  };

  // Update Display UI
  function updateDisplay(answerText) {
    const exprString = state.tokens.map((t) => t.display).join('');
    expressionDisplay.textContent = exprString;
    expressionDisplay.scrollLeft = expressionDisplay.scrollWidth;

    if (answerText !== undefined) {
      answerDisplay.textContent = answerText;
    } else if (state.tokens.length === 0) {
      answerDisplay.textContent = '0';
    } else {
      // Show live preview or current token tail
      const preview = tryEvaluateTokens(state.tokens);
      if (preview !== null) {
        answerDisplay.textContent = formatNumber(preview);
      } else {
        answerDisplay.textContent = exprString;
      }
    }

    // Adjust font size for long answers
    const len = answerDisplay.textContent.length;
    answerDisplay.classList.toggle('compact', len > 11 && len <= 16);
    answerDisplay.classList.toggle('extra-compact', len > 16);
  }

  // Preprocess & evaluate token array safely
  function buildEvalExpression(tokens) {
    if (!tokens.length) return '';

    // Insert implicit multiplication where appropriate
    const expanded = [];
    for (let i = 0; i < tokens.length; i++) {
      const curr = tokens[i];
      const prev = expanded[expanded.length - 1];

      if (prev) {
        const prevEndsValue =
          prev.type === 'digit' ||
          prev.type === 'constant' ||
          prev.type === 'close-paren' ||
          prev.type === 'postfix';

        const currStartsObject =
          curr.type === 'func' ||
          curr.type === 'constant' ||
          curr.type === 'open-paren';

        const currIsDigitAfterConstOrParen =
          curr.type === 'digit' &&
          (prev.type === 'constant' || prev.type === 'close-paren' || prev.type === 'postfix');

        if ((prevEndsValue && currStartsObject) || currIsDigitAfterConstOrParen) {
          expanded.push({ display: '×', eval: '*', type: 'operator' });
        }
      }
      expanded.push(curr);
    }

    let raw = expanded.map((t) => t.eval).join('');

    // Auto-close unclosed parentheses
    const openCount = (raw.match(/\(/g) || []).length;
    const closeCount = (raw.match(/\)/g) || []).length;
    if (openCount > closeCount) {
      raw += ')'.repeat(openCount - closeCount);
    }

    // Handle factorial postfix `fact(...)` transformation for numbers/parentheses before `!`
    while (raw.includes('!')) {
      raw = raw.replace(/(\d+\.?\d*|\([^()]*\))!/, 'CalcMath.fact($1)');
      if (raw.includes('!') && !/(\d+\.?\d*|\([^()]*\))!/.test(raw)) {
        return null;
      }
    }

    // Handle y-th root infix `nthRoot`
    while (raw.includes('NTHROOT')) {
      const replaced = raw.replace(
        /(\d+\.?\d*|\([^()]*\))NTHROOT(\d+\.?\d*|\([^()]*\))/,
        'CalcMath.nthRoot($1,$2)'
      );
      if (replaced === raw) break;
      raw = replaced;
    }

    return raw;
  }

  function tryEvaluateTokens(tokens) {
    if (!tokens.length) return 0;
    const lastToken = tokens[tokens.length - 1];
    if (lastToken.type === 'operator' || lastToken.type === 'func' || lastToken.type === 'open-paren') {
      return null;
    }
    const expr = buildEvalExpression(tokens);
    if (!expr) return null;
    try {
      const fn = new Function('CalcMath', 'ANS', `return (${expr});`);
      const val = fn(CalcMath, state.lastAnswer);
      if (typeof val === 'number' && !Number.isNaN(val)) {
        return val;
      }
      return null;
    } catch {
      return null;
    }
  }

  // Push a token onto expression
  function pushToken(token) {
    if (state.justEvaluated) {
      // If user presses an operator or postfix after '=', continue from Ans
      if (token.type === 'operator' || token.type === 'postfix') {
        state.tokens = [
          {
            display: formatNumber(state.lastAnswer),
            eval: String(state.lastAnswer),
            type: 'constant'
          }
        ];
      } else {
        state.tokens = [];
      }
      state.justEvaluated = false;
    }

    const last = state.tokens[state.tokens.length - 1];

    // Replace consecutive arithmetic operators (except unary minus after '(' or operator)
    if (token.type === 'operator' && last && last.type === 'operator') {
      if (!(token.eval === '-' && last.eval !== '-')) {
        state.tokens.pop();
      }
    }

    // Prevent multiple decimals in the same number segment
    if (token.eval === '.') {
      for (let i = state.tokens.length - 1; i >= 0; i--) {
        if (state.tokens[i].eval === '.') return;
        if (state.tokens[i].type !== 'digit') break;
      }
      if (!last || last.type !== 'digit') {
        state.tokens.push({ display: '0', eval: '0', type: 'digit' });
      }
    }

    state.tokens.push(token);
    updateDisplay();
  }

  // Evaluate on '=' press
  function evaluateExpression() {
    if (state.tokens.length === 0) return;

    const exprDisplay = state.tokens.map((t) => t.display).join('');
    const exprEval = buildEvalExpression(state.tokens);

    if (!exprEval) {
      updateDisplay('Error');
      state.justEvaluated = true;
      return;
    }

    try {
      const fn = new Function('CalcMath', 'ANS', `return (${exprEval});`);
      const result = fn(CalcMath, state.lastAnswer);
      const formatted = formatNumber(result);

      expressionDisplay.textContent = `${exprDisplay} =`;
      answerDisplay.textContent = formatted;

      const len = formatted.length;
      answerDisplay.classList.toggle('compact', len > 11 && len <= 16);
      answerDisplay.classList.toggle('extra-compact', len > 16);

      if (formatted !== 'Error' && formatted !== '∞' && formatted !== '-∞') {
        state.lastAnswer = Number(formatted);
        addHistoryItem(exprDisplay, formatted);
      }
      state.justEvaluated = true;
    } catch {
      expressionDisplay.textContent = `${exprDisplay} =`;
      updateDisplay('Error');
      state.justEvaluated = true;
    }
  }

  // Switch between Basic and Scientific Mode
  function toggleCalculatorMode() {
    state.mode = state.mode === 'scientific' ? 'basic' : 'scientific';
    calculatorEl.setAttribute('data-mode', state.mode);

    if (state.mode === 'scientific') {
      modeToggleLabel.textContent = 'Basic Mode';
      keypadModeBtn.textContent = 'BASIC';
    } else {
      modeToggleLabel.textContent = 'Scientific Mode';
      keypadModeBtn.textContent = 'SCI';
    }
  }

  // Toggle DEG / RAD
  function toggleAngleUnit() {
    state.angleUnit = state.angleUnit === 'DEG' ? 'RAD' : 'DEG';
    angleBadge.textContent = state.angleUnit;
    degRadBtn.textContent = state.angleUnit;
    updateDisplay();
  }

  // Toggle 2nd functions
  function toggleSecondFunctions() {
    state.isSecond = !state.isSecond;
    secondBtn.classList.toggle('active-toggle', state.isSecond);
    secondBadge.classList.toggle('hidden', !state.isSecond);

    document.querySelectorAll('[data-primary][data-secondary]').forEach((btn) => {
      btn.textContent = state.isSecond ? btn.dataset.secondary : btn.dataset.primary;
    });
  }

  // History Management
  function addHistoryItem(expr, result) {
    state.history.unshift({ expr, result });
    if (state.history.length > 20) state.history.pop();
    renderHistory();
  }

  function renderHistory() {
    historyList.innerHTML = '';
    if (state.history.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'history-empty';
      emptyLi.textContent = 'No calculations yet';
      historyList.appendChild(emptyLi);
      return;
    }

    state.history.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'history-item';
      li.innerHTML = `
        <span class="history-expr">${item.expr} =</span>
        <span class="history-res">${item.result}</span>
      `;
      li.addEventListener('click', () => {
        state.tokens = [
          { display: item.result, eval: item.result, type: 'constant' }
        ];
        state.justEvaluated = false;
        updateDisplay(item.result);
      });
      historyList.appendChild(li);
    });
  }

  // Handle all button actions
  function handleAction(action, btn) {
    switch (action) {
      case 'clear-all':
        state.tokens = [];
        state.justEvaluated = false;
        updateDisplay('0');
        break;

      case 'clear':
        if (state.justEvaluated) {
          state.tokens = [];
          state.justEvaluated = false;
          updateDisplay('0');
        } else {
          state.tokens.pop();
          updateDisplay();
        }
        break;

      case 'toggle-mode':
        toggleCalculatorMode();
        break;

      case 'operator': {
        const val = btn.dataset.value;
        const symbolMap = { '/': '÷', '*': '×', '-': '−', '+': '+' };
        pushToken({ display: symbolMap[val] || val, eval: val, type: 'operator' });
        break;
      }

      case 'decimal':
        pushToken({ display: '.', eval: '.', type: 'digit' });
        break;

      case 'percent':
        pushToken({ display: '%', eval: '*0.01', type: 'postfix' });
        break;

      case 'equals':
        evaluateExpression();
        break;

      case 'second':
        toggleSecondFunctions();
        break;

      case 'deg-rad':
        toggleAngleUnit();
        break;

      case 'sin':
        if (state.isSecond) {
          pushToken({ display: 'sin⁻¹(', eval: 'CalcMath.asin(', type: 'func' });
        } else {
          pushToken({ display: 'sin(', eval: 'CalcMath.sin(', type: 'func' });
        }
        break;

      case 'cos':
        if (state.isSecond) {
          pushToken({ display: 'cos⁻¹(', eval: 'CalcMath.acos(', type: 'func' });
        } else {
          pushToken({ display: 'cos(', eval: 'CalcMath.cos(', type: 'func' });
        }
        break;

      case 'tan':
        if (state.isSecond) {
          pushToken({ display: 'tan⁻¹(', eval: 'CalcMath.atan(', type: 'func' });
        } else {
          pushToken({ display: 'tan(', eval: 'CalcMath.tan(', type: 'func' });
        }
        break;

      case 'log':
        if (state.isSecond) {
          pushToken({ display: '10^(', eval: '(10**(', type: 'func' });
        } else {
          pushToken({ display: 'log(', eval: 'CalcMath.log10(', type: 'func' });
        }
        break;

      case 'ln':
        if (state.isSecond) {
          pushToken({ display: 'e^(', eval: 'Math.exp(', type: 'func' });
        } else {
          pushToken({ display: 'ln(', eval: 'CalcMath.ln(', type: 'func' });
        }
        break;

      case 'pow':
        if (state.isSecond) {
          pushToken({ display: '√', eval: 'NTHROOT', type: 'operator' });
        } else {
          pushToken({ display: '^', eval: '**', type: 'operator' });
        }
        break;

      case 'sqrt':
        if (state.isSecond) {
          pushToken({ display: '∛(', eval: 'CalcMath.cbrt(', type: 'func' });
        } else {
          pushToken({ display: '√(', eval: 'CalcMath.sqrt(', type: 'func' });
        }
        break;

      case 'square':
        if (state.isSecond) {
          pushToken({ display: '³', eval: '**3', type: 'postfix' });
        } else {
          pushToken({ display: '²', eval: '**2', type: 'postfix' });
        }
        break;

      case 'factorial':
        pushToken({ display: '!', eval: '!', type: 'postfix' });
        break;

      case 'reciprocal':
        pushToken({ display: '⁻¹', eval: '**(-1)', type: 'postfix' });
        break;

      case 'abs':
        pushToken({ display: 'abs(', eval: 'Math.abs(', type: 'func' });
        break;

      case 'open-paren':
        pushToken({ display: '(', eval: '(', type: 'open-paren' });
        break;

      case 'close-paren':
        pushToken({ display: ')', eval: ')', type: 'close-paren' });
        break;

      case 'pi':
        pushToken({ display: 'π', eval: 'Math.PI', type: 'constant' });
        break;

      case 'euler':
        pushToken({ display: 'e', eval: 'Math.E', type: 'constant' });
        break;

      case 'exp':
        pushToken({ display: 'E', eval: '*10**', type: 'operator' });
        break;

      case 'mod':
        pushToken({ display: ' mod ', eval: '%', type: 'operator' });
        break;

      case 'rand': {
        const r = Number(Math.random().toFixed(6));
        pushToken({ display: String(r), eval: String(r), type: 'constant' });
        break;
      }
    }
  }

  // Event Listeners
  calculatorEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    if (btn.dataset.digit !== undefined) {
      const d = btn.dataset.digit;
      pushToken({ display: d, eval: d, type: 'digit' });
      return;
    }

    if (btn.dataset.action) {
      handleAction(btn.dataset.action, btn);
    }
  });

  modeToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCalculatorMode();
  });

  historyToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    historyPanel.classList.toggle('hidden');
    historyToggleBtn.classList.toggle('active-toggle', !historyPanel.classList.contains('hidden'));
  });

  clearHistoryBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.history = [];
    renderHistory();
  });

  // Keyboard Support
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const { key } = e;

    if (/^[0-9]$/.test(key)) {
      e.preventDefault();
      pushToken({ display: key, eval: key, type: 'digit' });
    } else if (key === '.') {
      e.preventDefault();
      handleAction('decimal');
    } else if (key === '+' || key === '-' || key === '*' || key === '/') {
      e.preventDefault();
      const symbolMap = { '/': '÷', '*': '×', '-': '−', '+': '+' };
      pushToken({ display: symbolMap[key], eval: key, type: 'operator' });
    } else if (key === 'Enter' || key === '=') {
      e.preventDefault();
      evaluateExpression();
    } else if (key === 'Backspace') {
      e.preventDefault();
      handleAction('clear');
    } else if (key === 'Escape' || key === 'Delete') {
      e.preventDefault();
      handleAction('clear-all');
    } else if (key === '(') {
      e.preventDefault();
      handleAction('open-paren');
    } else if (key === ')') {
      e.preventDefault();
      handleAction('close-paren');
    } else if (key === '^') {
      e.preventDefault();
      pushToken({ display: '^', eval: '**', type: 'operator' });
    } else if (key === '%') {
      e.preventDefault();
      handleAction('percent');
    } else if (key === '!') {
      e.preventDefault();
      handleAction('factorial');
    }
  });
})();


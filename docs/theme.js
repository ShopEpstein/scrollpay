(function () {
  var THEMES = {
    default:   { label: 'Default', emoji: '☀️' },
    dark:      { label: 'Dark',    emoji: '🌙' },
    matrix:    { label: 'Matrix',  emoji: '🟩' },
    stacverse: { label: 'Stacverse', emoji: '🪐' },
  };

  var KEY = 'sp_theme';

  function applyTheme(name) {
    var t = THEMES[name] || THEMES.default;
    if (name === 'default') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', name);
    }
    try { localStorage.setItem(KEY, name); } catch (_) {}

    var btn = document.getElementById('sp-theme-toggle');
    if (btn) {
      btn.childNodes[0].textContent = t.emoji + ' ';
      var lbl = btn.querySelector('.sp-theme-lbl');
      if (lbl) lbl.textContent = t.label;
    }
    document.querySelectorAll('.sp-theme-opt').forEach(function (o) {
      o.classList.toggle('active', o.dataset.theme === name);
    });
  }

  // Restore on load
  var saved = 'default';
  try { saved = localStorage.getItem(KEY) || 'default'; } catch (_) {}
  applyTheme(saved);

  document.addEventListener('DOMContentLoaded', function () {
    var toggle = document.getElementById('sp-theme-toggle');
    var dd = document.getElementById('sp-theme-dd');
    if (!toggle || !dd) return;

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      dd.classList.toggle('open');
    });

    dd.querySelectorAll('.sp-theme-opt').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyTheme(btn.dataset.theme);
        dd.classList.remove('open');
      });
    });

    document.addEventListener('click', function () {
      dd.classList.remove('open');
    });
  });
})();

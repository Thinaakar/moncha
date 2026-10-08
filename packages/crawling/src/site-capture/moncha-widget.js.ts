/**
 * Demo chat widget uploaded as `moncha-widget.js` next to demo.html. Reads `window.__MONCHA_DEMO__`,
 * renders inside a closed Shadow DOM and never makes network requests.
 */
export const MONCHA_WIDGET_JS = String.raw`(function () {
  'use strict';
  if (window.__MONCHA_WIDGET_LOADED__) return;
  window.__MONCHA_WIDGET_LOADED__ = true;

  var cfg = window.__MONCHA_DEMO__ || {};
  var colors = cfg.colors || {};
  var primary = /^#[0-9a-f]{6}$/i.test(colors.primary || '') ? colors.primary : '#2563eb';
  var name = cfg.businessName || 'Our team';
  var faqs = Array.isArray(cfg.faqs) ? cfg.faqs.slice(0, 8) : [];

  function contrast(hex) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#111827' : '#ffffff';
  }
  var onPrimary = contrast(primary);

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'class') node.className = attrs[k];
      else node.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  var css = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '.launcher{position:fixed;right:20px;bottom:20px;width:60px;height:60px;border-radius:50%;border:0;cursor:pointer;',
    'background:' + primary + ';color:' + onPrimary + ';box-shadow:0 8px 24px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;z-index:2147483646}',
    '.launcher svg{width:28px;height:28px}',
    '.panel{position:fixed;right:20px;bottom:92px;width:360px;max-width:calc(100vw - 40px);height:520px;max-height:calc(100vh - 120px);',
    'background:#fff;color:#111827;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;z-index:2147483647}',
    '.panel.open{display:flex}',
    '.head{background:' + primary + ';color:' + onPrimary + ';padding:16px;display:flex;align-items:center;gap:12px}',
    '.head img{width:36px;height:36px;border-radius:8px;object-fit:contain;background:#fff}',
    '.head .t{font-weight:600;font-size:15px}.head .s{font-size:12px;opacity:.85}',
    '.close{margin-left:auto;background:transparent;border:0;color:inherit;font-size:22px;cursor:pointer;line-height:1}',
    '.body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;background:#f9fafb}',
    '.msg{max-width:85%;padding:10px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap}',
    '.bot{background:#fff;border:1px solid #e5e7eb;align-self:flex-start;border-bottom-left-radius:4px}',
    '.me{background:' + primary + ';color:' + onPrimary + ';align-self:flex-end;border-bottom-right-radius:4px}',
    '.chips{display:flex;flex-wrap:wrap;gap:6px}',
    '.chip{border:1px solid ' + primary + ';color:' + primary + ';background:#fff;border-radius:999px;padding:6px 10px;font-size:12px;cursor:pointer}',
    '.foot{padding:10px;border-top:1px solid #e5e7eb;display:flex;gap:8px;background:#fff}',
    '.foot input{flex:1;border:1px solid #d1d5db;border-radius:10px;padding:9px 10px;font-size:14px;outline:none}',
    '.foot button{background:' + primary + ';color:' + onPrimary + ';border:0;border-radius:10px;padding:0 14px;cursor:pointer;font-size:14px}',
    '.brand{font-size:10px;color:#9ca3af;text-align:center;padding:4px 0 8px;background:#fff}'
  ].join('');

  function mount() {
    if (!document.body) return;
    var host = el('div', { id: 'moncha-demo-widget' });
    document.body.appendChild(host);
    var root = host.attachShadow({ mode: 'closed' });
    root.appendChild(el('style', { text: css }));

    var body = el('div', { class: 'body' });
    var input = el('input', { type: 'text', placeholder: 'Type a message...', 'aria-label': 'Message' });
    var send = el('button', { type: 'button', text: 'Send' });
    var closeBtn = el('button', { class: 'close', type: 'button', 'aria-label': 'Close', text: '\u00d7' });
    var headText = el('div', null, [el('div', { class: 't', text: name }), el('div', { class: 's', text: 'Typically replies instantly' })]);
    var head = el('div', { class: 'head' }, [
      cfg.logoPath ? el('img', { src: cfg.logoPath, alt: '' }) : null,
      headText,
      closeBtn
    ]);
    var panel = el('div', { class: 'panel', role: 'dialog', 'aria-label': name + ' chat' }, [
      head, body, el('div', { class: 'foot' }, [input, send]), el('div', { class: 'brand', text: 'Demo assistant by MonCha' })
    ]);
    var launcher = el('button', { class: 'launcher', type: 'button', 'aria-label': 'Open chat' });
    launcher.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    root.appendChild(panel);
    root.appendChild(launcher);

    function add(text, who) {
      body.appendChild(el('div', { class: 'msg ' + who, text: text }));
      body.scrollTop = body.scrollHeight;
    }

    function contactLine() {
      var parts = [];
      if (cfg.phone) parts.push('call us at ' + cfg.phone);
      if (cfg.whatsapp) parts.push('message us on WhatsApp');
      if (cfg.email) parts.push('email ' + cfg.email);
      return parts.length ? 'You can also ' + parts.join(', or ') + '.' : '';
    }

    function answer(question) {
      var q = question.toLowerCase();
      var best = null, bestScore = 0;
      faqs.forEach(function (f) {
        var words = String(f.question || '').toLowerCase().split(/\W+/).filter(function (w) { return w.length > 3; });
        var score = words.filter(function (w) { return q.indexOf(w) >= 0; }).length;
        if (score > bestScore) { best = f; bestScore = score; }
      });
      if (best) return best.answer;
      return 'Thanks for your message! Our team will get back to you shortly. ' + contactLine();
    }

    function ask(text) {
      text = String(text || '').trim();
      if (!text) return;
      add(text, 'me');
      setTimeout(function () { add(answer(text), 'bot'); }, 450);
    }

    add(cfg.greeting || ('Hi! Welcome to ' + name + '. How can we help you today?'), 'bot');
    if (faqs.length) {
      var chips = el('div', { class: 'chips' });
      faqs.slice(0, 4).forEach(function (f) {
        var chip = el('button', { class: 'chip', type: 'button', text: f.question });
        chip.addEventListener('click', function () { ask(f.question); });
        chips.appendChild(chip);
      });
      body.appendChild(chips);
    }

    function toggle(open) { panel.classList.toggle('open', open); if (open) input.focus(); }
    launcher.addEventListener('click', function () { toggle(!panel.classList.contains('open')); });
    closeBtn.addEventListener('click', function () { toggle(false); });
    send.addEventListener('click', function () { ask(input.value); input.value = ''; });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { ask(input.value); input.value = ''; } });
    setTimeout(function () { toggle(true); }, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
`;

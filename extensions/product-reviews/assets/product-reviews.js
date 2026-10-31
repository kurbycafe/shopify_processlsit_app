(function () {
  var COPY = {
    de: { empty: 'Noch keine Bewertungen. Teile deine Erfahrung in der DAWAYO-App!', error: 'Bewertungen konnten nicht geladen werden.', count: function (n) { return n + (n === 1 ? ' Bewertung' : ' Bewertungen'); }, more: 'Mehr anzeigen', app: 'Aus der DAWAYO-App', photo: 'Foto der Bewertung', close: 'Schließen' },
    en: { empty: 'No reviews yet. Share yours in the DAWAYO app!', error: 'Could not load reviews.', count: function (n) { return n + (n === 1 ? ' review' : ' reviews'); }, more: 'Show more', app: 'From the DAWAYO app', photo: 'Review photo', close: 'Close' },
    ko: { empty: '아직 리뷰가 없어요. DAWAYO 앱에서 첫 리뷰를 남겨주세요!', error: '리뷰를 불러오지 못했어요.', count: function (n) { return '리뷰 ' + n + '개'; }, more: '더 보기', app: 'DAWAYO 앱 리뷰', photo: '리뷰 사진', close: '닫기' }
  };
  var STAR = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.6 7.7l5.8-.8z"/></svg>';

  function escape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function stars(rating) {
    var html = '';
    for (var i = 1; i <= 5; i++) html += '<span class="dw-star' + (i <= Math.round(rating) ? ' is-on' : '') + '">' + STAR + '</span>';
    return '<span class="dw-stars" role="img" aria-label="' + rating.toFixed(1) + ' / 5">' + html + '</span>';
  }
  // Only images the app stored (inline JPEG/PNG/WebP) or https links are shown.
  function safeImage(src) {
    return typeof src === 'string' && (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src) || /^https:\/\//.test(src)) ? src : null;
  }

  function card(review, copy) {
    var image = safeImage(review.image);
    return '<article class="dw-review">' +
      (image ? '<button type="button" class="dw-review__photo" data-photo="' + escape(image) + '" aria-label="' + escape(copy.photo) + '"><img src="' + escape(image) + '" alt="" loading="lazy" decoding="async"></button>' : '') +
      '<div class="dw-review__body">' +
        (review.rating ? stars(review.rating) : '') +
        '<p class="dw-review__text">' + escape(review.comment) + '</p>' +
        '<p class="dw-review__meta">' + escape(review.userName) + ' · ' + escape(review.date) + '</p>' +
      '</div></article>';
  }

  function render(root, reviews, copy) {
    var list = root.querySelector('.dw-reviews__list');
    var summary = root.querySelector('.dw-reviews__summary');
    var limit = parseInt(root.getAttribute('data-limit'), 10) || 6;
    if (!reviews.length) { list.innerHTML = '<p class="dw-reviews__empty">' + escape(copy.empty) + '</p>'; return; }
    var rated = reviews.filter(function (r) { return r.rating; });
    if (rated.length) {
      var average = rated.reduce(function (sum, r) { return sum + r.rating; }, 0) / rated.length;
      summary.innerHTML = '<strong class="dw-reviews__average">' + average.toFixed(1) + '</strong>' + stars(average) + '<span>' + escape(copy.count(reviews.length)) + '</span><span class="dw-reviews__source">' + escape(copy.app) + '</span>';
      summary.hidden = false;
    }
    var shown = 0;
    function more() {
      list.insertAdjacentHTML('beforeend', reviews.slice(shown, shown + limit).map(function (r) { return card(r, copy); }).join(''));
      shown = Math.min(reviews.length, shown + limit);
      var button = root.querySelector('.dw-reviews__more');
      if (button) button.remove();
      if (shown < reviews.length) {
        list.insertAdjacentHTML('afterend', '<button type="button" class="dw-reviews__more">' + escape(copy.more) + '</button>');
        root.querySelector('.dw-reviews__more').addEventListener('click', more);
      }
    }
    more();
  }

  function openPhoto(src, copy) {
    var dialog = document.createElement('dialog');
    dialog.className = 'dw-reviews__lightbox';
    dialog.innerHTML = '<img src="' + escape(src) + '" alt=""><button type="button" aria-label="' + escape(copy.close) + '">×</button>';
    dialog.addEventListener('click', function (event) { if (event.target === dialog || event.target.tagName === 'BUTTON') dialog.close(); });
    dialog.addEventListener('close', function () { dialog.remove(); });
    document.body.appendChild(dialog);
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
  }

  function init(root) {
    if (root.getAttribute('data-ready')) return;
    root.setAttribute('data-ready', '1');
    var lang = (root.getAttribute('data-lang') || 'de').slice(0, 2);
    var copy = COPY[lang] || COPY.de;
    var api = (root.getAttribute('data-api') || '').replace(/\/$/, '');
    var productId = root.getAttribute('data-product-id');
    root.addEventListener('click', function (event) {
      var photo = event.target.closest('[data-photo]');
      if (photo) openPhoto(photo.getAttribute('data-photo'), copy);
    });
    fetch(api + '/api/customer/v1/photo-reviews?productId=' + encodeURIComponent(productId), { headers: { Accept: 'application/json' } })
      .then(function (response) { return response.json(); })
      .then(function (result) {
        if (!result || result.success !== true) throw new Error('unavailable');
        render(root, (result.data && result.data.reviews || []).filter(function (r) { return r.productId === productId; }), copy);
      })
      .catch(function () { root.querySelector('.dw-reviews__list').innerHTML = '<p class="dw-reviews__empty">' + escape(copy.error) + '</p>'; });
  }

  function start() { document.querySelectorAll('[data-dw-reviews]').forEach(init); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  // Theme editor: re-run when the block is added or moved.
  document.addEventListener('shopify:section:load', start);
})();

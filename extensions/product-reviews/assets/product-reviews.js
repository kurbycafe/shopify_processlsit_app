(function () {
  var COPY = {
    de: { empty: 'Noch keine Bewertungen. Schreib die erste!', error: 'Bewertungen konnten nicht geladen werden.', count: function (n) { return n + (n === 1 ? ' Bewertung' : ' Bewertungen'); }, more: 'Mehr anzeigen', photo: 'Foto der Bewertung', close: 'Schließen',
      write: 'Bewertung schreiben', login: 'Anmelden, um eine Bewertung zu schreiben', rating: 'Deine Bewertung', star: function (n) { return n + ' von 5 Sternen'; }, comment: 'Wie hat es dir geschmeckt?', addPhoto: 'Foto hinzufügen (optional)', removePhoto: 'Foto entfernen',
      submit: 'Bewertung senden', sending: 'Wird gesendet…', thanks: 'Danke für deine Bewertung!', needRating: 'Bitte wähle 1 bis 5 Sterne.', needComment: 'Bitte schreib ein paar Worte.', failed: 'Die Bewertung konnte nicht gesendet werden. Bitte versuche es erneut.', badPhoto: 'Dieses Foto kann nicht verwendet werden.', app: 'App', web: 'Web' },
    en: { empty: 'No reviews yet. Be the first!', error: 'Could not load reviews.', count: function (n) { return n + (n === 1 ? ' review' : ' reviews'); }, more: 'Show more', photo: 'Review photo', close: 'Close',
      write: 'Write a review', login: 'Sign in to write a review', rating: 'Your rating', star: function (n) { return n + ' of 5 stars'; }, comment: 'How did you like it?', addPhoto: 'Add a photo (optional)', removePhoto: 'Remove photo',
      submit: 'Send review', sending: 'Sending…', thanks: 'Thanks for your review!', needRating: 'Choose 1 to 5 stars.', needComment: 'Write a few words.', failed: 'Could not send your review. Please try again.', badPhoto: 'This photo cannot be used.', app: 'App', web: 'Web' },
    ko: { empty: '아직 리뷰가 없어요. 첫 리뷰를 남겨주세요!', error: '리뷰를 불러오지 못했어요.', count: function (n) { return '리뷰 ' + n + '개'; }, more: '더 보기', photo: '리뷰 사진', close: '닫기',
      write: '리뷰 쓰기', login: '로그인하고 리뷰 쓰기', rating: '별점', star: function (n) { return '별 ' + n + '개'; }, comment: '맛은 어떠셨나요?', addPhoto: '사진 추가 (선택)', removePhoto: '사진 삭제',
      submit: '리뷰 등록', sending: '등록하는 중…', thanks: '리뷰를 남겨주셔서 고마워요!', needRating: '별점을 골라주세요.', needComment: '한두 마디 남겨주세요.', failed: '리뷰를 등록하지 못했어요. 다시 시도해주세요.', badPhoto: '이 사진은 쓸 수 없어요.', app: '앱', web: '웹' }
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
  // Only images the shop stored (inline JPEG/PNG/WebP) or https links are shown.
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
        '<p class="dw-review__meta">' + escape(review.userName) + ' · ' + escape(review.date) + ' · ' + escape(review.source === 'web' ? copy.web : copy.app) + '</p>' +
      '</div></article>';
  }

  function render(root, reviews, copy) {
    var list = root.querySelector('.dw-reviews__list');
    var summary = root.querySelector('.dw-reviews__summary');
    var limit = parseInt(root.getAttribute('data-limit'), 10) || 6;
    list.innerHTML = '';
    var oldMore = root.querySelector('.dw-reviews__more');
    if (oldMore) oldMore.remove();
    if (!reviews.length) { summary.hidden = true; list.innerHTML = '<p class="dw-reviews__empty">' + escape(copy.empty) + '</p>'; return; }
    var rated = reviews.filter(function (r) { return r.rating; });
    if (rated.length) {
      var average = rated.reduce(function (sum, r) { return sum + r.rating; }, 0) / rated.length;
      summary.innerHTML = '<strong class="dw-reviews__average">' + average.toFixed(1) + '</strong>' + stars(average) + '<span>' + escape(copy.count(reviews.length)) + '</span>';
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

  // Phone photos are several MB; the review store accepts ~200 KB inline images.
  function shrinkPhoto(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function () {
        var img = new Image();
        img.onerror = reject;
        img.onload = function () {
          var size = 1000, quality = 0.8;
          for (var attempt = 0; attempt < 6; attempt++) {
            var scale = Math.min(1, size / Math.max(img.width, img.height));
            var canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            var url = canvas.toDataURL('image/jpeg', quality);
            if (url.length < 190000) return resolve(url);
            size = Math.round(size * 0.8); quality = Math.max(0.5, quality - 0.08);
          }
          reject(new Error('too large'));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function writeForm(root, copy, reload) {
    var box = root.querySelector('.dw-reviews__write');
    if (!root.getAttribute('data-signed-in')) {
      box.innerHTML = '<a class="dw-reviews__login" href="' + escape(root.getAttribute('data-login-url')) + '">' + escape(copy.login) + '</a>';
      return;
    }
    box.innerHTML = '<button type="button" class="dw-reviews__open">' + escape(copy.write) + '</button>';
    box.querySelector('.dw-reviews__open').addEventListener('click', function () {
      var rating = 0, image = null;
      var starButtons = '';
      for (var i = 1; i <= 5; i++) starButtons += '<button type="button" class="dw-star dw-star--pick" data-value="' + i + '" aria-label="' + escape(copy.star(i)) + '" aria-pressed="false">' + STAR + '</button>';
      box.innerHTML = '<form class="dw-reviews__form" novalidate>' +
        '<fieldset class="dw-reviews__rating"><legend>' + escape(copy.rating) + '</legend>' + starButtons + '</fieldset>' +
        '<label class="dw-reviews__label">' + escape(copy.comment) + '<textarea name="comment" rows="4" maxlength="2000" required></textarea></label>' +
        '<div class="dw-reviews__photo-pick"><label class="dw-reviews__file">' + escape(copy.addPhoto) + '<input type="file" accept="image/jpeg,image/png,image/webp" hidden></label><span class="dw-reviews__preview"></span></div>' +
        '<p class="dw-reviews__error" role="alert" hidden></p>' +
        '<button type="submit" class="dw-reviews__submit">' + escape(copy.submit) + '</button></form>';
      var form = box.querySelector('form'), error = form.querySelector('.dw-reviews__error');
      var showError = function (message) { error.textContent = message; error.hidden = !message; };
      form.querySelectorAll('.dw-star--pick').forEach(function (button) {
        button.addEventListener('click', function () {
          rating = Number(button.getAttribute('data-value'));
          form.querySelectorAll('.dw-star--pick').forEach(function (other) {
            var on = Number(other.getAttribute('data-value')) <= rating;
            other.classList.toggle('is-on', on); other.setAttribute('aria-pressed', String(Number(other.getAttribute('data-value')) === rating));
          });
          showError('');
        });
      });
      var preview = form.querySelector('.dw-reviews__preview');
      form.querySelector('input[type=file]').addEventListener('change', function (event) {
        var file = event.target.files && event.target.files[0];
        if (!file) return;
        shrinkPhoto(file).then(function (url) {
          image = url;
          preview.innerHTML = '<img src="' + escape(url) + '" alt=""><button type="button" aria-label="' + escape(copy.removePhoto) + '">×</button>';
          preview.querySelector('button').addEventListener('click', function () { image = null; preview.innerHTML = ''; event.target.value = ''; });
          showError('');
        }).catch(function () { showError(copy.badPhoto); });
      });
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var comment = form.comment.value.trim();
        if (!rating) return showError(copy.needRating);
        if (!comment) return showError(copy.needComment);
        var submit = form.querySelector('.dw-reviews__submit');
        submit.disabled = true; submit.textContent = copy.sending;
        var title = root.getAttribute('data-product-title') || '';
        fetch(root.getAttribute('data-api') + '/reviews', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ productId: root.getAttribute('data-product-id'), productTitle: title, dishName: title.slice(0, 200), rating: rating, comment: comment, image: image })
        }).then(function (response) { return response.json(); }).then(function (result) {
          if (!result || result.success !== true) throw new Error('failed');
          box.innerHTML = '<p class="dw-reviews__thanks">' + escape(copy.thanks) + '</p>';
          reload();
        }).catch(function () {
          submit.disabled = false; submit.textContent = copy.submit; showError(copy.failed);
        });
      });
      form.querySelector('textarea').focus();
    });
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
    function load() {
      fetch(api + '/reviews?productId=' + encodeURIComponent(productId), { headers: { Accept: 'application/json' } })
        .then(function (response) { return response.json(); })
        .then(function (result) {
          if (!result || result.success !== true) throw new Error('unavailable');
          render(root, (result.data && result.data.reviews || []).filter(function (r) { return r.productId === productId; }), copy);
        })
        .catch(function () { root.querySelector('.dw-reviews__list').innerHTML = '<p class="dw-reviews__empty">' + escape(copy.error) + '</p>'; });
    }
    writeForm(root, copy, load);
    load();
  }

  function start() { document.querySelectorAll('[data-dw-reviews]').forEach(init); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  // Theme editor: re-run when the block is added or moved.
  document.addEventListener('shopify:section:load', start);
})();

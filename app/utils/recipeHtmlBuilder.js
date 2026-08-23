/**
 * Recipe HTML & Storefront Widget Generator
 * Generates SEO-optimized Article HTML with interactive bundle purchasing widget.
 */

export function buildAdvancedArticleHtml(recipe = {}, options = {}) {
  const {
    activeLocale = "de", // "de", "en", or "ko"
    currencySymbol = "€",
  } = options;

  let translations = recipe.translations;
  if (typeof translations === "string") {
    try {
      translations = JSON.parse(translations);
    } catch {
      translations = {};
    }
  }
  translations = translations || {};

  const locData = translations[activeLocale] || translations["ko"] || translations["de"] || translations["en"] || {
    title: recipe.title || "Untitled Recipe",
    introduction: recipe.introduction || "",
    steps: Array.isArray(recipe.steps) ? recipe.steps : (recipe.steps || "").split("\n").filter(Boolean)
  };

  const title = locData.title || recipe.title || "K-Food Recipe";
  const subtitle = locData.subtitle || "";
  const introduction = (locData.introduction || recipe.introduction || "").replace(/\n/g, "<br />");
  
  const rawSteps = Array.isArray(locData.steps) 
    ? locData.steps 
    : String(locData.steps || recipe.steps || "").split("\n").filter(Boolean);

  const stepsListHtml = rawSteps
    .map((step, idx) => {
      const cleanStep = String(step).replace(/^\d+[.)]\s*/, "").trim();
      if (!cleanStep) return "";
      return `
        <li style="margin-bottom: 16px; font-size: 1.05rem; color: #2d3748; line-height: 1.65; padding-left: 8px;">
          <strong style="color: #008060; font-weight: 700; margin-right: 6px;">Schritt ${idx + 1}.</strong>
          <span>${cleanStep}</span>
        </li>
      `;
    })
    .filter(Boolean)
    .join("");

  // Metadata badges
  const prepTime = recipe.prepTimeMinutes || 10;
  const cookTime = recipe.cookTimeMinutes || 15;
  const totalTime = prepTime + cookTime;
  const baseServings = recipe.servings || 2;
  const spiceLevel = recipe.spiceLevel ?? 2;

  let dietaryFlags = recipe.dietaryFlags;
  if (typeof dietaryFlags === "string") {
    try {
      dietaryFlags = JSON.parse(dietaryFlags);
    } catch {
      dietaryFlags = [];
    }
  }
  dietaryFlags = Array.isArray(dietaryFlags) ? dietaryFlags : [];

  let ingredients = recipe.ingredientsJson;
  if (typeof ingredients === "string") {
    try {
      ingredients = JSON.parse(ingredients);
    } catch {
      ingredients = [];
    }
  }
  ingredients = Array.isArray(ingredients) ? ingredients : [];

  const spiceLabels = ["Mild / Nicht scharf", "Leicht pikant", "Mittel scharf", "Sehr scharf", "Extrem scharf"];
  const spiceText = spiceLabels[spiceLevel] || "Mittel scharf";

  // Products and Ingredients list
  const products = Array.isArray(recipe.products) ? recipe.products : [];

  let productsCardsHtml = "";
  let essentialProductIds = [];
  let completeProductIds = [];

  products.forEach((p) => {
    const isAvailable = p.isAvailable !== false;
    const numericVariantId = String(p.variantId).replace("gid://shopify/ProductVariant/", "");
    const priceFloat = parseFloat(p.price || "0.00");
    const formattedPrice = isNaN(priceFloat) ? "0.00" : priceFloat.toFixed(2);
    const reqQty = p.requiredQuantity || 1;
    const isEssential = p.matchTier === "PRIMARY";

    completeProductIds.push(numericVariantId);
    if (isEssential) {
      essentialProductIds.push(numericVariantId);
    }

    const imgHtml = p.imageUrl
      ? `<img src="${p.imageUrl}" alt="${p.title}" style="width: 64px; height: 64px; object-fit: cover; border-radius: 8px; border: 1px solid #e2e8f0; flex-shrink: 0;" />`
      : `<div style="width: 64px; height: 64px; background: #edf2f7; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #718096; flex-shrink: 0;">No Image</div>`;

    const variantLabel = p.variantTitle && p.variantTitle !== "Default Title"
      ? `<span style="display: inline-block; font-size: 0.8rem; background: #edf2f7; color: #4a5568; padding: 2px 6px; border-radius: 4px; margin-top: 2px;">${p.variantTitle}</span>`
      : "";

    const stockBadge = isAvailable
      ? `<span style="font-size: 0.75rem; color: #008060; font-weight: 600;">Auf Lager</span>`
      : `<span style="font-size: 0.75rem; color: #e53e3e; font-weight: 600;">Ausverkauft</span>`;

    productsCardsHtml += `
      <div class="recipe-prod-card" data-variant-id="${numericVariantId}" data-price="${formattedPrice}" data-base-qty="${reqQty}" data-essential="${isEssential ? 'true' : 'false'}" style="display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; margin-bottom: 12px; transition: border-color 0.2s;">
        <div style="display: flex; align-items: center; gap: 14px; flex-grow: 1; min-width: 0;">
          <input type="checkbox" class="recipe-prod-checkbox" ${isAvailable ? 'checked' : 'disabled'} data-variant-id="${numericVariantId}" style="width: 20px; height: 20px; cursor: ${isAvailable ? 'pointer' : 'not-allowed'}; accent-color: #008060; flex-shrink: 0;" />
          ${imgHtml}
          <div style="flex-grow: 1; min-width: 0; padding-right: 12px;">
            <div style="font-weight: 600; color: #1a202c; font-size: 0.95rem; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.title}</div>
            <div style="display: flex; align-items: center; gap: 6px; margin-top: 2px;">
              ${variantLabel}
              ${stockBadge}
            </div>
            <div style="font-weight: 700; color: #008060; font-size: 0.95rem; margin-top: 4px;">${currencySymbol}${formattedPrice}</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
          <button type="button" class="recipe-qty-btn-minus" style="width: 32px; height: 32px; border: 1px solid #cbd5e0; background: #f7fafc; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 1.1rem; color: #4a5568; display: flex; align-items: center; justify-content: center;">-</button>
          <input type="number" class="recipe-prod-qty" value="${reqQty}" min="1" max="99" style="width: 44px; height: 32px; text-align: center; border: 1px solid #cbd5e0; border-radius: 6px; font-size: 0.95rem; font-weight: 600; color: #2d3748; margin: 0 2px;" />
          <button type="button" class="recipe-qty-btn-plus" style="width: 32px; height: 32px; border: 1px solid #cbd5e0; background: #f7fafc; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 1.1rem; color: #4a5568; display: flex; align-items: center; justify-content: center;">+</button>
        </div>
      </div>
    `;
  });

  // Schema.org structured JSON-LD for Google SEO
  const jsonLd = {
    "@context": "https://schema.org/",
    "@type": "Recipe",
    "name": title,
    "image": recipe.imageUrl ? [recipe.imageUrl] : [],
    "description": subtitle || introduction.replace(/<br\s*[/]?>/gi, " "),
    "prepTime": `PT${prepTime}M`,
    "cookTime": `PT${cookTime}M`,
    "totalTime": `PT${totalTime}M`,
    "recipeYield": `${baseServings} servings`,
    "recipeCategory": recipe.category,
    "recipeCuisine": "Korean",
    "recipeIngredient": ingredients.map((i) => `${i.amount} ${i.unit} ${i.nameDe || i.nameEn || i.nameKo}`),
    "recipeInstructions": rawSteps.map((step) => ({
      "@type": "HowToStep",
      "text": step
    }))
  };

  return `
<div class="recipe-commerce-wrapper" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 760px; margin: 24px auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); text-align: left;">
  
  ${recipe.imageUrl ? `
  <div style="width: 100%; max-height: 420px; overflow: hidden; background: #f7fafc; position: relative;">
    <img src="${recipe.imageUrl}" alt="${title}" style="width: 100%; height: 100%; max-height: 420px; object-fit: cover; display: block;" />
  </div>
  ` : ""}

  <div style="padding: 28px 24px;">
    
    <!-- Title & Subtitle -->
    <h1 style="font-size: 1.75rem; font-weight: 800; color: #1a202c; line-height: 1.3; margin: 0 0 8px 0;">${title}</h1>
    ${subtitle ? `<p style="font-size: 1.05rem; color: #718096; margin: 0 0 20px 0; line-height: 1.5;">${subtitle}</p>` : ""}

    <!-- Metadata Tags Bar -->
    <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid #edf2f7;">
      <span style="display: inline-flex; align-items: center; padding: 4px 10px; background: #ebf8fa; color: #008060; border-radius: 20px; font-size: 0.85rem; font-weight: 600;">
        Zubereitung: ${prepTime} Min. | Kochen: ${cookTime} Min.
      </span>
      <span style="display: inline-flex; align-items: center; padding: 4px 10px; background: #fef3f2; color: #b42318; border-radius: 20px; font-size: 0.85rem; font-weight: 600;">
        Schärfegrad: ${spiceText}
      </span>
      <span style="display: inline-flex; align-items: center; padding: 4px 10px; background: #f0fdf4; color: #166534; border-radius: 20px; font-size: 0.85rem; font-weight: 600;">
        Portionen: ${baseServings} Personen
      </span>
      ${dietaryFlags.map(flag => `
        <span style="display: inline-flex; align-items: center; padding: 4px 10px; background: #f8fafc; color: #475569; border: 1px solid #e2e8f0; border-radius: 20px; font-size: 0.85rem; font-weight: 500;">
          ${flag}
        </span>
      `).join("")}
    </div>

    <!-- Introduction Section -->
    <div style="margin-bottom: 32px;">
      <h2 style="font-size: 1.25rem; font-weight: 700; color: #1a202c; margin-bottom: 12px;">Über dieses Gericht</h2>
      <div style="font-size: 1rem; color: #4a5568; line-height: 1.7; white-space: pre-wrap;">${introduction}</div>
    </div>

    <!-- Cooking Steps Section -->
    <div style="margin-bottom: 36px; padding: 24px; background: #fcfdfd; border: 1px solid #e2e8f0; border-radius: 12px;">
      <h2 style="font-size: 1.25rem; font-weight: 700; color: #1a202c; margin-top: 0; margin-bottom: 18px;">Schritt-für-Schritt Zubereitung</h2>
      <ol style="margin: 0; padding-left: 20px;">
        ${stepsListHtml}
      </ol>
    </div>

    <!-- COMMERCE BUNDLE WIDGET -->
    <div id="recipe-bundle-widget" style="border: 2px solid #008060; border-radius: 14px; padding: 24px; background: #fbfdfc; box-shadow: 0 8px 24px rgba(0, 128, 96, 0.08);">
      
      <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px;">
        <div>
          <h3 style="font-size: 1.3rem; font-weight: 800; color: #008060; margin: 0 0 4px 0;">Zutaten für dieses Rezept bestellen</h3>
          <p style="font-size: 0.88rem; color: #5c6f84; margin: 0;">Wähle die gewünschten Zutaten und lege alle Produkte mit einem Klick in den Warenkorb.</p>
        </div>
        
        <!-- Servings Scaler -->
        <div style="display: flex; align-items: center; gap: 8px; background: #ffffff; padding: 6px 12px; border-radius: 8px; border: 1px solid #cbd5e0;">
          <span style="font-size: 0.85rem; font-weight: 600; color: #4a5568;">Portionen:</span>
          <button type="button" id="recipe-servings-minus" style="width: 26px; height: 26px; border: 1px solid #cbd5e0; background: #edf2f7; border-radius: 4px; cursor: pointer; font-weight: bold;">-</button>
          <span id="recipe-servings-display" style="font-size: 0.95rem; font-weight: 700; color: #1a202c; min-width: 20px; text-align: center;">${baseServings}</span>
          <button type="button" id="recipe-servings-plus" style="width: 26px; height: 26px; border: 1px solid #cbd5e0; background: #edf2f7; border-radius: 4px; cursor: pointer; font-weight: bold;">+</button>
        </div>
      </div>

      <!-- Bundle Tiers Selector -->
      <div style="display: flex; gap: 8px; margin-bottom: 20px;">
        <button type="button" id="bundle-tab-complete" class="recipe-bundle-tab active" style="flex: 1; padding: 10px 14px; border: 1px solid #008060; background: #008060; color: #ffffff; border-radius: 6px; font-size: 0.9rem; font-weight: 600; cursor: pointer;">
          Komplett-Paket (Alle Zutaten)
        </button>
        <button type="button" id="bundle-tab-essential" class="recipe-bundle-tab" style="flex: 1; padding: 10px 14px; border: 1px solid #cbd5e0; background: #ffffff; color: #4a5568; border-radius: 6px; font-size: 0.9rem; font-weight: 600; cursor: pointer;">
          Basis-Zutaten (Nur Hauptbestandteile)
        </button>
      </div>

      <!-- Products Cards Container -->
      <div class="recipe-products-list">
        ${productsCardsHtml || '<div style="text-align: center; color: #a0aec0; padding: 24px;">Keine Produkte verknüpft.</div>'}
      </div>

      <!-- Total Price and Add to Cart Summary Bar -->
      ${products.length > 0 ? `
      <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #e2e8f0; display: flex; flex-direction: column; gap: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.95rem; color: #4a5568; font-weight: 500;">
            Ausgewählt: <strong id="recipe-selected-count">0</strong> Artikel
          </span>
          <div style="text-align: right;">
            <span style="font-size: 0.85rem; color: #718096; display: block;">Gesamtpreis (inkl. MwSt.)</span>
            <span id="recipe-total-price" style="font-size: 1.4rem; font-weight: 800; color: #008060;">${currencySymbol}0.00</span>
          </div>
        </div>

        <button type="button" id="recipe-add-to-cart-btn" style="width: 100%; padding: 16px; background-color: #008060; color: #ffffff; border: none; border-radius: 8px; font-size: 1.1rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s; box-shadow: 0 4px 12px rgba(0, 128, 96, 0.25);">
          <span>Ausgewählte Zutaten in den Warenkorb</span>
        </button>
      </div>
      ` : ""}

    </div>

  </div>

  <!-- JSON-LD SEO Injection -->
  <script type="application/ld+json">
    ${JSON.stringify(jsonLd)}
  </script>

  <!-- STOREFRONT INTERACTIVITY SCRIPT -->
  <script>
    (function() {
      const widget = document.getElementById('recipe-bundle-widget');
      if (!widget) return;

      const currencySymbol = "${currencySymbol}";
      const baseServings = ${baseServings};
      let currentServings = baseServings;

      const servingsDisplay = document.getElementById('recipe-servings-display');
      const minusBtn = document.getElementById('recipe-servings-minus');
      const plusBtn = document.getElementById('recipe-servings-plus');
      const countDisplay = document.getElementById('recipe-selected-count');
      const priceDisplay = document.getElementById('recipe-total-price');
      const addBtn = document.getElementById('recipe-add-to-cart-btn');

      const tabComplete = document.getElementById('bundle-tab-complete');
      const tabEssential = document.getElementById('bundle-tab-essential');

      function recalculate() {
        let total = 0;
        let count = 0;
        const cards = widget.querySelectorAll('.recipe-prod-card');

        cards.forEach(card => {
          const checkbox = card.querySelector('.recipe-prod-checkbox');
          const qtyInput = card.querySelector('.recipe-prod-qty');
          const price = parseFloat(card.getAttribute('data-price') || '0');

          if (checkbox && checkbox.checked && !checkbox.disabled && qtyInput) {
            const qty = parseInt(qtyInput.value) || 1;
            total += price * qty;
            count++;
          }
        });

        if (countDisplay) countDisplay.textContent = count;
        if (priceDisplay) priceDisplay.textContent = currencySymbol + total.toFixed(2);
      }

      function updateServings(newServings) {
        if (newServings < 1 || newServings > 20) return;
        currentServings = newServings;
        if (servingsDisplay) servingsDisplay.textContent = currentServings;

        const ratio = currentServings / baseServings;
        const cards = widget.querySelectorAll('.recipe-prod-card');
        cards.forEach(card => {
          const baseQty = parseInt(card.getAttribute('data-base-qty') || '1');
          const qtyInput = card.querySelector('.recipe-prod-qty');
          if (qtyInput) {
            qtyInput.value = Math.max(1, Math.round(baseQty * ratio));
          }
        });
        recalculate();
      }

      if (minusBtn) minusBtn.addEventListener('click', () => updateServings(currentServings - 1));
      if (plusBtn) plusBtn.addEventListener('click', () => updateServings(currentServings + 1));

      // Quantity buttons on individual items
      widget.querySelectorAll('.recipe-prod-card').forEach(card => {
        const minus = card.querySelector('.recipe-qty-btn-minus');
        const plus = card.querySelector('.recipe-qty-btn-plus');
        const input = card.querySelector('.recipe-prod-qty');
        const checkbox = card.querySelector('.recipe-prod-checkbox');

        if (minus && input) {
          minus.addEventListener('click', () => {
            const val = parseInt(input.value) || 1;
            if (val > 1) {
              input.value = val - 1;
              recalculate();
            }
          });
        }

        if (plus && input) {
          plus.addEventListener('click', () => {
            const val = parseInt(input.value) || 1;
            input.value = val + 1;
            recalculate();
          });
        }

        if (input) {
          input.addEventListener('change', recalculate);
        }

        if (checkbox) {
          checkbox.addEventListener('change', recalculate);
        }
      });

      // Bundle tabs handler
      if (tabComplete && tabEssential) {
        tabComplete.addEventListener('click', () => {
          tabComplete.style.background = '#008060';
          tabComplete.style.color = '#ffffff';
          tabComplete.style.borderColor = '#008060';

          tabEssential.style.background = '#ffffff';
          tabEssential.style.color = '#4a5568';
          tabEssential.style.borderColor = '#cbd5e0';

          widget.querySelectorAll('.recipe-prod-card').forEach(card => {
            const cb = card.querySelector('.recipe-prod-checkbox');
            if (cb && !cb.disabled) cb.checked = true;
          });
          recalculate();
        });

        tabEssential.addEventListener('click', () => {
          tabEssential.style.background = '#008060';
          tabEssential.style.color = '#ffffff';
          tabEssential.style.borderColor = '#008060';

          tabComplete.style.background = '#ffffff';
          tabComplete.style.color = '#4a5568';
          tabComplete.style.borderColor = '#cbd5e0';

          widget.querySelectorAll('.recipe-prod-card').forEach(card => {
            const isEssential = card.getAttribute('data-essential') === 'true';
            const cb = card.querySelector('.recipe-prod-checkbox');
            if (cb && !cb.disabled) cb.checked = isEssential;
          });
          recalculate();
        });
      }

      // Add to cart AJAX
      if (addBtn) {
        addBtn.addEventListener('click', function() {
          const originalText = addBtn.innerHTML;
          const items = [];

          widget.querySelectorAll('.recipe-prod-card').forEach(card => {
            const cb = card.querySelector('.recipe-prod-checkbox');
            const qtyInput = card.querySelector('.recipe-prod-qty');
            if (cb && cb.checked && !cb.disabled && qtyInput) {
              const variantId = cb.getAttribute('data-variant-id');
              const quantity = parseInt(qtyInput.value) || 1;
              items.push({
                id: variantId,
                quantity: quantity,
                properties: {
                  '_recipe_id': '${recipe.id}',
                  '_recipe_title': '${title.replace(/'/g, "\\'")}'
                }
              });
            }
          });

          if (items.length === 0) {
            alert('Bitte wählen Sie mindestens ein Produkt aus.');
            return;
          }

          addBtn.disabled = true;
          addBtn.style.backgroundColor = '#718096';
          addBtn.innerHTML = '<span>Wird hinzugefügt...</span>';

          fetch('/cart/add.js', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({ items: items })
          })
          .then(res => {
            if (!res.ok) throw new Error('Cart update failed');
            return res.json();
          })
          .then(() => {
            addBtn.innerHTML = '<span>Erfolgreich hinzugefügt! Weiterleitung zum Warenkorb...</span>';
            addBtn.style.backgroundColor = '#2f855a';
            setTimeout(() => {
              window.location.href = '/cart';
            }, 800);
          })
          .catch(err => {
            console.error('Add to cart error:', err);
            alert('Fehler beim Hinzufügen zum Warenkorb. Bitte versuchen Sie es erneut.');
            addBtn.disabled = false;
            addBtn.style.backgroundColor = '#008060';
            addBtn.innerHTML = originalText;
          });
        });
      }

      // Initial calculation
      recalculate();
    })();
  </script>
</div>
  `;
}

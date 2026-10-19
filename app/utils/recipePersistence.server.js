import { randomUUID } from "node:crypto";
import { unpackRecipe, recipeArticlePath } from "./recipeData.js";
import { buildAdvancedArticleHtml } from "./recipeHtmlBuilder.js";

export const DELETE_ARTICLE = `#graphql
  mutation DeleteRecipeArticle($id: ID!) {
    articleDelete(id: $id) { deletedArticleId userErrors { field message } }
  }`;
export const UPDATE_ARTICLE = `#graphql
  mutation UpdateRecipeArticle($id: ID!, $article: ArticleUpdateInput!) {
    articleUpdate(id: $id, article: $article) {
      article { id handle blog { handle } } userErrors { field message }
    }
  }`;
export const CREATE_ARTICLE = `#graphql
  mutation CreateRecipeArticle($article: ArticleCreateInput!) {
    articleCreate(article: $article) {
      article { id handle blog { handle } } userErrors { field message }
    }
  }`;

async function mutate(admin, query, variables, key) {
  const response = await admin.graphql(query, { variables });
  const payload = await response.json();
  const result = payload.data?.[key];
  if (response.ok === false || payload.errors?.length || !result || result.userErrors?.length) {
    throw new Error(result?.userErrors?.map(error => error.message).join(", ") || "Shopify 요청에 실패했습니다.");
  }
  return result;
}

function readJson(form, field, fallback, isArray = false) {
  const value = JSON.parse(form.get(field) || JSON.stringify(fallback));
  if (!value || typeof value !== "object" || Array.isArray(value) !== isArray) throw new Error(`${field} 형식이 올바르지 않습니다.`);
  return value;
}

function integer(form, field, fallback, minimum = 0, maximum = 1440) {
  const value = Number(form.get(field) ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${field} 값이 올바르지 않습니다.`);
  return value;
}

export async function handleRecipeAction({ form, shop, admin, db }) {
  const intent = form.get("intent");
  const id = String(form.get("id") || "").trim();
  const errorResult = (error, status = 400, recipe) => Response.json({ success: false, error, ...(recipe ? { recipe } : {}) }, { status });
  if (!["save", "publish", "delete"].includes(intent)) return errorResult("알 수 없는 요청입니다.");
  let existing = null;
  if (id) {
    existing = await db.recipe.findFirst({ where: { id, shop }, include: { products: true } });
    if (!existing) return errorResult("레시피를 찾을 수 없습니다.", 404);
  }
  if (intent === "delete") {
    if (!existing) return errorResult("레시피를 찾을 수 없습니다.", 404);
    try {
      if (existing.shopifyArticleId) {
        const result = await mutate(admin, DELETE_ARTICLE, { id: existing.shopifyArticleId }, "articleDelete");
        if (result.deletedArticleId !== existing.shopifyArticleId) throw new Error("Shopify 글 삭제를 확인하지 못했습니다.");
      }
      await db.recipe.deleteMany({ where: { id, shop } });
      return Response.json({ success: true, deletedId: id, message: "레시피가 삭제되었습니다." });
    } catch (error) {
      return errorResult(error.message, 502);
    }
  }
  let recipe;
  try {
    const title = String(form.get("title") || "").trim();
    if (!title) throw new Error("레시피 제목을 입력해 주세요.");
    const shopifyBlogId = String(form.get("shopifyBlogId") || "") || null;
    if (intent === "publish" && !shopifyBlogId) throw new Error("게시할 블로그 채널을 선택해 주세요.");
    if (existing?.shopifyArticleId && existing.shopifyBlogId !== shopifyBlogId) throw new Error("게시된 레시피는 기존 블로그 채널에서 수정해 주세요.");
    const translations = readJson(form, "translations", {});
    const ingredientsJson = readJson(form, "ingredientsJson", [], true);
    const dietaryFlags = readJson(form, "dietaryFlags", [], true);
    const products = readJson(form, "productsJson", [], true);
    const seen = new Set();
    const productsMetadata = {};
    const productRows = products.map(product => {
      if (!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(product.variantId) || !/^gid:\/\/shopify\/Product\/\d+$/.test(product.productId) || seen.has(product.variantId)) throw new Error("연결 상품 ID가 올바르지 않거나 중복되었습니다.");
      seen.add(product.variantId);
      const quantity = Number(product.requiredQuantity ?? 1);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("상품 구매 수량은 1~99여야 합니다.");
      productsMetadata[product.variantId] = {
        requiredQuantity: quantity,
        isAvailable: product.isAvailable !== false,
        matchTier: product.matchTier === "PRIMARY" ? "PRIMARY" : "ALTERNATIVE",
        ingredientName: String(product.ingredientName || ""),
        confidenceScore: Number.isFinite(Number(product.confidenceScore)) ? Math.max(0, Math.min(1, Number(product.confidenceScore))) : 0,
        isApproved: product.isApproved === true,
      };
      return Object.fromEntries(["productId", "variantId", "title", "variantTitle", "price", "imageUrl"].map(field => [field, String(product[field] || "")]));
    });
    const steps = translations.de?.steps || translations.ko?.steps || "";
    const previous = unpackRecipe(existing);
    const metadata = {
      stepsText: Array.isArray(steps) ? steps.join("\n") : String(steps),
      category: String(form.get("category") || "MAIN"),
      occasion: String(form.get("occasion") || "DINNER"),
      difficulty: String(form.get("difficulty") || "EASY"),
      prepTimeMinutes: integer(form, "prepTimeMinutes", 10),
      cookTimeMinutes: integer(form, "cookTimeMinutes", 15),
      servings: integer(form, "servings", 2, 1, 99),
      spiceLevel: integer(form, "spiceLevel", 2, 0, 5),
      translations, ingredientsJson, dietaryFlags, productsMetadata,
      articlePath: previous?.articlePath || null,
    };
    const data = {
      shop, title, introduction: String(translations.de?.introduction || translations.ko?.introduction || ""),
      steps: JSON.stringify(metadata), imageUrl: String(form.get("imageUrl") || ""), shopifyBlogId,
    };
    // A stable draft ID makes retries update the same draft instead of duplicating it.
    const draftId = id || String(form.get("draftId") || randomUUID());
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(draftId)) throw new Error("레시피 식별자가 올바르지 않습니다.");
    const raw = await db.$transaction(async tx => tx.recipe.upsert({
      where: { id: draftId, shop },
      create: { id: draftId, ...data, products: { create: productRows } },
      update: { ...data, products: { deleteMany: {}, create: productRows } },
      include: { products: true },
    }));
    recipe = unpackRecipe(raw);
    if (intent === "publish") {
      const article = {
        title: translations.de?.title || title,
        body: buildAdvancedArticleHtml(recipe, { activeLocale: "de", currencySymbol: "€" }),
        isPublished: true,
        ...(recipe.imageUrl ? { image: { url: recipe.imageUrl } } : {}),
      };
      const result = recipe.shopifyArticleId
        ? await mutate(admin, UPDATE_ARTICLE, { id: recipe.shopifyArticleId, article }, "articleUpdate")
        : await mutate(admin, CREATE_ARTICLE, { article: { ...article, blogId: shopifyBlogId, author: { name: "DAWAYO K-Food" } } }, "articleCreate");
      if (!result.article?.id) throw new Error("Shopify 게시 결과를 확인하지 못했습니다.");
      metadata.articlePath = recipeArticlePath(result.article);
      const updated = await db.recipe.update({ where: { id: recipe.id, shop }, data: {
        shopifyArticleId: result.article.id, published: true, steps: JSON.stringify(metadata),
      }, include: { products: true } });
      recipe = unpackRecipe(updated);
    }
    return Response.json({ success: true, recipe });
  } catch (error) {
    // Return the persisted draft even when publishing fails, so retries keep its ID.
    return errorResult(error.message || "레시피 저장에 실패했습니다.", recipe ? 502 : 400, recipe);
  }
}

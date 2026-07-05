import { useState, useEffect } from "react";
import { useLoaderData, useFetcher, Form, useSubmit, useNavigation } from "react-router";
import {
  Page,
  Layout,
  Card,
  Button,
  TextField,
  Select,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Banner,
  Box,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// --- PRESET RECIPES DATA ---
const RECIPE_PRESETS = {
  tteokbokki: {
    title: "매콤달콤 쫄깃한 한국 대표 길거리 간식, 떡볶이",
    imageUrl: "https://images.unsplash.com/photo-1627308595229-7830a5c91f9f?q=80&w=1000&auto=format&fit=crop",
    introduction: "떡볶이는 한국의 가장 사랑받는 대표적인 길거리 음식입니다. 쫄깃쫄깃한 쌀떡과 매콤하면서도 달콤한 고추장 베이스 소스가 환상적인 조화를 이룹니다. 기호에 따라 삶은 계란, 튀김, 만두 등을 곁들이면 한 끼 식사나 든든한 간식으로 안성맞춤입니다. 최근에는 전 세계 미식가들에게 대표 한국 매운맛 요리로 널리 인정받고 있습니다.",
    steps: "1. 떡볶이 떡(300g)을 찬물에 10분 정도 담가 불린 후 헹궈 건져냅니다.\n2. 사각 어묵(2장)을 한입 크기로 썰고, 대파(1대)는 어슷썰기하여 준비합니다.\n3. 냄비에 물 2컵 반(500ml)을 붓고 고추장 2큰술, 고춧가루 1큰술, 양조간장 1큰술, 올리고당 2큰술, 다진 마늘 1/2작은술을 풀어 양념장을 만듭니다.\n4. 양념장이 끓어오르면 떡을 먼저 넣고 끓여 떡 속까지 양념이 스며들게 합니다.\n5. 떡이 말랑해지면 썰어둔 어묵과 대파를 넣어 약 5분간 중불에서 국물이 자작해질 때까지 조리합니다.\n6. 참기름 몇 방울과 함께 예쁜 그릇에 담아내고, 통깨를 가볍게 뿌려 마무리합니다."
  },
  kimchijjigae: {
    title: "얼큰하고 진한 국물 맛, 밥도둑 돼지고기 김치찌개",
    imageUrl: "https://images.unsplash.com/photo-1627308595260-6fad84c1ec66?q=80&w=1000&auto=format&fit=crop",
    introduction: "김치찌개는 한국의 대표적인 소울푸드로, 잘 익은 신김치와 돼지고기를 함께 푹 끓여내 깊고 시원한 맛이 특징입니다. 뜨끈한 국물과 얼큰함이 어우러져 한국인의 밥상에서 빼놓을 수 없는 가장 보편적이면서도 특별한 가정 요리입니다. 두부를 더해 부드러운 식감을 살릴 수 있습니다.",
    steps: "1. 잘 익은 신김치(200g)를 먹기 좋은 한입 크기로 대충 썰어줍니다.\n2. 찌개용 돼지고기(목살 혹은 삼겹살 150g)를 준비하여 냄비에 넣고 참기름 1큰술과 함께 고기 겉면이 하얗게 익을 때까지 약불에서 볶아줍니다.\n3. 볶아진 고기에 김치와 다진 마늘 1큰술을 추가하여 김치 숨이 죽고 나른해질 때까지 5분 정도 함께 달달 볶아줍니다.\n4. 재료가 자작하게 잠길 정도로 쌀뜨물 또는 육수(600ml)를 붓고 강불에서 팔팔 끓여줍니다.\n5. 국물이 끓어오르면 중불로 줄여 15분 이상 은근히 끓여 김치와 고기에서 깊은 맛이 우러나오게 합니다.\n6. 숭덩숭덩 썬 두부(1/2모), 대파(1/2대), 청양고추(1개)를 얹고 5분간 더 끓여준 후 소금이나 국간장으로 간을 맞춰 서빙합니다."
  },
  bulgogi: {
    title: "달콤 짭조름하고 부드러운 한국 정통 소고기 불고기",
    imageUrl: "https://images.unsplash.com/photo-1544025162-d76694265947?q=80&w=1000&auto=format&fit=crop",
    introduction: "불고기는 소고기를 얇게 썰어 달콤 짭조름한 양념장에 재웠다가 야채와 함께 볶아내는 한국의 전통 육류 요리입니다. 자극적이지 않고 고소하며 부드러운 식감 덕분에 어린아이부터 어르신들까지, 그리고 해외 여행객들에게도 매우 인기가 높습니다. 밥 반찬은 물론 쌈채소와 함께 곁들여 먹을 때 그 진가가 드러납니다.",
    steps: "1. 얇게 썬 불고기용 소고기(400g)를 키친타월로 눌러 핏물을 가볍게 제거합니다.\n2. 볼에 진간장 4큰술, 황설탕 2큰술, 맛술 2큰술, 다진 마늘 1큰술, 다진 파 2큰술, 배즙(또는 간 사과) 3큰술, 참기름 1큰술, 후추 약간을 섞어 양념장을 만듭니다.\n3. 양념장에 소고기를 고루 섞어 버무리고, 채 썬 양파(1/2개), 대파(1대), 당근(1/3개)을 함께 넣어 조물조물한 후 약 30분 동안 냉장실에서 재워둡니다.\n4. 달군 팬에 식용유를 두르지 않고 재워둔 불고기와 야채를 한 번에 강불로 올려 볶습니다.\n5. 고기 핏기가 사라지고 채소의 아삭함이 적당히 남을 때까지 빠르게 볶아 육즙을 잡습니다.\n6. 마지막에 깨소금을 솔솔 뿌린 후, 신선한 상추 및 깻잎 쌈과 함께 올립니다."
  },
  bibimbap: {
    title: "형형색색 조화로운 웰빙 건강식, 오색 비빔밥",
    imageUrl: "https://images.unsplash.com/photo-1590301157890-4810ed352733?q=80&w=1000&auto=format&fit=crop",
    introduction: "비빔밥은 갓 지은 하얀 쌀밥 위에 가지각색으로 조리된 오색 나물과 양념한 소고기, 계란 프라이를 얹고 고추장과 참기름으로 슥슥 비벼 먹는 영양 만점 웰빙 식사입니다. 붉은색, 초록색, 흰색, 노란색, 검은색 등 오방색 조화가 눈을 즐겁게 하며, 여러 나물들이 입안에서 조화롭게 융화되는 한국의 지혜가 담긴 대표 음식입니다.",
    steps: "1. 당근(1/3개), 애호박(1/3개)은 가늘게 채 썰어 소금을 약간 치고 각각 팬에 기름을 두르고 재빨리 볶아 식혀 둡니다.\n2. 데친 시금치와 콩나물은 물기를 완전히 짠 후 각각 소금, 다진 마늘, 참기름으로 조물조물 무쳐 둡니다.\n3. 표고버섯(2장)을 얇게 썰어 간장 1작은술, 참기름 약간에 볶고, 다진 소고기(50g)도 간장 양념에 볶아 고명용 고기를 준비합니다.\n4. 따뜻한 대접에 밥 1공기를 담고, 준비한 나물들과 버섯, 소고기 볶음을 그릇 가장자리를 따라 정갈하고 알록달록하게 돌려 담습니다.\n5. 가운데에 노른자가 살아있는 계란 프라이를 올립니다.\n6. 먹기 직전에 약고추장(또는 일반 고추장) 1큰술과 고소한 참기름 1큰술을 둘러 밥과 나물이 뭉개지지 않게 숟가락이나 젓가락으로 비벼서 즐깁니다."
  }
};

// --- LOADER ---
export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const searchProducts = url.searchParams.get("searchProducts");

  // Endpoint: Product search for the interactive selector
  if (searchProducts) {
    const response = await admin.graphql(
      `#graphql
      query searchProducts($query: String!) {
        products(first: 10, query: $query) {
          nodes {
            id
            title
            featuredImage {
              url
            }
            variants(first: 10) {
              nodes {
                id
                title
                price
                image {
                  url
                }
              }
            }
          }
        }
      }`,
      { variables: { query: `title:*${searchProducts}*` } }
    );
    const json = await response.json();
    const products = json.data?.products?.nodes || [];
    return Response.json({ products });
  }

  // Fetch local recipes
  const recipes = await prisma.recipe.findMany({
    where: { shop },
    include: { products: true },
    orderBy: { createdAt: "desc" },
  });

  // Fetch store blogs (to target where to post the article)
  let blogs = [];
  try {
    const blogRes = await admin.graphql(
      `#graphql
      query getBlogs {
        blogs(first: 30) {
          nodes {
            id
            title
            handle
          }
        }
      }`
    );
    const blogJson = await blogRes.json();
    blogs = blogJson.data?.blogs?.nodes || [];
  } catch (err) {
    console.error("Error loading Shopify blogs:", err);
  }

  // Get active shop primary domain
  let shopUrl = `https://${shop}`;
  try {
    const shopRes = await admin.graphql(
      `#graphql
      query getShop {
        shop {
          primaryDomain {
            url
          }
        }
      }`
    );
    const shopJson = await shopRes.json();
    if (shopJson.data?.shop?.primaryDomain?.url) {
      shopUrl = shopJson.data.shop.primaryDomain.url;
    }
  } catch (err) {
    console.error("Error loading shop url:", err);
  }

  return { recipes, blogs, shopUrl };
}

// --- ACTION ---
export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  // Action: DELETE Recipe
  if (intent === "delete") {
    const id = formData.get("id");

    // Find recipe to delete from shopify blog as well
    const recipe = await prisma.recipe.findUnique({
      where: { id },
    });

    if (recipe && recipe.shopifyArticleId && recipe.shopifyBlogId) {
      try {
        await admin.graphql(
          `#graphql
          mutation articleDelete($blogId: ID!, $id: ID!) {
            articleDelete(blogId: $blogId, id: $id) {
              deletedId
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: {
              blogId: recipe.shopifyBlogId,
              id: recipe.shopifyArticleId,
            },
          }
        );
      } catch (err) {
        console.error("Error deleting Article in Shopify:", err);
      }
    }

    await prisma.recipe.delete({
      where: { id },
    });

    return Response.json({ success: true, message: "레시피가 삭제되었습니다." });
  }

  // Action: SAVE (Draft) or PUBLISH
  if (intent === "save" || intent === "publish") {
    const id = formData.get("id") || undefined;
    const title = formData.get("title");
    const introduction = formData.get("introduction");
    const steps = formData.get("steps");
    const imageUrl = formData.get("imageUrl") || "";
    const shopifyBlogId = formData.get("shopifyBlogId");
    const productsJson = formData.get("productsJson");
    const productsData = JSON.parse(productsJson || "[]");

    let recipe;
    if (id) {
      // Clear previous matched products and update
      await prisma.recipeProduct.deleteMany({
        where: { recipeId: id },
      });

      recipe = await prisma.recipe.update({
        where: { id },
        data: {
          title,
          introduction,
          steps,
          imageUrl,
          shopifyBlogId,
          products: {
            create: productsData.map((p) => ({
              productId: p.productId,
              variantId: p.variantId,
              title: p.title,
              variantTitle: p.variantTitle || "",
              price: String(p.price || ""),
              imageUrl: p.imageUrl || "",
            })),
          },
        },
        include: { products: true },
      });
    } else {
      recipe = await prisma.recipe.create({
        data: {
          shop,
          title,
          introduction,
          steps,
          imageUrl,
          shopifyBlogId,
          products: {
            create: productsData.map((p) => ({
              productId: p.productId,
              variantId: p.variantId,
              title: p.title,
              variantTitle: p.variantTitle || "",
              price: String(p.price || ""),
              imageUrl: p.imageUrl || "",
            })),
          },
        },
        include: { products: true },
      });
    }

    // Handle publishing directly to Shopify Store
    if (intent === "publish") {
      if (!shopifyBlogId) {
        return Response.json(
          { success: false, error: "게시할 쇼피파이 블로그를 지정해 주세요." },
          { status: 400 }
        );
      }

      // Generate HTML containing introduction, steps, products widget, and AJAX cart script
      const bodyHtml = buildArticleHtml(recipe);
      let shopifyArticleId = recipe.shopifyArticleId;

      if (shopifyArticleId) {
        // Update existing shopify article
        const response = await admin.graphql(
          `#graphql
          mutation articleUpdate($id: ID!, $article: ArticleUpdateInput!) {
            articleUpdate(id: $id, article: $article) {
              article {
                id
                title
              }
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: {
              id: shopifyArticleId,
              article: {
                title: recipe.title,
                body: bodyHtml,
                ...(recipe.imageUrl ? { image: { src: recipe.imageUrl } } : {}),
              },
            },
          }
        );
        const resJson = await response.json();
        const errors = resJson.data?.articleUpdate?.userErrors || [];
        if (errors.length > 0) {
          return Response.json(
            { success: false, error: "쇼피파이 글 수정 실패: " + errors.map((e) => e.message).join(", ") },
            { status: 400 }
          );
        }
      } else {
        // Create new article in Shopify Blog
        const response = await admin.graphql(
          `#graphql
          mutation articleCreate($article: ArticleCreateInput!) {
            articleCreate(article: $article) {
              article {
                id
                title
                handle
                blog {
                  id
                }
              }
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: {
              article: {
                blogId: shopifyBlogId,
                title: recipe.title,
                body: bodyHtml,
                isPublished: true,
                author: { name: "DAWAYO" },
                ...(recipe.imageUrl ? { image: { src: recipe.imageUrl } } : {}),
              },
            },
          }
        );
        const resJson = await response.json();
        const errors = resJson.data?.articleCreate?.userErrors || [];
        if (errors.length > 0) {
          return Response.json(
            { success: false, error: "쇼피파이 글 등록 실패: " + errors.map((e) => e.message).join(", ") },
            { status: 400 }
          );
        }

        const createdArticle = resJson.data?.articleCreate?.article;
        if (createdArticle) {
          recipe = await prisma.recipe.update({
            where: { id: recipe.id },
            data: {
              shopifyArticleId: createdArticle.id,
              published: true,
            },
            include: { products: true },
          });
        }
      }
    }

    return Response.json({ success: true, recipe });
  }

  return Response.json({ success: false, error: "알 수 없는 요청입니다." }, { status: 400 });
}

// --- ARTICLE HTML BUILDER ---
function buildArticleHtml(recipe) {
  const introHtml = recipe.introduction.replace(/\n/g, "<br />");
  const stepsHtml = recipe.steps
    .split("\n")
    .map((step) => {
      const trimmed = step.trim();
      if (!trimmed) return "";
      return `<li style="margin-bottom: 12px; font-size: 1.05rem; color: #2d3748; line-height: 1.6;">${trimmed}</li>`;
    })
    .filter(Boolean)
    .join("");

  let productsCardsHtml = "";
  recipe.products.forEach((p) => {
    const priceText = p.price && !isNaN(parseFloat(p.price))
      ? `${parseFloat(p.price).toLocaleString()}원`
      : `${p.price || ""}`;
    const imgHtml = p.imageUrl
      ? `<img src="${p.imageUrl}" alt="${p.title}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 6px; border: 1px solid #edf2f7; flex-shrink: 0;" />`
      : `<div style="width: 60px; height: 60px; background: #edf2f7; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #a0aec0; flex-shrink: 0;">No Image</div>`;

    const variantTitleHtml = p.variantTitle && p.variantTitle !== "Default Title"
      ? `<div style="font-size: 0.85rem; color: #718096; margin-top: 1px;">옵션: ${p.variantTitle}</div>`
      : "";

    productsCardsHtml += `
      <div class="recipe-product-card" style="display: flex; align-items: center; justify-content: space-between; padding: 14px; border: 1px solid #edf2f7; border-radius: 8px; background: #ffffff; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); text-align: left;">
        <div style="display: flex; align-items: center; gap: 12px; overflow: hidden; width: 100%;">
          <input type="checkbox" class="recipe-prod-checkbox" checked data-variant-id="${p.variantId}" style="width: 18px; height: 18px; cursor: pointer; accent-color: #ff4a5a; flex-shrink: 0; margin-right: 4px;" />
          ${imgHtml}
          <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: calc(100% - 90px);">
            <div style="font-weight: 600; color: #1a202c; font-size: 0.95rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.title}</div>
            ${variantTitleHtml}
            <div style="font-weight: bold; color: #ff4a5a; font-size: 0.9rem; margin-top: 2px;">${priceText}</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0; margin-left: 10px;">
          <button type="button" onclick="this.nextElementSibling.stepDown(); this.nextElementSibling.dispatchEvent(new Event('change'))" style="width: 28px; height: 28px; border: 1px solid #cbd5e0; background: #f7fafc; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 1rem; color: #4a5568;">-</button>
          <input type="number" class="recipe-prod-qty" value="1" min="1" style="width: 42px; height: 28px; text-align: center; border: 1px solid #cbd5e0; border-radius: 4px; font-size: 14px; -moz-appearance: textfield; font-weight: 500; margin: 0 2px; color: #2d3748;" />
          <button type="button" onclick="this.previousElementSibling.stepUp(); this.previousElementSibling.dispatchEvent(new Event('change'))" style="width: 28px; height: 28px; border: 1px solid #cbd5e0; background: #f7fafc; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 1rem; color: #4a5568;">+</button>
        </div>
      </div>
    `;
  });

  return `
<div class="recipe-container" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 720px; margin: 20px auto; padding: 25px; border-radius: 12px; border: 1px solid #e2e8f0; background: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); text-align: left;">
  ${recipe.imageUrl ? `<div style="margin-bottom: 25px; text-align: center;"><img src="${recipe.imageUrl}" alt="${recipe.title}" style="max-width: 100%; height: auto; border-radius: 8px; max-height: 360px; object-fit: cover; box-shadow: 0 4px 12px rgba(0,0,0,0.08);" /></div>` : ""}

  <div class="recipe-intro" style="margin-bottom: 30px;">
    <h2 style="font-size: 1.4rem; color: #1a202c; border-bottom: 2px solid #ff4a5a; padding-bottom: 8px; margin-bottom: 15px; font-weight: 700; display: flex; align-items: center; gap: 6px;">🇰🇷 한국 음식 소개</h2>
    <div style="font-size: 1rem; color: #4a5568; line-height: 1.7; white-space: pre-wrap;">${introHtml}</div>
  </div>

  <div class="recipe-steps" style="margin-bottom: 35px; padding: 20px 25px; background-color: #fffafb; border-left: 5px solid #ff4a5a; border-radius: 8px;">
    <h2 style="font-size: 1.4rem; color: #1a202c; margin-top: 0; margin-bottom: 15px; font-weight: 700; display: flex; align-items: center; gap: 6px;">🍳 조리 레시피 (Steps)</h2>
    <ol style="margin: 0; padding-left: 20px; text-align: left;">
      ${stepsHtml}
    </ol>
  </div>

  <div class="recipe-ingredients-widget" style="border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; background: #f7fafc; margin-top: 35px;">
    <h3 style="font-size: 1.2rem; margin-top: 0; margin-bottom: 6px; color: #1a202c; font-weight: 700; display: flex; align-items: center; gap: 6px;">
      🛒 레시피 재료 한 번에 담기
    </h3>
    <p style="color: #718096; font-size: 0.88rem; margin-bottom: 16px; line-height: 1.4;">아래 목록에서 원하는 식재료를 선택하고 수량을 맞춰 장바구니에 한 번에 담아 간편하게 쇼핑하세요!</p>
    
    <div class="recipe-products-list" style="display: flex; flex-direction: column;">
      ${productsCardsHtml || '<div style="text-align: center; color: #a0aec0; padding: 20px;">추천된 상품이 없습니다.</div>'}
    </div>
    
    ${productsCardsHtml ? `
    <button type="button" id="recipe-add-all-btn" style="margin-top: 20px; width: 100%; padding: 14px; background-color: #ff4a5a; color: #ffffff; border: none; border-radius: 6px; font-size: 1.05rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s; box-shadow: 0 4px 6px rgba(255, 74, 90, 0.2);">
      <span>🛒 선택한 제품 장바구니 담기</span>
    </button>
    ` : ""}
  </div>
  
  <script>
    (function() {
      const btn = document.getElementById('recipe-add-all-btn');
      if (!btn) return;
      btn.addEventListener('click', function() {
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.style.backgroundColor = '#a0aec0';
        btn.style.boxShadow = 'none';
        btn.innerHTML = '<span>⏳ 장바구니에 담는 중...</span>';
        
        const items = [];
        const cards = document.querySelectorAll('.recipe-product-card');
        cards.forEach(card => {
          const checkbox = card.querySelector('.recipe-prod-checkbox');
          const qtyInput = card.querySelector('.recipe-prod-qty');
          if (checkbox && checkbox.checked && qtyInput) {
            const variantId = checkbox.getAttribute('data-variant-id');
            const numericId = variantId.replace('gid://shopify/ProductVariant/', '');
            const quantity = parseInt(qtyInput.value) || 1;
            items.push({ id: numericId, quantity: quantity });
          }
        });
        
        if (items.length === 0) {
          alert('선택된 상품이 없습니다. 최소 1개 이상의 상품을 선택해주세요.');
          btn.disabled = false;
          btn.style.backgroundColor = '#ff4a5a';
          btn.style.boxShadow = '0 4px 6px rgba(255, 74, 90, 0.2)';
          btn.innerHTML = originalText;
          return;
        }
        
        fetch('/cart/add.js', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify({ items: items })
        })
        .then(response => {
          if (!response.ok) {
            throw new Error('Network response was not ok');
          }
          return response.json();
        })
        .then(data => {
          btn.innerHTML = '<span>✅ 완료! 장바구니로 이동합니다...</span>';
          btn.style.backgroundColor = '#48bb78';
          setTimeout(() => {
            window.location.href = '/cart';
          }, 800);
        })
        .catch(error => {
          console.error('Error adding to cart:', error);
          alert('장바구니 담기 도중 오류가 발생했습니다. 다시 시도해주세요.');
          btn.disabled = false;
          btn.style.backgroundColor = '#ff4a5a';
          btn.style.boxShadow = '0 4px 6px rgba(255, 74, 90, 0.2)';
          btn.innerHTML = originalText;
        });
      });
    })();
  </script>
</div>
  `;
}

// --- FRONTEND COMPONENT ---
export default function RecipeBlogs() {
  const { recipes, blogs, shopUrl } = useLoaderData();
  const fetcher = useFetcher();
  const submit = useSubmit();
  const navigation = useNavigation();

  // Selected recipe state for edit or detail views
  const [selectedRecipe, setSelectedRecipe] = useState(null);

  // Form input states
  const [title, setTitle] = useState("");
  const [introduction, setIntroduction] = useState("");
  const [steps, setSteps] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [shopifyBlogId, setShopifyBlogId] = useState("");
  const [selectedProducts, setSelectedProducts] = useState([]);

  // Product search state
  const [productQuery, setProductQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Status banner/alert message
  const [toastMessage, setToastMessage] = useState(null);

  const isSaving = navigation.state === "submitting" && navigation.formData.get("intent") === "save";
  const isPublishing = navigation.state === "submitting" && navigation.formData.get("intent") === "publish";

  // Watch product search fetcher results
  useEffect(() => {
    if (fetcher.data && fetcher.data.products) {
      setSearchResults(fetcher.data.products);
      setSearchLoading(false);
    }
  }, [fetcher.data]);

  // Load recipe values into fields when editing
  const handleEditRecipe = (recipe) => {
    setSelectedRecipe(recipe);
    setTitle(recipe.title);
    setIntroduction(recipe.introduction);
    setSteps(recipe.steps);
    setImageUrl(recipe.imageUrl || "");
    setShopifyBlogId(recipe.shopifyBlogId || (blogs[0]?.id || ""));

    // Format local products to editor state
    setSelectedProducts(recipe.products.map(p => ({
      productId: p.productId,
      variantId: p.variantId,
      title: p.title,
      variantTitle: p.variantTitle,
      price: p.price,
      imageUrl: p.imageUrl,
      defaultQty: 1
    })));
  };

  // Set preset templates
  const handleApplyPreset = (key) => {
    const preset = RECIPE_PRESETS[key];
    if (preset) {
      setTitle(preset.title);
      setImageUrl(preset.imageUrl);
      setIntroduction(preset.introduction);
      setSteps(preset.steps);
      if (blogs.length > 0 && !shopifyBlogId) {
        setShopifyBlogId(blogs[0].id);
      }
      setToastMessage({
        type: "success",
        title: `프리셋 적용 완료`,
        content: `한국 음식 [${key === 'tteokbokki' ? '떡볶이' : key === 'kimchijjigae' ? '김치찌개' : key === 'bulgogi' ? '불고기' : '비빔밥'}] 내용이 입력창에 자동 완성되었습니다.`
      });
    }
  };

  // Clear editor state to compose fresh recipe
  const handleNewRecipe = () => {
    setSelectedRecipe(null);
    setTitle("");
    setIntroduction("");
    setSteps("");
    setImageUrl("");
    setShopifyBlogId(blogs[0]?.id || "");
    setSelectedProducts([]);
    setSearchResults([]);
    setProductQuery("");
  };

  // Trigger Shopify product search
  const handleProductSearch = () => {
    if (!productQuery.trim()) return;
    setSearchLoading(true);
    fetcher.load(`/app/recipe-blogs?searchProducts=${encodeURIComponent(productQuery)}`);
  };

  // Add search product variant to the recipe binding
  const handleAddProduct = (product, variant) => {
    const exists = selectedProducts.find(p => p.variantId === variant.id);
    if (exists) return;

    setSelectedProducts([...selectedProducts, {
      productId: product.id,
      variantId: variant.id,
      title: product.title,
      variantTitle: variant.title !== "Default Title" ? variant.title : "",
      price: variant.price,
      imageUrl: variant.image?.url || product.featuredImage?.url || "",
      defaultQty: 1
    }]);
  };

  // Remove paired product
  const handleRemoveProduct = (variantId) => {
    setSelectedProducts(selectedProducts.filter(p => p.variantId !== variantId));
  };

  // Submit action (Save draft or Publish)
  const handleSubmitForm = (intent) => {
    if (!title.trim() || !introduction.trim() || !steps.trim()) {
      alert("제목, 소개말, 요리법을 입력해 주세요.");
      return;
    }

    if (intent === "publish" && !shopifyBlogId) {
      alert("글을 동기화하여 출시할 쇼피파이 블로그 채널을 선택해주세요.");
      return;
    }

    const formData = new FormData();
    formData.append("intent", intent);
    if (selectedRecipe) {
      formData.append("id", selectedRecipe.id);
    }
    formData.append("title", title);
    formData.append("introduction", introduction);
    formData.append("steps", steps);
    formData.append("imageUrl", imageUrl);
    formData.append("shopifyBlogId", shopifyBlogId);
    formData.append("productsJson", JSON.stringify(selectedProducts));

    submit(formData, { method: "post" });

    setToastMessage({
      type: "info",
      title: intent === "publish" ? "쇼피파이 전송 중" : "저장 중",
      content: intent === "publish" ? "쇼피파이에 글을 등록하고 위젯을 생성하고 있습니다..." : "데이터베이스에 레시피 임시 초안을 저장 중입니다..."
    });
  };

  // Handle recipe deletion
  const handleDeleteRecipe = (id) => {
    if (confirm("정말로 이 레시피를 삭제하시겠습니까? 쇼피파이에 연동된 글도 함께 삭제됩니다.")) {
      const formData = new FormData();
      formData.append("intent", "delete");
      formData.append("id", id);
      submit(formData, { method: "post" });
      handleNewRecipe();
    }
  };

  return (
    <Page title="🍳 한국 음식 레시피 블로거 & 간편 장바구니 빌더">
      <BlockStack gap="400">

        {/* Intro banner */}
        <Banner tone="info">
          <Text as="p" variant="bodyMd">
            한국 음식(K-Food)을 소개하는 블로그 글을 손쉽게 작성하고, 요리에 필요한 우리 매장의 재료 제품들을 선택하여 묶음으로 매칭해 보세요.
            쇼피파이에 글을 올리면 고객이 클릭 한 번으로 모든 재료를 장바구니에 담을 수 있는 <strong>"장바구니 묶음 위젯"</strong>이 블로그 본문 내에 자동으로 빌드됩니다!
          </Text>
        </Banner>

        {toastMessage && (
          <Banner
            title={toastMessage.title}
            tone={toastMessage.type === "success" ? "success" : "info"}
            onDismiss={() => setToastMessage(null)}
          >
            <p>{toastMessage.content}</p>
          </Banner>
        )}

        <Layout>

          {/* Left panel: Recipe database list */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">📋 나의 레시피 목록</Text>
                  <Button size="slim" variant="primary" onClick={handleNewRecipe}>✨ 새 레시피</Button>
                </InlineStack>

                <Divider />

                {recipes.length === 0 ? (
                  <Box padding="400" textAlign="center">
                    <Text as="p" tone="subdued">작성된 레시피가 없습니다.<br />새 글을 추가하거나 프리셋을 적용해 보세요!</Text>
                  </Box>
                ) : (
                  <BlockStack gap="200">
                    {recipes.map((recipe) => (
                      <Box
                        key={recipe.id}
                        padding="300"
                        background={selectedRecipe?.id === recipe.id ? "bg-surface-secondary-active" : "bg-surface-secondary"}
                        borderRadius="200"
                        style={{ cursor: "pointer", border: selectedRecipe?.id === recipe.id ? "1px solid #008060" : "1px solid #e1e3e5" }}
                        onClick={() => handleEditRecipe(recipe)}
                      >
                        <BlockStack gap="100">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="h3" variant="headingSm" style={{ wordBreak: "break-all" }}>{recipe.title}</Text>
                            {recipe.published ? (
                              <Badge tone="success">게시됨</Badge>
                            ) : (
                              <Badge tone="warning">임시 저장</Badge>
                            )}
                          </InlineStack>

                          <Text as="p" variant="bodyXs" tone="subdued">
                            재료 {recipe.products?.length || 0}개 매칭됨
                          </Text>

                          <InlineStack align="end" gap="200">
                            {recipe.published && recipe.shopifyArticleId && (
                              <Button
                                size="micro"
                                variant="tertiary"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Open published blog article in new tab
                                  window.open(`${shopUrl}/blogs/news/${recipe.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, "_blank");
                                }}
                              >
                                🔗 상점 보기
                              </Button>
                            )}
                            <Button
                              size="micro"
                              tone="critical"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteRecipe(recipe.id);
                              }}
                            >
                              🗑️ 삭제
                            </Button>
                          </InlineStack>
                        </BlockStack>
                      </Box>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Right panel: Editor and product bundler */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">
                  {selectedRecipe ? `📝 레시피 편집: ${selectedRecipe.title}` : "✍️ 새 레시피 작성"}
                </Text>

                {/* Pre-population presets */}
                {!selectedRecipe && (
                  <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingXs" tone="subdued">⚡ 빠른 시작 프리셋 (K-Food 대표 레시피 자동입력)</Text>
                      <InlineStack gap="200">
                        <Button onClick={() => handleApplyPreset("tteokbokki")}>🌶️ 떡볶이</Button>
                        <Button onClick={() => handleApplyPreset("kimchijjigae")}>🍲 김치찌개</Button>
                        <Button onClick={() => handleApplyPreset("bulgogi")}>🥩 소불고기</Button>
                        <Button onClick={() => handleApplyPreset("bibimbap")}>🥗 비빔밥</Button>
                      </InlineStack>
                    </BlockStack>
                  </Box>
                )}

                <Divider />

                {/* Main Fields Form */}
                <BlockStack gap="300">
                  <TextField
                    label="레시피 글 제목"
                    value={title}
                    onChange={setTitle}
                    placeholder="예: 집에서도 실패 없는 백종원식 떡볶이 황금 레시피"
                    autoComplete="off"
                    maxLength={100}
                  />

                  <TextField
                    label="음식 소개 (한국 음식 홍보 내용)"
                    value={introduction}
                    onChange={setIntroduction}
                    placeholder="이 한국 요리의 역사나 맛의 특징, 세계적 인기 비결 등을 재미있게 소개해 보세요."
                    multiline={4}
                    autoComplete="off"
                  />

                  <TextField
                    label="조리 순서 (Recipe Steps - 1줄에 1단계씩 작성하세요)"
                    value={steps}
                    onChange={setSteps}
                    placeholder="1. 떡을 물에 불립니다.&#10;2. 소스를 끓입니다.&#10;3. 재료들을 다 넣고 졸입니다."
                    multiline={6}
                    autoComplete="off"
                  />

                  <TextField
                    label="레시피 대표 이미지 URL (Optional)"
                    value={imageUrl}
                    onChange={setImageUrl}
                    placeholder="https://example.com/food-image.jpg (Unsplash 등의 이미지 주소를 사용해 보세요)"
                    autoComplete="off"
                  />
                  {imageUrl && (
                    <Box maxWidth="180px" padding="100" style={{ border: "1px solid #e1e3e5", borderRadius: "4px" }}>
                      <img src={imageUrl} alt="미리보기" style={{ width: "100%", height: "100px", objectFit: "cover" }} />
                    </Box>
                  )}
                </BlockStack>

                <Divider />

                {/* Ingredients / Products Bundling section */}
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">🛒 레시피 식재료 / 판매 상품 매칭</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    이 레시피를 읽은 독자에게 구매를 제안할 내 상점의 제품들을 연결하세요.
                  </Text>

                  {/* Bound products list */}
                  {selectedProducts.length > 0 ? (
                    <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                      <BlockStack gap="200">
                        {selectedProducts.map((p, idx) => (
                          <InlineStack key={p.variantId || idx} align="space-between" blockAlign="center" gap="200">
                            <InlineStack gap="300" blockAlign="center">
                              {p.imageUrl ? (
                                <img src={p.imageUrl} alt={p.title} style={{ width: "40px", height: "40px", objectFit: "cover", borderRadius: "4px" }} />
                              ) : (
                                <Box width="40px" height="40px" background="bg-surface-secondary" borderRadius="200" />
                              )}
                              <div>
                                <Text as="span" variant="bodyMd" fontWeight="semibold">{p.title}</Text>
                                {p.variantTitle && <Text as="p" variant="bodyXs" tone="subdued">옵션: {p.variantTitle}</Text>}
                                <Text as="p" variant="bodySm" tone="critical" fontWeight="bold">
                                  {p.price ? `${parseFloat(p.price).toLocaleString()}원` : "가격 미정"}
                                </Text>
                              </div>
                            </InlineStack>
                            <Button size="slim" tone="critical" onClick={() => handleRemoveProduct(p.variantId)}>제거</Button>
                          </InlineStack>
                        ))}
                      </BlockStack>
                    </Box>
                  ) : (
                    <Banner tone="warning">매칭된 추천 상품이 없습니다. 아래 검색을 통해 식재료 상품을 바인딩해 주세요.</Banner>
                  )}

                  {/* Shopify Products Search Input */}
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <BlockStack gap="300">
                      <Text as="h4" variant="headingXs">🔍 우리 쇼피파이 매장 상품 검색</Text>
                      <InlineStack gap="200">
                        <div style={{ flexGrow: 1 }}>
                          <TextField
                            value={productQuery}
                            onChange={setProductQuery}
                            placeholder="상품명 입력 (예: 고추장, 떡볶이 떡, 소고기...)"
                            autoComplete="off"
                            onKeyPress={(e) => {
                              if (e.key === "Enter") handleProductSearch();
                            }}
                          />
                        </div>
                        <Button onClick={handleProductSearch} loading={searchLoading}>검색</Button>
                      </InlineStack>

                      {/* Search Results list */}
                      {searchResults.length > 0 && (
                        <Box padding="200" background="bg-surface" borderRadius="200" style={{ maxHeight: "250px", overflowY: "auto" }}>
                          <BlockStack gap="300">
                            {searchResults.map((product) => (
                              <Box key={product.id} padding="200" style={{ borderBottom: "1px solid #e1e3e5" }}>
                                <BlockStack gap="100">
                                  <Text as="h5" variant="bodyMd" fontWeight="bold">{product.title}</Text>

                                  {/* List variants */}
                                  <BlockStack gap="100">
                                    {product.variants.nodes.map((v) => (
                                      <InlineStack key={v.id} align="space-between" blockAlign="center">
                                        <Text as="span" variant="bodySm" tone="subdued">
                                          - {v.title !== "Default Title" ? v.title : "기본 옵션"} ({parseFloat(v.price).toLocaleString()}원)
                                        </Text>
                                        <Button
                                          size="slim"
                                          onClick={() => handleAddProduct(product, v)}
                                          disabled={selectedProducts.some(sp => sp.variantId === v.id)}
                                        >
                                          {selectedProducts.some(sp => sp.variantId === v.id) ? "추가됨" : "➕ 레시피에 추가"}
                                        </Button>
                                      </InlineStack>
                                    ))}
                                  </BlockStack>
                                </BlockStack>
                              </Box>
                            ))}
                          </BlockStack>
                        </Box>
                      )}
                    </BlockStack>
                  </Box>
                </BlockStack>

                <Divider />

                {/* Shopify Blog Target and Publishing buttons */}
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">🚀 쇼피파이 상점 출시 설정</Text>

                  {blogs.length === 0 ? (
                    <Banner tone="critical">
                      상점에 블로그 채널(예: 뉴스)이 정의되지 않았습니다. 쇼피파이 어드민에서 먼저 블로그 채널을 생성해 주세요.
                    </Banner>
                  ) : (
                    <Select
                      label="게시할 상점 블로그 채널 선택"
                      options={blogs.map(b => ({ label: b.title, value: b.id }))}
                      value={shopifyBlogId}
                      onChange={setShopifyBlogId}
                    />
                  )}

                  <InlineStack align="space-between" blockAlign="center" gap="400">
                    <InlineStack gap="200">
                      <Button onClick={handleNewRecipe}>🧹 입력 필드 초기화</Button>
                    </InlineStack>

                    <InlineStack gap="200">
                      <Button
                        onClick={() => handleSubmitForm("save")}
                        loading={isSaving}
                      >
                        💾 초안 임시저장 (App DB)
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => handleSubmitForm("publish")}
                        loading={isPublishing}
                        disabled={blogs.length === 0}
                      >
                        🚀 쇼피파이 블로그 게시 / 동기화
                      </Button>
                    </InlineStack>
                  </InlineStack>
                </BlockStack>

              </BlockStack>
            </Card>
          </Layout.Section>

        </Layout>
      </BlockStack>
    </Page>
  );
}
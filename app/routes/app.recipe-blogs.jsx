import { useState, useEffect, useRef } from "react";
import { useLoaderData, useFetcher } from "react-router";
import {
  Page,
  Layout,
  Card,
  Button,
  Select,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Banner,
  Box,
  Divider,
  TextField,
  Modal,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import RecipeDashboardHeader from "../components/recipe/RecipeDashboardHeader";
import RecipePresetModal from "../components/recipe/RecipePresetModal";
import RecipeLocalizationEditor from "../components/recipe/RecipeLocalizationEditor";
import RecipeMetadataSettings from "../components/recipe/RecipeMetadataSettings";
import RecipeIngredientsCommerce from "../components/recipe/RecipeIngredientsCommerce";
import RecipeStorefrontPreviewModal from "../components/recipe/RecipeStorefrontPreviewModal";
import { unpackRecipe } from "../utils/recipeData.js";
import { handleRecipeAction } from "../utils/recipePersistence.server.js";
export { unpackRecipe } from "../utils/recipeData.js";

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
        products(first: 12, query: $query) {
          nodes {
            id
            title
            vendor
            productType
            tags
            featuredImage {
              url
            }
            variants(first: 10) {
              nodes {
                id
                title
                price
                availableForSale
                sku
                image {
                  url
                }
              }
            }
          }
        }
      }`,
      { variables: { query: `title:*${searchProducts}* OR tag:*${searchProducts}*` } }
    );
    const json = await response.json();
    const products = json.data?.products?.nodes || [];
    return Response.json({ products });
  }

  // Fetch local recipes with products
  const rawRecipes = await prisma.recipe.findMany({
    where: { shop },
    include: { products: true },
    orderBy: { createdAt: "desc" },
  });

  const recipes = rawRecipes.map(unpackRecipe);

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
  return handleRecipeAction({ form: await request.formData(), shop: session.shop, admin, db: prisma });
}

// --- MAIN FRONTEND COMPONENT ---
export default function RecipeBlogs() {
  const { recipes, blogs, shopUrl } = useLoaderData();
  const fetcher = useFetcher();
  const actionFetcher = useFetcher();
  const submissionLock = useRef(false);
  const draftId = useRef(null);
  const handledActionResult = useRef(null);
  const submittedProducts = useRef(null);

  // Modals state
  const [presetModalOpen, setPresetModalOpen] = useState(false);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [deleteRecipeId, setDeleteRecipeId] = useState(null);

  // Selected recipe state
  const [selectedRecipe, setSelectedRecipe] = useState(null);
  const [listSearchQuery, setListSearchQuery] = useState("");

  // Editor Form States
  const [category, setCategory] = useState("STREET_FOOD");
  const [occasion, setOccasion] = useState("QUICK_MEAL");
  const [difficulty, setDifficulty] = useState("EASY");
  const [prepTimeMinutes, setPrepTimeMinutes] = useState(10);
  const [cookTimeMinutes, setCookTimeMinutes] = useState(15);
  const [servings, setServings] = useState(2);
  const [spiceLevel, setSpiceLevel] = useState(2);
  const [dietaryFlags, setDietaryFlags] = useState([]);
  const [imageUrl, setImageUrl] = useState("");
  const [shopifyBlogId, setShopifyBlogId] = useState(blogs[0]?.id || "");

  // Translations
  const [translations, setTranslations] = useState({
    ko: { title: "", subtitle: "", introduction: "", steps: "" },
    de: { title: "", subtitle: "", introduction: "", steps: "" },
    en: { title: "", subtitle: "", introduction: "", steps: "" },
  });

  // Ingredients and Commerce Products
  const [ingredients, setIngredients] = useState([]);
  const [selectedProducts, setSelectedProducts] = useState([]);

  // Product live search state
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Feedback banner
  const [toastMessage, setToastMessage] = useState(null);

  const isSaving = actionFetcher.state !== "idle" && actionFetcher.formData?.get("intent") === "save";
  const isPublishing = actionFetcher.state !== "idle" && actionFetcher.formData?.get("intent") === "publish";

  // Watch product search fetcher results
  useEffect(() => {
    if (fetcher.data && fetcher.data.products) {
      setSearchResults(fetcher.data.products);
      setSearchLoading(false);
    }
  }, [fetcher.data]);

  useEffect(() => {
    if (actionFetcher.state !== "idle") return;
    submissionLock.current = false;
    const result = actionFetcher.data;
    if (!result || handledActionResult.current === result) return;
    handledActionResult.current = result;
    if (result.recipe) {
      setSelectedRecipe(result.recipe);
      // Keep edits made while the save request was in flight.
      setSelectedProducts(current => current === submittedProducts.current ? (result.recipe.products || []) : current);
      draftId.current = result.recipe.id;
    }
    if (result.success && result.deletedId && result.deletedId === selectedRecipe?.id) {
      setSelectedRecipe(null);
      draftId.current = null;
      setTranslations(Object.fromEntries(["ko", "de", "en"].map(locale => [locale, { title: "", subtitle: "", introduction: "", steps: "" }])));
      setSelectedProducts([]);
      setIngredients([]);
    }
    setToastMessage({ type: result.success ? "success" : "critical", title: result.success ? "처리 완료" : "처리 실패", content: result.error || result.message || "레시피가 저장되었습니다." });
  }, [actionFetcher.state, actionFetcher.data, selectedRecipe?.id]);

  // Load recipe into editor
  const handleEditRecipe = (recipe) => {
    if (submissionLock.current) return;
    draftId.current = recipe.id;
    setSelectedRecipe(recipe);
    setCategory(recipe.category || "STREET_FOOD");
    setOccasion(recipe.occasion || "QUICK_MEAL");
    setDifficulty(recipe.difficulty || "EASY");
    setPrepTimeMinutes(recipe.prepTimeMinutes || 10);
    setCookTimeMinutes(recipe.cookTimeMinutes || 15);
    setServings(recipe.servings || 2);
    setSpiceLevel(recipe.spiceLevel ?? 2);
    setImageUrl(recipe.imageUrl || "");
    setShopifyBlogId(recipe.shopifyBlogId || (blogs[0]?.id || ""));

    // Defensive parsing for translations
    let parsedTranslations = recipe.translations;
    if (typeof parsedTranslations === "string") {
      try {
        parsedTranslations = JSON.parse(parsedTranslations);
      } catch {
        parsedTranslations = null;
      }
    }
    if (parsedTranslations && typeof parsedTranslations === "object") {
      setTranslations({
        ko: parsedTranslations.ko || { title: recipe.title || "", subtitle: "", introduction: recipe.introduction || "", steps: recipe.steps || "" },
        de: parsedTranslations.de || { title: recipe.title || "", subtitle: "", introduction: recipe.introduction || "", steps: recipe.steps || "" },
        en: parsedTranslations.en || { title: recipe.title || "", subtitle: "", introduction: recipe.introduction || "", steps: recipe.steps || "" },
      });
    } else {
      setTranslations({
        ko: { title: recipe.title || "", subtitle: "", introduction: recipe.introduction || "", steps: recipe.steps || "" },
        de: { title: recipe.title || "", subtitle: "", introduction: recipe.introduction || "", steps: recipe.steps || "" },
        en: { title: recipe.title || "", subtitle: "", introduction: recipe.introduction || "", steps: recipe.steps || "" },
      });
    }

    // Defensive parsing for ingredients
    let parsedIngredients = recipe.ingredientsJson;
    if (typeof parsedIngredients === "string") {
      try {
        parsedIngredients = JSON.parse(parsedIngredients);
      } catch {
        parsedIngredients = [];
      }
    }
    setIngredients(Array.isArray(parsedIngredients) ? parsedIngredients : []);

    // Defensive parsing for dietary flags
    let parsedFlags = recipe.dietaryFlags;
    if (typeof parsedFlags === "string") {
      try {
        parsedFlags = JSON.parse(parsedFlags);
      } catch {
        parsedFlags = [];
      }
    }
    setDietaryFlags(Array.isArray(parsedFlags) ? parsedFlags : []);

    setSelectedProducts(Array.isArray(recipe.products) ? recipe.products : []);
  };

  // Reset editor for new recipe
  const handleNewRecipe = () => {
    if (submissionLock.current) return;
    draftId.current = null;
    setSelectedRecipe(null);
    setCategory("STREET_FOOD");
    setOccasion("QUICK_MEAL");
    setDifficulty("EASY");
    setPrepTimeMinutes(10);
    setCookTimeMinutes(15);
    setServings(2);
    setSpiceLevel(2);
    setDietaryFlags([]);
    setImageUrl("");
    setShopifyBlogId(blogs[0]?.id || "");
    setTranslations({
      ko: { title: "", subtitle: "", introduction: "", steps: "" },
      de: { title: "", subtitle: "", introduction: "", steps: "" },
      en: { title: "", subtitle: "", introduction: "", steps: "" },
    });
    setIngredients([]);
    setSelectedProducts([]);
    setSearchResults([]);
  };

  // Apply Preset
  const handleSelectPreset = (preset) => {
    if (submissionLock.current) return;
    draftId.current = null;
    setSelectedProducts([]);
    setSelectedRecipe(null);
    setCategory(preset.category);
    setOccasion(preset.occasion);
    setDifficulty(preset.difficulty);
    setPrepTimeMinutes(preset.prepTimeMinutes);
    setCookTimeMinutes(preset.cookTimeMinutes);
    setServings(preset.baseServings);
    setSpiceLevel(preset.spiceLevel);
    setDietaryFlags(preset.dietaryFlags || []);
    setImageUrl(preset.imageUrl || "");
    setShopifyBlogId(blogs[0]?.id || "");
    setTranslations(preset.translations || {
      ko: { title: "", subtitle: "", introduction: "", steps: "" },
      de: { title: "", subtitle: "", introduction: "", steps: "" },
      en: { title: "", subtitle: "", introduction: "", steps: "" },
    });
    setIngredients(preset.defaultIngredients || []);

    setToastMessage({
      type: "success",
      title: "프리셋 적용 완료",
      content: `[${preset.translations?.ko?.title || preset.translations?.de?.title || ""}] 프리셋의 다국어 텍스트 및 기본 식재료가 로드되었습니다. 이제 상점 상품을 매칭해 주세요.`,
    });
  };

  // Search shopify products
  const handleSearchProducts = (query) => {
    setSearchLoading(true);
    fetcher.load(`/app/recipe-blogs?searchProducts=${encodeURIComponent(query)}`);
  };

  // Submit action (Save or Publish)
  const handleSubmitForm = (intent) => {
    if (submissionLock.current || actionFetcher.state !== "idle") return;
    const mainTitle = translations.de?.title || translations.ko?.title || translations.en?.title;
    if (!mainTitle) {
      setToastMessage({ type: "critical", content: "레시피 제목(독일어 또는 한국어)을 입력해 주세요." });
      return;
    }

    if (intent === "publish" && !shopifyBlogId) {
      setToastMessage({ type: "critical", content: "게시할 쇼피파이 블로그 채널을 선택해 주세요." });
      return;
    }

    const formData = new FormData();
    formData.append("intent", intent);
    draftId.current ||= crypto.randomUUID();
    formData.append("draftId", draftId.current);
    if (selectedRecipe) {
      formData.append("id", selectedRecipe.id);
    }
    formData.append("title", mainTitle);
    formData.append("category", category);
    formData.append("occasion", occasion);
    formData.append("difficulty", difficulty);
    formData.append("prepTimeMinutes", String(prepTimeMinutes));
    formData.append("cookTimeMinutes", String(cookTimeMinutes));
    formData.append("servings", String(servings));
    formData.append("spiceLevel", String(spiceLevel));
    formData.append("imageUrl", imageUrl);
    formData.append("shopifyBlogId", shopifyBlogId);
    formData.append("dietaryFlags", JSON.stringify(dietaryFlags));
    formData.append("translations", JSON.stringify(translations));
    formData.append("ingredientsJson", JSON.stringify(ingredients));
    formData.append("productsJson", JSON.stringify(selectedProducts));

    submittedProducts.current = selectedProducts;
    submissionLock.current = true;
    actionFetcher.submit(formData, { method: "post" });

    setToastMessage({
      type: "info",
      title: intent === "publish" ? "쇼피파이 전송 중" : "저장 중",
      content:
        intent === "publish"
          ? "쇼피파이에 인터랙티브 커머스 위젯을 포함한 블로그 글을 발행/동기화하고 있습니다..."
          : "데이터베이스에 레시피 초안을 안전하게 저장 중입니다...",
    });
  };

  const handleDeleteRecipe = id => {
    if (!submissionLock.current) setDeleteRecipeId(id);
  };
  const confirmDeleteRecipe = () => {
    if (!deleteRecipeId || submissionLock.current) return;
    const formData = new FormData();
    formData.set("intent", "delete");
    formData.set("id", deleteRecipeId);
    submissionLock.current = true;
    actionFetcher.submit(formData, { method: "post" });
    setDeleteRecipeId(null);
  };

  // Filtered recipe list
  const filteredRecipes = recipes.filter((r) => {
    if (!listSearchQuery.trim()) return true;
    const q = listSearchQuery.toLowerCase();
    return (r.title && r.title.toLowerCase().includes(q)) || (r.category && r.category.toLowerCase().includes(q));
  });

  // Current draft object for preview modal
  const previewRecipeObject = {
    id: selectedRecipe?.id || "preview_recipe_id",
    title: translations.de?.title || translations.ko?.title || translations.en?.title || "레시피 제목",
    introduction: translations.de?.introduction || translations.ko?.introduction || "",
    steps: translations.de?.steps || translations.ko?.steps || "",
    imageUrl,
    category,
    prepTimeMinutes,
    cookTimeMinutes,
    servings,
    spiceLevel,
    dietaryFlags,
    translations,
    ingredientsJson: ingredients,
    products: selectedProducts,
  };

  return (
    <Page
      title="K-Food 레시피 커머스 플랫폼 (Recipe Commerce Platform)"
      subtitle="유럽/독일 고객을 위한 레시피 콘텐츠 및 원클릭 식재료 번들 쇼핑 자동화"
      primaryAction={{
        content: "K-Food 프리셋 라이브러리 열기",
        onAction: () => setPresetModalOpen(true),
      }}
    >
      <BlockStack gap="500">
        
        {/* KPI Metrics Dashboard Header */}
        <RecipeDashboardHeader recipes={recipes} />

        {toastMessage && (
          <Banner
            title={toastMessage.title}
            tone={toastMessage.type || "info"}
            onDismiss={() => setToastMessage(null)}
          >
            <p>{toastMessage.content}</p>
          </Banner>
        )}

        <Layout>
          {/* Left Column: Recipe List with filter */}
          <Layout.Section variant="oneThird">
            <Card padding="400">
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">나의 레시피 목록</Text>
                  <Button size="slim" variant="primary" onClick={handleNewRecipe}>+ 새 레시피</Button>
                </InlineStack>

                <TextField
                  label="레시피 검색"
                  labelHidden
                  value={listSearchQuery}
                  onChange={setListSearchQuery}
                  placeholder="제목 / 카테고리 검색"
                  autoComplete="off"
                  clearButton
                  onClearButtonClick={() => setListSearchQuery("")}
                />

                <Divider />

                {filteredRecipes.length === 0 ? (
                  <Box padding="400" textAlign="center">
                    <Text as="p" tone="subdued">
                      작성된 레시피가 없습니다.<br />새 글을 작성하거나 상단 프리셋을 적용해 보세요!
                    </Text>
                  </Box>
                ) : (
                  <div style={{ maxHeight: "640px", overflowY: "auto" }}>
                    <BlockStack gap="200">
                      {filteredRecipes.map((recipe) => {
                        const isSelected = selectedRecipe?.id === recipe.id;
                        const prodCount = recipe.products?.length || 0;
                        const hasOutOfStock = recipe.products?.some((p) => p.isAvailable === false);

                        return (
                          <Box
                            key={recipe.id}
                            padding="300"
                            background={isSelected ? "bg-surface-secondary-active" : "bg-surface-secondary"}
                            borderRadius="200"
                            style={{
                              cursor: "pointer",
                              border: isSelected ? "2px solid #008060" : "1px solid #e1e3e5",
                            }}
                            onClick={() => handleEditRecipe(recipe)}
                          >
                            <BlockStack gap="100">
                              <InlineStack align="space-between" blockAlign="center">
                                <Text as="h3" variant="headingSm" fontWeight="bold" style={{ wordBreak: "break-all" }}>
                                  {recipe.title}
                                </Text>
                                {recipe.published ? (
                                  <Badge tone="success">게시됨</Badge>
                                ) : (
                                  <Badge tone="warning">임시 저장</Badge>
                                )}
                              </InlineStack>

                              <InlineStack gap="200" blockAlign="center">
                                <Badge tone="info">{recipe.category || "STREET_FOOD"}</Badge>
                                <Text as="span" variant="bodyXs" tone="subdued">
                                  재료 {prodCount}개
                                </Text>
                                {hasOutOfStock && <Badge tone="critical">품절 있음</Badge>}
                              </InlineStack>

                              <InlineStack align="end" gap="200" style={{ marginTop: "4px" }}>
                                {recipe.published && recipe.articlePath && (
                                  <Button
                                    size="micro"
                                    variant="tertiary"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (recipe.articlePath) window.open(new URL(recipe.articlePath, shopUrl).href, "_blank", "noopener,noreferrer");
                                    }}
                                  >
                                    상점 보기
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
                                  삭제
                                </Button>
                              </InlineStack>
                            </BlockStack>
                          </Box>
                        );
                      })}
                    </BlockStack>
                  </div>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Right Column: Recipe Editor & Commerce Bundler */}
          <Layout.Section>
            <BlockStack gap="400">
              
              {/* Editor Top Bar Actions */}
              <Card padding="300">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      {selectedRecipe ? `편집 중: ${selectedRecipe.title}` : "새 레시피 작성"}
                    </Text>
                    {selectedRecipe?.published && <Badge tone="success">Shopify 라이브 연동</Badge>}
                  </InlineStack>

                  <InlineStack gap="200">
                    <Button onClick={() => setPreviewModalOpen(true)}>
                      스토어프론트 실시간 프리뷰
                    </Button>
                    <Button onClick={() => setPresetModalOpen(true)}>
                      프리셋 불러오기
                    </Button>
                  </InlineStack>
                </InlineStack>
              </Card>

              {/* 1. Multilingual Content Editor (KO / DE / EN) */}
              <RecipeLocalizationEditor
                translations={translations}
                onChangeTranslations={setTranslations}
              />

              {/* 2. Metadata & Attribute Settings */}
              <RecipeMetadataSettings
                category={category}
                onChangeCategory={setCategory}
                occasion={occasion}
                onChangeOccasion={setOccasion}
                difficulty={difficulty}
                onChangeDifficulty={setDifficulty}
                prepTimeMinutes={prepTimeMinutes}
                onChangePrepTime={setPrepTimeMinutes}
                cookTimeMinutes={cookTimeMinutes}
                onChangeCookTime={setCookTimeMinutes}
                servings={servings}
                onChangeServings={setServings}
                spiceLevel={spiceLevel}
                onChangeSpiceLevel={setSpiceLevel}
                dietaryFlags={dietaryFlags}
                onChangeDietaryFlags={setDietaryFlags}
                imageUrl={imageUrl}
                onChangeImageUrl={setImageUrl}
              />

              {/* 3. Ingredients & Commerce Matching */}
              <RecipeIngredientsCommerce
                ingredients={ingredients}
                onChangeIngredients={setIngredients}
                selectedProducts={selectedProducts}
                onChangeProducts={setSelectedProducts}
                onSearchShopifyProducts={handleSearchProducts}
                searchResults={searchResults}
                searchLoading={searchLoading}
              />

              {/* 4. Publishing & Save Bar */}
              <Card padding="400">
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">쇼피파이 상점 출시 & 동기화 설정</Text>

                  {blogs.length === 0 ? (
                    <Banner tone="critical">
                      상점에 블로그 채널(예: News / Recipes)이 없습니다. 쇼피파이 어드민에서 블로그를 먼저 생성해 주세요.
                    </Banner>
                  ) : (
                    <Select
                      label="게시할 상점 블로그 채널 선택"
                      options={blogs.map((b) => ({ label: b.title, value: b.id }))}
                      value={shopifyBlogId}
                      onChange={setShopifyBlogId}
                    />
                  )}

                  <InlineStack align="space-between" blockAlign="center">
                    <Button onClick={handleNewRecipe}>입력 필드 초기화</Button>

                    <InlineStack gap="200">
                      <Button onClick={() => handleSubmitForm("save")} loading={isSaving} disabled={actionFetcher.state !== "idle"}>
                        초안 임시저장 (App DB)
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => handleSubmitForm("publish")}
                        loading={isPublishing}
                        disabled={actionFetcher.state !== "idle" || blogs.length === 0}
                      >
                        쇼피파이 블로그 게시 / 동기화
                      </Button>
                    </InlineStack>
                  </InlineStack>
                </BlockStack>
              </Card>

            </BlockStack>
          </Layout.Section>
        </Layout>

        <Modal open={Boolean(deleteRecipeId)} onClose={() => setDeleteRecipeId(null)} title="레시피 삭제" primaryAction={{ content: "삭제", destructive: true, onAction: confirmDeleteRecipe }} secondaryActions={[{ content: "취소", onAction: () => setDeleteRecipeId(null) }]}><Modal.Section><Text as="p">이 레시피와 연결된 Shopify 블로그 글을 삭제하시겠습니까?</Text></Modal.Section></Modal>
        {/* Modals */}
        <RecipePresetModal
          open={presetModalOpen}
          onClose={() => setPresetModalOpen(false)}
          onSelectPreset={handleSelectPreset}
        />

        <RecipeStorefrontPreviewModal
          open={previewModalOpen}
          onClose={() => setPreviewModalOpen(false)}
          recipe={previewRecipeObject}
        />

      </BlockStack>
    </Page>
  );
}

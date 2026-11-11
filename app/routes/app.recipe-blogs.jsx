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
import prisma, { ensureDatabaseSchema } from "../db.server";
import RecipeDashboardHeader from "../components/recipe/RecipeDashboardHeader";
import RecipePresetModal from "../components/recipe/RecipePresetModal";
import RecipeLocalizationEditor from "../components/recipe/RecipeLocalizationEditor";
import RecipeMetadataSettings from "../components/recipe/RecipeMetadataSettings";
import RecipeIngredientsCommerce from "../components/recipe/RecipeIngredientsCommerce";
import RecipeStorefrontPreviewModal from "../components/recipe/RecipeStorefrontPreviewModal";
import { unpackRecipe } from "../utils/recipeData.js";
import { handleRecipeAction } from "../utils/recipePersistence.server.js";
import { getShopAliases } from "../utils/shopDomain.js";

// Keeps the admin menu on screen and offers a retry when this screen fails.
export { RouteErrorBoundary as ErrorBoundary } from "../components/common/RouteErrorBoundary.jsx";
import { UnsavedChangesGuard } from "../components/common/AppFeedback.jsx";
export { unpackRecipe } from "../utils/recipeData.js";

const BLOGS_CACHE_TTL_MS = 5 * 60 * 1000;
const blogCache = new Map();

// --- LOADER ---
export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const searchProducts = url.searchParams.get("searchProducts");

  // Endpoint: Product search for the interactive selector
  if (searchProducts) {
    try {
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
    } catch (err) {
      console.error("[Recipe Loader] Product search error:", err);
      return Response.json({ products: [] });
    }
  }

  try {
    await ensureDatabaseSchema();
  } catch (schemaErr) {
    console.warn("[Recipe Loader] DB schema check blip:", schemaErr?.message);
  }

  try {
    const shopAliases = getShopAliases(shop);
    // Fetch local recipes with products
    const rawRecipesTask = prisma.recipe.findMany({
      where: { shop: { in: shopAliases } },
      include: { products: true },
      orderBy: { createdAt: "desc" },
    }).catch((dbErr) => {
      console.error("Error loading recipes from DB:", dbErr);
      return [];
    });

    // Fetch store blogs and shop URL with in-memory caching
    const now = Date.now();
    const cached = blogCache.get(shop);
    let blogs = cached && (now - cached.timestamp < BLOGS_CACHE_TTL_MS) ? cached.blogs : null;
    let shopUrl = cached && (now - cached.timestamp < BLOGS_CACHE_TTL_MS) ? cached.shopUrl : null;

    const storeInfoTask = (blogs && shopUrl) ? Promise.resolve(null) : (async () => {
      try {
        const res = await admin.graphql(
          `#graphql
          query getBlogsAndShop {
            blogs(first: 30) {
              nodes {
                id
                title
                handle
              }
            }
            shop {
              primaryDomain {
                url
              }
            }
          }`
        );
        const json = await res.json();
        return json.data || null;
      } catch (err) {
        console.error("Error loading Shopify blogs and shop url:", err);
        return null;
      }
    })();

    const [rawRecipes, storeInfo] = await Promise.all([rawRecipesTask, storeInfoTask]);
    const recipes = (rawRecipes || []).map(unpackRecipe).filter(Boolean);

    if (!blogs) blogs = storeInfo?.blogs?.nodes || [];
    if (!shopUrl) shopUrl = storeInfo?.shop?.primaryDomain?.url || `https://${shop}`;

    // Auto-create default "K-Food Recipes" blog if store has no blogs configured
    if (blogs.length === 0) {
      try {
        const createRes = await admin.graphql(
          `#graphql
          mutation CreateDefaultBlog($blog: BlogCreateInput!) {
            blogCreate(blog: $blog) {
              blog {
                id
                title
                handle
              }
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: {
              blog: {
                title: "K-Food Recipes",
                handle: "recipes",
                commentPolicy: "MODERATE",
              },
            },
          }
        );
        const createJson = await createRes.json();
        const createdBlog = createJson?.data?.blogCreate?.blog;
        if (createdBlog?.id) {
          blogs = [createdBlog];
        }
      } catch (createErr) {
        console.warn("[Recipe Loader] Auto-create default blog notice:", createErr?.message);
      }
    }

    blogCache.set(shop, { blogs, shopUrl, timestamp: now });

    return { recipes, blogs, shopUrl, error: null };
  } catch (err) {
    console.error("Recipe loader unexpected error:", err);
    return {
      recipes: [],
      blogs: [],
      shopUrl: `https://${shop}`,
      error: "레시피 데이터를 불러오는 중 오류가 발생했습니다: " + (err.message || String(err)),
    };
  }
}

// --- ACTION ---
export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  try {
    await ensureDatabaseSchema();
  } catch (schemaErr) {
    console.warn("[Recipe Action] DB schema check blip:", schemaErr?.message);
  }

  if (intent === "create_blog") {
    try {
      const createRes = await admin.graphql(
        `#graphql
        mutation CreateBlog($blog: BlogCreateInput!) {
          blogCreate(blog: $blog) {
            blog {
              id
              title
              handle
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            blog: {
              title: String(form.get("title") || "K-Food Recipes"),
              handle: String(form.get("handle") || "recipes"),
              commentPolicy: "MODERATE",
            },
          },
        }
      );
      const json = await createRes.json();
      const created = json?.data?.blogCreate?.blog;
      const userErrors = json?.data?.blogCreate?.userErrors;
      if (created?.id) {
        blogCache.delete(session.shop);
        return Response.json({
          success: true,
          blog: created,
          message: "K-Food Recipes 블로그 채널이 생성되었습니다.",
        });
      }
      return Response.json({
        success: false,
        error: userErrors?.map((e) => e.message).join(", ") || "블로그 채널 생성에 실패했습니다.",
      });
    } catch (err) {
      return Response.json({
        success: false,
        error: err.message || "블로그 채널 생성 중 오류가 발생했습니다.",
      });
    }
  }

  return handleRecipeAction({ form, shop: session.shop, admin, db: prisma });
}

// --- MAIN FRONTEND COMPONENT ---
export function RecipeCommerceManager({ active = true, onDirtyChange }) {
  const loaderFetcher = useFetcher();
  const { load } = loaderFetcher;
  useEffect(() => {
    if (active && !loaderFetcher.data && loaderFetcher.state === "idle") {
      load("/app/recipe-blogs");
    }
  }, [active, load, loaderFetcher.data, loaderFetcher.state]);

  if (loaderFetcher.state === "loading" || (!loaderFetcher.data && !loaderFetcher.error)) {
    return (
      <Card>
        <Box padding="400">
          <Text as="p" tone="subdued">레시피 커머스 데이터를 불러오는 중입니다...</Text>
        </Box>
      </Card>
    );
  }

  if (loaderFetcher.error || loaderFetcher.data?.error) {
    return (
      <Card>
        <Box padding="400">
          <BlockStack gap="300">
            <Banner tone="critical">
              <Text as="p">
                {loaderFetcher.error?.message || loaderFetcher.data?.error || "레시피 데이터를 불러오는 중 오류가 발생했습니다."}
              </Text>
            </Banner>
            <InlineStack align="end">
              <Button onClick={() => load("/app/recipe-blogs")}>다시 시도</Button>
            </InlineStack>
          </BlockStack>
        </Box>
      </Card>
    );
  }

  return (
    <RecipeBlogsContent
      loaderData={{
        recipes: loaderFetcher.data?.recipes || [],
        blogs: loaderFetcher.data?.blogs || [],
        shopUrl: loaderFetcher.data?.shopUrl || "",
        error: loaderFetcher.data?.error || null,
      }}
      loadError={loaderFetcher.data?.error || null}
      actionUrl="/app/recipe-blogs"
      embedded={true}
      onReload={() => loaderFetcher.load("/app/recipe-blogs")}
      onDirtyChange={onDirtyChange}
    />
  );
}

export default function RecipeBlogs(props = {}) {
  return RecipeBlogsContent(props);
}

function RecipeBlogsContent(props = {}) {
  // Called on every render (hooks must not be conditional); embedded callers pass their own data.
  const routeData = useLoaderData();
  const rawData = props.loaderData || routeData || {};
  const recipes = Array.isArray(rawData.recipes) ? rawData.recipes : [];
  const blogs = Array.isArray(rawData.blogs) ? rawData.blogs : [];
  const shopUrl = rawData.shopUrl || "";
  const loadError = props.loadError || rawData.error || null;
  const { actionUrl, embedded = false, onReload, onDirtyChange } = props;
  const onReloadRef = useRef(onReload);
  onReloadRef.current = onReload;
  const fetcher = useFetcher();
  const actionFetcher = useFetcher();
  const blogActionFetcher = useFetcher();
  const submitOpts = actionUrl ? { method: "post", action: actionUrl } : { method: "post" };
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

    // Unsaved-edit tracking: the editor is clean right after a recipe is loaded,
    // reset or saved, and dirty once any field differs from that point.
    const editorSnapshot = JSON.stringify({ category, occasion, difficulty, prepTimeMinutes, cookTimeMinutes, servings, spiceLevel, dietaryFlags, imageUrl, translations, ingredients, selectedProducts });
    const editorSnapshotRef = useRef(editorSnapshot);
    editorSnapshotRef.current = editorSnapshot;
    const [cleanSnapshot, setCleanSnapshot] = useState(editorSnapshot);
    const [cleanMark, setCleanMark] = useState(0);
    const markEditorClean = () => setCleanMark(mark => mark + 1);
    // Runs after the state updates batched with markEditorClean() have rendered.
    useEffect(() => { setCleanSnapshot(editorSnapshotRef.current); }, [cleanMark]);
    const hasUnsavedEdits = editorSnapshot !== cleanSnapshot;
    const onDirtyChangeRef = useRef(onDirtyChange);
    onDirtyChangeRef.current = onDirtyChange;
    useEffect(() => {
      onDirtyChangeRef.current?.(hasUnsavedEdits);
      return () => onDirtyChangeRef.current?.(false);
    }, [hasUnsavedEdits]);

    const isSaving = actionFetcher.state !== "idle" && actionFetcher.formData?.get("intent") === "save";
    const isPublishing = actionFetcher.state !== "idle" && actionFetcher.formData?.get("intent") === "publish";
    const isCreatingBlog = blogActionFetcher.state !== "idle";

    const firstBlogId = blogs[0]?.id;
    // Auto-sync blog ID if blogs are loaded asynchronously
    useEffect(() => {
      if (!shopifyBlogId && firstBlogId) {
        setShopifyBlogId(firstBlogId);
      }
    }, [firstBlogId, shopifyBlogId]);

    const handleCreateDefaultBlog = () => {
      const fd = new FormData();
      fd.append("intent", "create_blog");
      fd.append("title", "K-Food Recipes");
      fd.append("handle", "recipes");
      blogActionFetcher.submit(fd, submitOpts);
    };

    useEffect(() => {
      if (blogActionFetcher.state === "idle" && blogActionFetcher.data) {
        if (blogActionFetcher.data.success) {
          setToastMessage({
            type: "success",
            title: "블로그 채널 생성 완료",
            content: blogActionFetcher.data.message || "K-Food Recipes 블로그 채널이 생성되었습니다.",
          });
          if (blogActionFetcher.data.blog?.id) {
            setShopifyBlogId(blogActionFetcher.data.blog.id);
          }
          if (onReloadRef.current) onReloadRef.current();
        } else if (blogActionFetcher.data.error) {
          setToastMessage({
            type: "critical",
            title: "블로그 생성 실패",
            content: blogActionFetcher.data.error,
          });
        }
      }
    }, [blogActionFetcher.state, blogActionFetcher.data]);

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
      if (result.success) markEditorClean();
      if (result.success && onReloadRef.current) onReloadRef.current();
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
      markEditorClean();
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
      markEditorClean();
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
      actionFetcher.submit(formData, submitOpts);

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
      actionFetcher.submit(formData, submitOpts);
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

    const contentBody = (
      <BlockStack gap="500">
        {embedded && (
          <Card>
            <InlineStack align="space-between" blockAlign="center" wrap gap="200">
              <BlockStack gap="050">
                <Text as="h2" variant="headingMd">레시피 관리</Text>
                <Text as="p" tone="subdued" variant="bodySm">블로그 레시피 본문과 연결 상품을 관리합니다.</Text>
              </BlockStack>
              <Button variant="primary" onClick={() => setPresetModalOpen(true)}>
                기본 템플릿 불러오기
              </Button>
            </InlineStack>
          </Card>
        )}

        {/* KPI Metrics Dashboard Header */}
        <RecipeDashboardHeader recipes={recipes} />

        {loadError && (
          <Banner tone="critical">
            <p>{loadError}</p>
          </Banner>
        )}

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
                  <Text as="h2" variant="headingMd">레시피 목록</Text>
                  <Button size="slim" variant="primary" onClick={handleNewRecipe}>새 레시피</Button>
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
                      등록된 레시피가 없습니다.<br />새 레시피를 작성하거나 기본 템플릿을 불러오세요.
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
                            background={isSelected ? "bg-surface-secondary" : "bg-surface"}
                            borderRadius="200"
                            style={{
                              cursor: "pointer",
                              border: isSelected ? "1.5px solid #303030" : "1px solid #e1e3e5",
                            }}
                            onClick={() => handleEditRecipe(recipe)}
                          >
                            <BlockStack gap="100">
                              <InlineStack align="space-between" blockAlign="center">
                                <Text as="h3" variant="headingSm" fontWeight="bold" style={{ wordBreak: "break-all" }}>
                                  {recipe.title}
                                </Text>
                                {recipe.published ? (
                                  <Badge>게시됨</Badge>
                                ) : (
                                  <Badge>임시 저장</Badge>
                                )}
                              </InlineStack>

                              <InlineStack gap="200" blockAlign="center">
                                <Badge>{recipe.category || "STREET_FOOD"}</Badge>
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
                      {selectedRecipe ? `편집: ${selectedRecipe.title}` : "새 레시피 작성"}
                    </Text>
                    {selectedRecipe?.published && <Badge>게시됨</Badge>}
                  </InlineStack>

                  <InlineStack gap="200">
                    <Button onClick={() => setPreviewModalOpen(true)}>
                      화면 미리보기
                    </Button>
                    <Button onClick={() => setPresetModalOpen(true)}>
                      템플릿 불러오기
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
                  <Text as="h3" variant="headingMd">블로그 게시 설정</Text>

                  {blogs.length === 0 ? (
                    <Banner
                      tone="warning"
                      action={{
                        content: "블로그 채널 생성",
                        onAction: handleCreateDefaultBlog,
                        loading: isCreatingBlog,
                      }}
                    >
                      상점에 블로그 채널이 등록되어 있지 않습니다. 위 버튼을 누르면 레시피 블로그 채널이 생성됩니다.
                    </Banner>
                  ) : (
                    <Select
                      label="게시할 블로그 채널"
                      options={blogs.map((b) => ({ label: b.title, value: b.id }))}
                      value={shopifyBlogId}
                      onChange={setShopifyBlogId}
                    />
                  )}

                  <InlineStack align="space-between" blockAlign="center">
                    <Button onClick={handleNewRecipe}>초기화</Button>

                    <InlineStack gap="200">
                      <Button onClick={() => handleSubmitForm("save")} loading={isSaving} disabled={actionFetcher.state !== "idle"}>
                        초안 임시저장
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => handleSubmitForm("publish")}
                        loading={isPublishing}
                        disabled={actionFetcher.state !== "idle" || (!shopifyBlogId && blogs.length === 0)}
                      >
                        블로그 게시
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
    );

    if (embedded) return contentBody;

    return (
      <Page backAction={{ content: "대시보드", url: "/app" }}
        title="레시피 관리"
        subtitle="블로그 레시피 본문과 연결 상품을 관리합니다."
        primaryAction={{
          content: "기본 템플릿 불러오기",
          onAction: () => setPresetModalOpen(true),
        }}
      >
        <UnsavedChangesGuard when={hasUnsavedEdits} />
        {contentBody}
      </Page>
    );
  }

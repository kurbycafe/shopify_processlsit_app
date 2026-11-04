-- CreateTable
CREATE TABLE IF NOT EXISTS "Recipe" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "introduction" TEXT NOT NULL,
    "steps" TEXT NOT NULL,
    "imageUrl" TEXT,
    "shopifyArticleId" TEXT,
    "shopifyBlogId" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Recipe_shop_idx" ON "Recipe"("shop");

-- CreateTable
CREATE TABLE IF NOT EXISTS "RecipeProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipeId" TEXT NOT NULL REFERENCES "Recipe"("id") ON DELETE CASCADE,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "variantTitle" TEXT,
    "price" TEXT,
    "imageUrl" TEXT
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RecipeProduct_recipeId_idx" ON "RecipeProduct"("recipeId");


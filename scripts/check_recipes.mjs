import prisma from '../app/db.server.js';

async function main() {
  const count = await prisma.recipe.count();
  console.log('Recipe count:', count);
  const recipes = await prisma.recipe.findMany({ take: 5, include: { products: true } });
  console.log('Sample recipes:', JSON.stringify(recipes, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());

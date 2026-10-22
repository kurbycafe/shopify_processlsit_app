const res = await fetch('https://process-list-beryl.vercel.app/api/mobile/v1/storefront-config');
const d = await res.json();
console.log('Success:', d.success);
console.log('Recipe count:', d.data?.recipes?.length);
console.log('Sample recipe:', d.data?.recipes?.[0]?.title);
console.log('FAQ count:', d.data?.faqs?.length);
console.log('Loyalty policy:', d.data?.loyaltyPolicy);

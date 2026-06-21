const fs = require('fs');
let c = fs.readFileSync('app/routes/app.pick-list.jsx', 'utf8');

c = c.replace(/\/\/\s*2\.\s*[^\n]*const\s*UNFULFILLED_ORDERS_QUERY/, '// 2. GraphQL Query\nconst UNFULFILLED_ORDERS_QUERY');

fs.writeFileSync('app/routes/app.pick-list.jsx', c, 'utf8');
console.log('Fixed syntax error');

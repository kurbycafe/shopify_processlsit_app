const fs = require('fs');
let c = fs.readFileSync('app/routes/app.lieferschein.jsx', 'utf8');
let o = c;

// Fix GraphQL query to include cancelledAt
c = c.replace(/displayFinancialStatus(\r?\n\s*)displayFulfillmentStatus/, "displayFinancialStatus$1cancelledAt$1displayFulfillmentStatus");

// Add filtering logic
c = c.replace(/const orders = allEdges\.map\(\(edge\) => \{/, 
`const validEdges = allEdges.filter((edge) => {
      const node = edge.node;
      if (node.cancelledAt) return false;
      const fStatus = node.displayFinancialStatus;
      if (fStatus === "REFUNDED" || fStatus === "VOIDED") return false;
      return true;
    });

    const orders = validEdges.map((edge) => {`);

fs.writeFileSync('app/routes/app.lieferschein.jsx', c, 'utf8');
console.log('Replaced:', c !== o);

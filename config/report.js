const PORT = process.env.PORT || 3000;
const FREE_LIMIT = 30000; // per store per month free calls
const RESERVE = 10000; // keep in reserve (avoid consuming these unless needed)
const OVERAGE_RATE = 0.03; // cost per call beyond free tier

const COLUMNS = [
  'Order #', 'Placed', 'Order Status', 'Line Item ID', 'Tracking #',
  'Shipping Landded Cost', 'Ship Method', 'Ship Date',
  'Product Personalization', 'Original Quantity', 'Shipped Quantity', 'Product Name', 'SKU', 'Product Options',
  'Billing Month',
];

const STRUCTURED_COLUMNS = [
  'Billing Name', 'Billing Company', 'Billing Address1', 'Billing Address2', 'Billing City', 'Billing State', 'Billing Zip', 'Billing Country', 'Billing Email', 'Billing Phone',
  'Shipping Name', 'Shipping Company', 'Shipping Address1', 'Shipping Address2', 'Shipping City', 'Shipping State', 'Shipping Zip', 'Shipping Country', 'Shipping Email', 'Shipping Phone',
];

const ALL_COLUMNS = COLUMNS.concat(STRUCTURED_COLUMNS);

module.exports = {
  PORT,
  FREE_LIMIT,
  RESERVE,
  OVERAGE_RATE,
  COLUMNS,
  STRUCTURED_COLUMNS,
  ALL_COLUMNS,
};

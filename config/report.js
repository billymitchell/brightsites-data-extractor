const PORT = process.env.PORT || 3000;
const FREE_LIMIT = 30000; // per store per month free calls
const RESERVE = 10000; // keep in reserve (avoid consuming these unless needed)
const OVERAGE_RATE = 0.03; // cost per call beyond free tier
const MAX_REPORT_ROWS = Math.max(1, Number(process.env.REPORT_MAX_ROWS) || 50000);

const COLUMNS = [
  'Order #', 'Placed', 'Order Status', 'Line Item ID', 'Tracking #',
  'Shipping Landded Cost', 'Store Ship Method', 'Ship Date',
  'Product Personalization', 'Original Quantity', 'Shipped Quantity', 'Product Name', 'SKU', 'Product Options',
  'Billing Month', 'Unit Price', 'Total Price', 'Tax Total', 'Order Total', 'Store Shipping Cost',
];

const STRUCTURED_COLUMNS = [
  'Billing Name', 'Billing Company', 'Billing Address1', 'Billing Address2', 'Billing City', 'Billing State', 'Billing Zip', 'Billing Country', 'Billing Email', 'Billing Phone',
  'Shipping Name', 'Shipping Company', 'Shipping Address1', 'Shipping Address2', 'Shipping City', 'Shipping State', 'Shipping Zip', 'Shipping Country', 'Shipping Email', 'Shipping Phone',
];

const EXTRA_COLUMNS = [
  'Order Item Total', 'Order Sales Tax', 'Order Shipping Sales Tax', 'Order Discounts',
  'Customer Email', 'Username', 'Customer ID', 'Payment Method', 'Payment Status', 'In-Hands Date', 'Order Updated',
  'Product ID', 'Internal ID', 'Tax Code', 'Base Price', 'Options Price', 'Logo Charges', 'Line Item Note',
];

const ALL_COLUMNS = COLUMNS.concat(STRUCTURED_COLUMNS, EXTRA_COLUMNS);

const COLUMN_GROUPS = [
  { label: 'Order', columns: ['Order #', 'Placed', 'Order Status', 'Billing Month', 'Order Updated', 'Order Total', 'Order Item Total'] },
  { label: 'Line item', columns: ['Line Item ID', 'Product Name', 'SKU', 'Product Options', 'Product Personalization', 'Original Quantity', 'Shipped Quantity', 'Product ID', 'Internal ID', 'Line Item Note'] },
  { label: 'Pricing, tax & discounts', columns: ['Unit Price', 'Total Price', 'Base Price', 'Options Price', 'Logo Charges', 'Tax Total', 'Tax Code', 'Order Sales Tax', 'Order Shipping Sales Tax', 'Order Discounts'] },
  { label: 'Shipping & tracking', columns: ['Tracking #', 'Store Ship Method', 'Ship Date', 'In-Hands Date', 'Shipping Landded Cost', 'Store Shipping Cost'] },
  { label: 'Customer & payment', columns: ['Customer Email', 'Username', 'Customer ID', 'Payment Method', 'Payment Status'] },
  { label: 'Billing contact', columns: STRUCTURED_COLUMNS.filter((c) => c.startsWith('Billing ')) },
  { label: 'Shipping contact', columns: STRUCTURED_COLUMNS.filter((c) => c.startsWith('Shipping ')) },
];

module.exports = {
  COLUMN_GROUPS,
  PORT,
  FREE_LIMIT,
  RESERVE,
  OVERAGE_RATE,
  MAX_REPORT_ROWS,
  COLUMNS,
  STRUCTURED_COLUMNS,
  EXTRA_COLUMNS,
  ALL_COLUMNS,
};
